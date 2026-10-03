'use strict';

/**
 * Step-up authentication for high-risk OxSteed Credit money actions
 * (Phase 5, gap 8).
 *
 * Required for:
 *   - customer top-ups at or above OXSTEED_CREDIT_STEPUP_THRESHOLD_CENTS
 *     (default 100000 = $1,000),
 *   - every settlement payout initiation (admin).
 *
 * Flow: the client calls issueStepupChallenge (which emails a 6-digit
 * one-time code to the actor's verified email), the user reads the code,
 * and the money endpoint receives { stepupChallengeId, stepupCode } and
 * verifies before executing. Challenges are short-lived
 * (OXSTEED_CREDIT_STEPUP_CODE_TTL_MINUTES, default 10), single-use, and
 * burn after 5 wrong attempts. Only the HMAC of the code is stored, never
 * the code itself.
 *
 * Delivery uses the existing email infra (server/services/emailService).
 * If no email transport is configured, issuance fails closed with
 * credit_stepup_delivery_unavailable rather than creating an
 * undeliverable challenge.
 */

const crypto = require('crypto');
const pool = require('../db');
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');
const emailService = require('./emailService');

const STEPUP_THRESHOLD_CENTS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_STEPUP_THRESHOLD_CENTS || '100000', 10) || 100000
);
const STEPUP_CODE_TTL_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_STEPUP_CODE_TTL_MINUTES || '10', 10) || 10
);
const STEPUP_MAX_ATTEMPTS = 5;
// Phase 6 adds withdrawal, customer_transfer, and restaurant_conversion:
// the same fresh-challenge bar as large top-ups and settlement payouts.
// Phase 7 (gap 9) adds pending_action_approve: the checker proves a fresh
// challenge before approving a pending money movement.
const STEPUP_ACTION_TYPES = Object.freeze([
  'topup',
  'restaurant_topup',
  'settlement_payout',
  'withdrawal',
  'customer_transfer',
  'restaurant_conversion',
  'pending_action_approve',
]);

function getStepupPepper() {
  return process.env.OXSTEED_CREDIT_STEPUP_PEPPER || process.env.JWT_SECRET || null;
}

function hashStepupCode(code) {
  const pepper = getStepupPepper();
  if (!pepper) throw new AppError('Step-up challenges are not configured', 503, 'credit_stepup_not_configured');
  return crypto.createHmac('sha256', pepper).update(`stepup:${String(code)}`).digest('hex');
}

function normalizeString(value, max = 255) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text.slice(0, max);
}

