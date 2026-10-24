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
 * Flow: the client calls issueStepupChallenge. Email-method challenges
 * email a 6-digit one-time code to the actor's verified email; TOTP-method
 * challenges (the admin credit action types, auth-audit item 12) store no
 * code and the admin proves the current code from their authenticator app.
 * The money endpoint receives { stepupChallengeId, stepupCode } and
 * verifies before executing. Challenges are short-lived
 * (OXSTEED_CREDIT_STEPUP_CODE_TTL_MINUTES, default 10), single-use, and
 * burn after 5 wrong attempts. Only the HMAC of an emailed code is stored,
 * never the code itself; TOTP codes are verified against the actor's
 * encrypted TOTP secret and each 30-second time-step can be consumed once.
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
const { authenticator } = require('@otplib/v12-adapter');
const { decrypt } = require('../utils/encryption');
const { adminTotpEnabled } = require('../middleware/adminAuth');

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
  'instant_payout',
  'agent_job_cancel',
  'customer_transfer',
  'restaurant_conversion',
  'pending_action_approve',
  // ADM-079: maker step-up for the generic pending-actions endpoint.
  'pending_action_request',
  // ADM-186: approver step-up for agent-console credit adjustments.
  'agent_credit_adjustment_approve',
  // ADM-020: the KYC/AML review perimeter is one admin deep; decisions that
  // unlock fiat funding (identity tier grants, sanctions-hit clears) or move
  // a compliance case require a fresh step-up challenge.
  'compliance_verification_decision',
  'compliance_sanction_decision',
  'compliance_case_transition',
  // ADM-082: money-adjacent controls (wallet freeze/unfreeze, agreement
  // create/activate, entitlement grants) execute under a single admin;
  // require a fresh step-up challenge.
  'credit_account_status_update',
  'credit_agreement_create',
  'credit_agreement_transition',
  'credit_entitlement_upsert',
  // ADM-113: single-admin approval moves arbitrary sums via Stripe Transfer;
  // require a fresh step-up challenge.
  'restaurant_payout_approve',
  // ADM-112: manual refunds move arbitrary sums with a single grant and no
  // amount tiering; require a fresh step-up challenge per refund. (Full
  // two-person approval for refunds is a product decision for Emile.)
  'manual_refund',
  'food_refund',
  'restaurant_topup_approve',
  'fee_config_update',
  // ADM-016: the second admin (checker) in dual approval must prove a fresh
  // step-up challenge before the queued money movement executes.
  'money_movement_approve',
  // Audit fix (auth finding 13): approving a platform settings change
  // request (fees, escrow delay, dual-approval threshold, rail enablement)
  // is a single-admin money-adjacent decision; require a fresh step-up.
  'settings_change_approve',
  // Audit fix (auth finding 15): processing an affiliate payout moves real
  // money on a single admin's say-so; the maker must prove a fresh step-up.
  'affiliate_payout_process',
  // Auth audit item 8: unfreezing the credit rail lifts the emergency stop
  // on money initiation; a fresh step-up is required.
  'credit_rail_unfreeze',
  // Auth audit item 16: admin card issuance creates a spendable instrument
  // immediately; a fresh step-up is required.
  'credit_card_issue',
]);

// Auth-audit item 12 (product decision): the admin credit step-up action
// types below verify against the admin's TOTP authenticator instead of an
// emailed 6-digit code. The second factor on every admin credit money
// movement is the authenticator, not the admin's email account. All other
// action types (customer/helper flows where TOTP is not mandatory) keep
// the emailed-code method. This set is the single source of truth; the
// oxsteed-credit controller's ADMIN_STEPUP_ACTION_TYPES is derived from it.
const TOTP_STEPUP_ACTION_TYPES = Object.freeze([
  'settlement_payout',
  'withdrawal',
  'pending_action_approve',
  'pending_action_request',
  'agent_credit_adjustment_approve',
  'compliance_verification_decision',
  'compliance_sanction_decision',
  'compliance_case_transition',
  'credit_account_status_update',
  'credit_agreement_create',
  'credit_agreement_transition',
  'credit_entitlement_upsert',
  'manual_refund',
  'food_refund',
  'restaurant_topup_approve',
  'fee_config_update',
  'credit_rail_unfreeze',
  'credit_card_issue',
]);

// TOTP codes rotate every 30 seconds (RFC 6238 time-step).
const TOTP_TIME_STEP_SECONDS = 30;

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
    method: row.method || 'email',
  };
}

/**
 * Resolve which second-factor method an action type uses. TOTP-only action
 * types fail closed when a caller explicitly asks for email, and vice
 * versa: the method is a property of the action, not of the caller.
 */
function resolveStepupMethod(actionType, requestedMethod) {
  const totpOnly = TOTP_STEPUP_ACTION_TYPES.includes(actionType);
  if (requestedMethod != null && requestedMethod !== '') {
    const method = String(requestedMethod).toLowerCase();
    if (method !== 'email' && method !== 'totp') {
      throw new AppError('Unsupported step-up method', 400, 'credit_stepup_method_invalid');
    }
    if (totpOnly && method !== 'totp') {
      throw new AppError('This action requires TOTP step-up verification', 400, 'credit_stepup_method_invalid');
    }
    if (!totpOnly && method !== 'email') {
      throw new AppError('This action requires email step-up verification', 400, 'credit_stepup_method_invalid');
    }
    return method;
  }
  return totpOnly ? 'totp' : 'email';
}

/**
 * Issue a challenge. Email-method challenges email a 6-digit one-time code
 * to the actor's verified email; TOTP-method challenges store no code and
 * the actor proves the current code from their authenticator app at verify
 * time. Returns the challenge id and expiry only; secrets never travel in
 * the API response.
 */
async function issueStepupChallenge({ actorUserId, actorEmail, actionType, amountCents, currencyCode = 'USD', method }) {
  if (!actorUserId) throw new AppError('Actor is required', 400, 'credit_stepup_actor_required');
  if (!STEPUP_ACTION_TYPES.includes(actionType)) {
    throw new AppError(`Unknown step-up action '${actionType}'`, 400, 'credit_stepup_action_invalid');
  }
  const stepupMethod = resolveStepupMethod(actionType, method);
  const amount = Number(amountCents);
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError('Amount must be a positive integer number of cents', 400, 'credit_stepup_amount_invalid');
  const currency = String(currencyCode || 'USD').toUpperCase();

  if (stepupMethod === 'totp') {
    // Fail closed: a TOTP challenge is useless when the admin has no
    // authenticator enrolled (TOTP is mandatory for admins).
    if (!(await adminTotpEnabled(actorUserId))) {
      throw new AppError('TOTP must be enabled for step-up verification', 403, 'credit_stepup_totp_not_enabled');
    }
    const expiresAt = new Date(Date.now() + STEPUP_CODE_TTL_MINUTES * 60 * 1000).toISOString();
    const challenge = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO oxsteed_credit_stepup_challenges
           (actor_user_id, action_type, amount_cents, currency_code, code_hash, method, max_attempts, expires_at)
         VALUES ($1, $2, $3, $4, NULL, 'totp', $5, $6)
         RETURNING *`,
        [actorUserId, actionType, amount, currency, STEPUP_MAX_ATTEMPTS, expiresAt]
      );
      return rows[0];
    }, 'credit_stepup_issue_totp');
    return { challenge: formatChallenge(challenge), delivery: 'totp' };
  }

  const email = normalizeString(actorEmail, 320);
  if (!email || !email.includes('@')) throw new AppError('A verified email is required for step-up verification', 400, 'credit_stepup_email_required');

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashStepupCode(code);
  const expiresAt = new Date(Date.now() + STEPUP_CODE_TTL_MINUTES * 60 * 1000).toISOString();

  const challenge = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_stepup_challenges
         (actor_user_id, action_type, amount_cents, currency_code, code_hash, method, max_attempts, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'email', $6, $7)
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
 * Verify a presented TOTP code against the actor's authenticator. Throws
 * AppError on any failure. Wrong codes count attempts like the email path.
 * On success the per-admin time-step counter is consumed, so the same
 * 30-second code can never verify twice (replay guard).
 */
async function verifyTotpPresentation(client, { challenge, actorUserId, code }) {
  if (!(await adminTotpEnabled(actorUserId))) {
    throw new AppError('TOTP must be enabled for step-up verification', 403, 'credit_stepup_totp_not_enabled');
  }
  const { rows } = await client.query('SELECT totp_secret FROM users WHERE id = $1', [actorUserId]);
  const encryptedSecret = rows[0]?.totp_secret;
  if (!encryptedSecret) {
    throw new AppError('TOTP is not configured for this account', 403, 'credit_stepup_totp_not_configured');
  }
  let secret;
  try {
    secret = decrypt(encryptedSecret);
  } catch {
    throw new AppError('TOTP verification is unavailable', 503, 'credit_stepup_totp_unavailable');
  }
  if (!secret) {
    throw new AppError('TOTP verification is unavailable', 503, 'credit_stepup_totp_unavailable');
  }
  authenticator.options = { window: 1 };
  const token = String(code).replace(/\D/g, '');
  let verified = false;
  try {
    verified = authenticator.verify({ secret, token });
  } catch {
    verified = false;
  }
  if (!verified) {
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
  // Replay guard: a TOTP code stays valid for its 30-second window, so the
  // same code could otherwise be presented against a second challenge. Each
  // admin consumes at most one TOTP step-up per time-step; the row lock
  // serializes concurrent verifications.
  const counter = Math.floor(Date.now() / (TOTP_TIME_STEP_SECONDS * 1000));
  const { rows: counterRows } = await client.query(
    'SELECT max_counter FROM admin_totp_stepup_counters WHERE user_id = $1 FOR UPDATE',
    [actorUserId]
  );
  const maxCounter = counterRows[0] ? Number(counterRows[0].max_counter) : 0;
  if (counter <= maxCounter) {
    throw new AppError(
      'This verification code was already used. Wait for a new code from your authenticator app.',
      403,
      'credit_stepup_challenge_reused'
    );
  }
  await client.query(
    `INSERT INTO admin_totp_stepup_counters (user_id, max_counter, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET max_counter = EXCLUDED.max_counter, updated_at = NOW()`,
    [actorUserId, counter]
  );
}

/**
 * Verify a presented code. Throws AppError on any failure (missing,
 * expired, consumed, attempts exhausted, wrong code). On success the
 * challenge is consumed (single-use). Wrong attempts are counted and the
 * challenge burns at the attempt limit. TOTP-method challenges verify the
 * code against the actor's authenticator instead of an emailed code hash.
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
    const method = challenge.method || 'email';
    // Defense in depth: TOTP-only action types never verify against an
    // email-issued challenge, including ones issued before the item-12
    // cutover. The emailed code path is dead for these actions.
    if (TOTP_STEPUP_ACTION_TYPES.includes(actionType) && method !== 'totp') {
      throw new AppError('This action requires TOTP step-up verification', 403, 'credit_stepup_challenge_invalid');
    }
    if (method === 'totp') {
      await verifyTotpPresentation(client, { challenge, actorUserId, code: normalizedCode });
    } else {
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
  TOTP_STEPUP_ACTION_TYPES,
  issueStepupChallenge,
  verifyStepupChallenge,
  topupRequiresStepup,
  amountRequiresStepup,
  formatChallenge,
};