function formatChallenge(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    actorUserId: String(row.actor_user_id),
    actionType: row.action_type,
    amountCents: Number(row.amount_cents),
    currencyCode: row.currency_code,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

/**
 * Issue a challenge and email the code. Returns the challenge id and
 * expiry only; the code travels by email, never in the API response.
 */
async function issueStepupChallenge({ actorUserId, actorEmail, actionType, amountCents, currencyCode = 'USD' }) {
  if (!actorUserId) throw new AppError('Actor is required', 400, 'credit_stepup_actor_required');
  if (!STEPUP_ACTION_TYPES.includes(actionType)) {
    throw new AppError(`Unknown step-up action '${actionType}'`, 400, 'credit_stepup_action_invalid');
  }
  const email = normalizeString(actorEmail, 320);
  if (!email || !email.includes('@')) throw new AppError('A verified email is required for step-up verification', 400, 'credit_stepup_email_required');
  const amount = Number(amountCents);
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError('Amount must be a positive integer number of cents', 400, 'credit_stepup_amount_invalid');
  const currency = String(currencyCode || 'USD').toUpperCase();

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashStepupCode(code);
  const expiresAt = new Date(Date.now() + STEPUP_CODE_TTL_MINUTES * 60 * 1000).toISOString();

  const challenge = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_stepup_challenges
         (actor_user_id, action_type, amount_cents, currency_code, code_hash, max_attempts, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [actorUserId, actionType, amount, currency, codeHash, STEPUP_MAX_ATTEMPTS, expiresAt]
    );
    return rows[0];
  }, 'credit_stepup_issue');

  // Fail closed on delivery: a challenge nobody can read must not exist.
  let delivered = false;
  try {
    const sent = await emailService.send({
      to: email,
      subject: 'Your OxSteed verification code',
      html: `<p>Your OxSteed verification code is: <strong>${code}</strong></p><p>It expires in ${STEPUP_CODE_TTL_MINUTES} minutes. If you did not request this, ignore this email.</p>`,
    });
    delivered = Boolean(sent);
  } catch (error) {
    delivered = false;
  }
  if (!delivered) {
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE oxsteed_credit_stepup_challenges SET consumed_at = NOW() WHERE id = $1`,
        [challenge.id]
      );
    }, 'credit_stepup_burn_undelivered');
    throw new AppError('Verification code delivery is unavailable. Try again later.', 503, 'credit_stepup_delivery_unavailable');
  }
  return { challenge: formatChallenge(challenge), delivery: 'email' };
}

/**
 * Verify a presented code. Throws AppError on any failure (missing,
 * expired, consumed, attempts exhausted, wrong code). On success the
 * challenge is consumed (single-use). Wrong attempts are counted and the
 * challenge burns at the attempt limit.
 */
async function verifyStepupChallenge({ challengeId, actorUserId, actionType, code }) {
  const normalizedId = normalizeString(challengeId, 64);
  const normalizedCode = normalizeString(code, 32);
  if (!normalizedId || !normalizedCode) {
    throw new AppError('A step-up verification code is required for this action', 403, 'credit_stepup_challenge_required');
  }
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_stepup_challenges WHERE id = $1 FOR UPDATE`,
      [normalizedId]
    );
    const challenge = rows[0];
    if (!challenge) {
      throw new AppError('Verification challenge not found', 403, 'credit_stepup_challenge_invalid');
    }
    if (String(challenge.actor_user_id) !== String(actorUserId) || challenge.action_type !== actionType) {
      throw new AppError('Verification challenge does not match this action', 403, 'credit_stepup_challenge_invalid');
    }
    if (challenge.consumed_at) {
      throw new AppError('Verification challenge was already used', 403, 'credit_stepup_challenge_invalid');
    }
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      throw new AppError('Verification code expired. Request a new one.', 403, 'credit_stepup_challenge_expired');
    }
    if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
      await client.query(`UPDATE oxsteed_credit_stepup_challenges SET consumed_at = NOW() WHERE id = $1`, [challenge.id]);
      throw new AppError('Too many wrong attempts. Request a new verification code.', 403, 'credit_stepup_challenge_invalid');
    }
    const expected = hashStepupCode(normalizedCode);
    const expectedBuf = Buffer.from(challenge.code_hash, 'hex');
    const actualBuf = Buffer.from(expected, 'hex');
    const matches = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
    if (!matches) {
      const attempts = Number(challenge.attempts) + 1;
      const burned = attempts >= Number(challenge.max_attempts);
      await client.query(
        `UPDATE oxsteed_credit_stepup_challenges
            SET attempts = $2, consumed_at = CASE WHEN $3 THEN NOW() ELSE consumed_at END
          WHERE id = $1`,
        [challenge.id, attempts, burned]
      );
      throw new AppError('Verification code is incorrect', 403, 'credit_stepup_challenge_invalid', {
        attemptsRemaining: String(Math.max(0, Number(challenge.max_attempts) - attempts)),
      });
    }
    await client.query(
      `UPDATE oxsteed_credit_stepup_challenges SET consumed_at = NOW() WHERE id = $1`,
      [challenge.id]
    );
    return { verified: true, challenge: formatChallenge({ ...challenge, consumed_at: new Date().toISOString() }) };
  }, 'credit_stepup_verify');
}

/**
 * Whether a top-up amount needs step-up. Payout initiation always needs it.
 * The threshold is amount-based and applies identically to withdrawals,
 * customer transfers, and restaurant conversions (Phase 6).
 */
function topupRequiresStepup(amountCents) {
  return Number(amountCents) >= STEPUP_THRESHOLD_CENTS;
}

// Generic alias: the rule is amount-based, not top-up-specific.
const amountRequiresStepup = topupRequiresStepup;

module.exports = {
  STEPUP_THRESHOLD_CENTS,
  STEPUP_CODE_TTL_MINUTES,
  STEPUP_MAX_ATTEMPTS,
  STEPUP_ACTION_TYPES,
  issueStepupChallenge,
  verifyStepupChallenge,
  topupRequiresStepup,
  amountRequiresStepup,
  formatChallenge,
};
