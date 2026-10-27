'use strict';

/**
 * Verified payout destinations for OxSteed Credit cash-out (readiness
 * review bug 5; payroll decision Q24).
 *
 *  - A helper adds a bank account. The account number is encrypted at rest
 *    (utils/encryption) and fingerprinted with a keyed HMAC so one account
 *    used by several users is spotted without storing it in clear.
 *  - Ownership is proven either by two micro-deposits (the helper types
 *    both amounts) or by a one-time 6-digit code carried in the reference
 *    of a deposit. Both travel on OxSteed's in-house bank payout rail, so
 *    only the real account holder can read them.
 *  - The secret is stored only as a salted HMAC; 5 wrong tries fail the
 *    destination; it expires after VERIFICATION_TTL_DAYS.
 *  - Once verified, the FIRST cash-out to the destination waits a cooling
 *    off (default 3 days, OXSTEED_CREDIT_DESTINATION_COOLING_OFF_DAYS).
 *  - Every step emails the owner in their language (creditCompliance/notices).
 *  - A destination whose fingerprint belongs to another user, or whose
 *    holder name does not match the verified name, is held for review and
 *    opens a compliance case instead of being usable.
 */

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { encrypt, decrypt, hashTIN } = require('../utils/encryption');
const { nameSimilarity } = require('./creditCompliance/nameMatching');
const notices = require('./creditCompliance/notices');
const { insertComplianceAudit } = require('./creditCompliance/audit');

const COOLING_OFF_DAYS = Math.max(1, Number.parseInt(process.env.OXSTEED_CREDIT_DESTINATION_COOLING_OFF_DAYS || '3', 10) || 3);
const VERIFICATION_TTL_DAYS = 14;
const MAX_ATTEMPTS = 5;
const HOLDER_NAME_MATCH_THRESHOLD = Number(process.env.OXSTEED_CREDIT_HOLDER_NAME_MATCH_THRESHOLD || '0.85');
const MAX_LIVE_DESTINATIONS = 3;

function clean(value, max) {
  const s = String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s ? s.slice(0, max) : '';
}

function normalizeAccountNumber(value) {
  return String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
}

function fingerprintFor({ countryCode, bankCode, accountNumber }) {
  return hashTIN(`credit-payout-destination:v1:${countryCode}:${(bankCode || '').toUpperCase()}:${normalizeAccountNumber(accountNumber)}`);
}

function secretHash(destinationId, secret) {
  return hashTIN(`credit-payout-destination-secret:v1:${destinationId}:${secret}`);
}

function timingSafeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function microDepositSecret(a, b) {
  return [Number(a), Number(b)].sort((x, y) => x - y).join(',');
}

function view(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    country_code: row.country_code,
    currency_code: row.currency_code,
    holder_name: row.holder_name,
    bank_name: row.bank_name,
    account_last4: row.account_last4,
    verification_method: row.verification_method,
    status: row.status,
    verified_at: row.verified_at || null,
    cooling_off_until: row.cooling_off_until || null,
    first_payout_at: row.first_payout_at || null,
    verification_expires_at: row.verification_expires_at || null,
    attempts_left: Math.max(0, MAX_ATTEMPTS - Number(row.verification_attempts || 0)),
    created_at: row.created_at,
  };
}

function validateInput(input) {
  const errors = {};
  const countryCode = clean(input.countryCode, 2).toUpperCase();
  const currencyCode = clean(input.currencyCode, 3).toUpperCase();
  const holderName = clean(input.holderName, 160);
  const bankName = clean(input.bankName, 160);
  const bankCode = clean(input.bankCode, 40).toUpperCase() || null;
  const accountNumber = normalizeAccountNumber(input.accountNumber);
  const method = input.verificationMethod === 'one_time_code' ? 'one_time_code' : input.verificationMethod === 'micro_deposit' ? 'micro_deposit' : null;
  if (!/^[A-Z]{2}$/.test(countryCode)) errors.country_code = 'destination_country_invalid';
  if (!/^[A-Z]{3}$/.test(currencyCode)) errors.currency_code = 'destination_currency_invalid';
  if (holderName.length < 2) errors.holder_name = 'destination_holder_required';
  if (bankName.length < 2) errors.bank_name = 'destination_bank_required';
  if (!/^[A-Z0-9]{4,34}$/.test(accountNumber)) errors.account_number = 'destination_account_invalid';
  if (bankCode && !/^[A-Z0-9]{2,40}$/.test(bankCode)) errors.bank_code = 'destination_bank_code_invalid';
  if (!method) errors.verification_method = 'destination_method_invalid';
  if (Object.keys(errors).length) throw new AppError('Check the bank account details', 400, 'validation_failed', errors);
  return { countryCode, currencyCode, holderName, bankName, bankCode, accountNumber, method };
}

async function openReviewCase(client, { userId, destinationId, reason, details }) {
  try {
    const { openComplianceCase } = require('./complianceCaseService');
    await openComplianceCase(client, {
      caseType: 'payout_destination_review',
      subjectType: 'customer',
      subjectId: String(userId),
      severity: 'high',
      evidence: { destinationId: String(destinationId), reason, ...details },
      dedupeKey: `payout-destination:${destinationId}:${reason}`,
    });
  } catch (error) {
    // Never silently lose a review: re-throw so the add rolls back.
    logger.error('payout_destination.case_open_failed', { destinationId, error: error.message });
    throw error;
  }
}

/**
 * Add a destination and send its verification deposit(s). Returns the
 * destination view. Idempotent per (user, account): adding the same live
 * account again returns the existing row.
 */
async function addDestination({ user, input, isImpersonated = false, requestIp = null }) {
  if (isImpersonated) throw new AppError('Impersonated sessions cannot change payout accounts', 403, 'impersonation_blocked');
  const v = validateInput(input || {});
  const fingerprint = fingerprintFor(v);
  const result = await withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`credit-payout-destination:${user.id}`]);
    const { rows: existing } = await client.query(
      `SELECT * FROM credit_payout_destinations
        WHERE user_id = $1 AND account_fingerprint = $2
          AND status IN ('pending_verification', 'verified', 'held_for_review')`,
      [user.id, fingerprint]
    );
    if (existing[0]) return { row: existing[0], created: false };
    const { rows: liveCount } = await client.query(
      `SELECT COUNT(*)::int AS n FROM credit_payout_destinations
        WHERE user_id = $1 AND status IN ('pending_verification', 'verified', 'held_for_review')`,
      [user.id]
    );
    if (Number(liveCount[0]?.n || 0) >= MAX_LIVE_DESTINATIONS) {
      throw new AppError('Remove an old payout account first', 409, 'destination_limit_reached', { max: MAX_LIVE_DESTINATIONS });
    }
    const { rows: users } = await client.query('SELECT id, first_name, last_name FROM users WHERE id = $1', [user.id]);
    const legalName = [users[0]?.first_name, users[0]?.last_name].filter(Boolean).join(' ');
    const matchScore = legalName ? Number(nameSimilarity(legalName, v.holderName).toFixed(4)) : 0;
    const { rows: shared } = await client.query(
      `SELECT COUNT(DISTINCT user_id)::int AS n FROM credit_payout_destinations
        WHERE account_fingerprint = $1 AND user_id <> $2 AND status <> 'failed'`,
      [fingerprint, user.id]
    );
    const sharedWithOthers = Number(shared[0]?.n || 0) > 0;
    // Sanctions: the holder name is screened against the in-house lists once
    // they exist. A match holds the account for review (evidence recorded).
    let sanctionsMatch = false;
    const lists = require('./creditCompliance/sanctionsListService');
    if (await lists.counterpartyScreeningActive(client)) {
      const screened = await lists.screenCounterpartyName({
        name: v.holderName, context: { reason: 'payout_destination', customerId: user.id, country: v.countryCode },
      });
      sanctionsMatch = !screened.clear;
    }
    const reviewReason = sanctionsMatch ? 'sanctions_name_match'
      : sharedWithOthers ? 'shared_destination'
        : matchScore < HOLDER_NAME_MATCH_THRESHOLD ? 'holder_name_mismatch' : null;
    const encrypted = encrypt(JSON.stringify({ accountNumber: v.accountNumber, bankCode: v.bankCode, bankName: v.bankName, holderName: v.holderName }));
    const { rows } = await client.query(
      `INSERT INTO credit_payout_destinations
         (user_id, country_code, currency_code, holder_name, bank_name, bank_code, account_last4,
          account_fingerprint, encrypted_details, verification_method, status,
          holder_name_match_score, review_reason, verification_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW() + ($14::int * INTERVAL '1 day'))
       RETURNING *`,
      [user.id, v.countryCode, v.currencyCode, v.holderName, v.bankName, v.bankCode, v.accountNumber.slice(-4),
        fingerprint, encrypted, v.method, reviewReason ? 'held_for_review' : 'pending_verification',
        matchScore, reviewReason, VERIFICATION_TTL_DAYS]
    );
    const row = rows[0];
    if (reviewReason) {
      await openReviewCase(client, { userId: user.id, destinationId: row.id, reason: reviewReason, details: { matchScore, sharedWithOthers, sanctionsMatch } });
    }
    await queueVerification(client, row);
    await insertComplianceAudit(client, {
      actionType: 'credit.payout_destination.added',
      actorUserId: user.id,
      customerId: user.id,
      resourceType: 'credit_payout_destination',
      resourceId: String(row.id),
      reason: reviewReason ? `Added; held for review (${reviewReason})` : 'Added; verification sent',
      requestIp,
      afterState: { status: row.status, method: v.method, last4: row.account_last4, matchScore },
    });
    // Licence readiness §5: a new destination is a re-verification trigger.
    try {
      const kyc = require('./creditCompliance/kycRequirementsService');
      await kyc.recordTrigger(client, { userId: user.id, trigger: 'new_payout_destination', sourceId: String(row.id) });
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
    return { row, created: true };
  }, 'credit_payout_destination_add');
  if (result.created) {
    await notices.sendUserNotice({
      userId: user.id,
      key: result.row.verification_method === 'one_time_code' ? 'destination_one_time_code' : 'destination_micro_deposit',
      params: { last4: result.row.account_last4, bank: result.row.bank_name, days: COOLING_OFF_DAYS },
      idempotencyKey: `credit-destination:${result.row.id}:verification`,
    });
  }
  return view(result.row);
}

/**
 * Create the verification deposit instruction(s) for a destination on the
 * in-house bank payout rail and store the secret hash.
 */
async function queueVerification(client, row) {
  const bankPayout = require('./creditBankPayoutService');
  let secret;
  if (row.verification_method === 'micro_deposit') {
    const a = crypto.randomInt(1, 100);
    let b = crypto.randomInt(1, 100);
    while (b === a) b = crypto.randomInt(1, 100);
    secret = microDepositSecret(a, b);
    await bankPayout.createInstruction(client, { purpose: 'micro_deposit', idempotencyKey: `credit-destination:${row.id}:micro:1`, destination: row, amountMinor: a, paymentReference: 'OXSTEED VERIFY' });
    await bankPayout.createInstruction(client, { purpose: 'micro_deposit', idempotencyKey: `credit-destination:${row.id}:micro:2`, destination: row, amountMinor: b, paymentReference: 'OXSTEED VERIFY' });
  } else {
    secret = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await bankPayout.createInstruction(client, { purpose: 'verification_code', idempotencyKey: `credit-destination:${row.id}:code`, destination: row, amountMinor: 1, paymentReference: `OXSTEED CODE ${secret}` });
  }
  await client.query(
    `UPDATE credit_payout_destinations
        SET verification_secret_hash = $2, verification_sent_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [row.id, secretHash(row.id, secret)]
  );
}

/** Helper submits the two amounts (minor units) or the code. */
async function verifyDestination({ user, destinationId, amounts = null, code = null, isImpersonated = false, requestIp = null }) {
  if (isImpersonated) throw new AppError('Impersonated sessions cannot change payout accounts', 403, 'impersonation_blocked');
  const outcome = await withTransaction(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM credit_payout_destinations WHERE id = $1 AND user_id = $2 FOR UPDATE', [destinationId, user.id]);
    const row = rows[0];
    if (!row) throw new AppError('Payout account not found', 404, 'destination_not_found');
    if (row.status === 'verified') return { row, verified: false, already: true };
    if (row.status !== 'pending_verification') throw new AppError('This payout account cannot be confirmed', 409, 'destination_not_verifiable', { status: row.status });
    if (row.verification_expires_at && new Date(row.verification_expires_at) <= new Date()) {
      const { rows: failed } = await client.query(
        `UPDATE credit_payout_destinations SET status = 'failed', disabled_reason = 'verification_expired', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [row.id]
      );
      return { row: failed[0], verified: false, error: 'destination_verification_expired' };
    }
    let secret = null;
    if (row.verification_method === 'micro_deposit') {
      const list = Array.isArray(amounts) ? amounts.map(Number) : [];
      if (list.length === 2 && list.every((n) => Number.isSafeInteger(n) && n > 0 && n < 100)) secret = microDepositSecret(list[0], list[1]);
    } else if (/^\d{6}$/.test(String(code || '').trim())) {
      secret = String(code).trim();
    }
    if (!secret) throw new AppError('Enter the deposit amounts or code', 400, 'validation_failed', { verification: 'destination_secret_required' });
    const ok = timingSafeEqualHex(secretHash(row.id, secret), String(row.verification_secret_hash || ''));
    if (!ok) {
      const attempts = Number(row.verification_attempts || 0) + 1;
      const { rows: updated } = await client.query(
        `UPDATE credit_payout_destinations
            SET verification_attempts = $2::smallint,
                status = CASE WHEN $2::int >= $3::int THEN 'failed' ELSE status END,
                disabled_reason = CASE WHEN $2::int >= $3::int THEN 'too_many_attempts' ELSE disabled_reason END,
                updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [row.id, attempts, MAX_ATTEMPTS]
      );
      return { row: updated[0], verified: false, error: attempts >= MAX_ATTEMPTS ? 'destination_verification_locked' : 'destination_verification_mismatch' };
    }
    const { rows: verified } = await client.query(
      `UPDATE credit_payout_destinations
          SET status = 'verified', verified_at = NOW(),
              cooling_off_until = NOW() + ($2::int * INTERVAL '1 day'),
              verification_secret_hash = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [row.id, COOLING_OFF_DAYS]
    );
    await insertComplianceAudit(client, {
      actionType: 'credit.payout_destination.verified',
      actorUserId: user.id,
      customerId: user.id,
      resourceType: 'credit_payout_destination',
      resourceId: String(row.id),
      reason: 'Ownership verified',
      requestIp,
      afterState: { coolingOffUntil: verified[0].cooling_off_until },
    });
    return { row: verified[0], verified: true };
  }, 'credit_payout_destination_verify');
  if (outcome.verified) {
    await notices.sendUserNotice({
      userId: user.id,
      key: 'destination_verified',
      params: { last4: outcome.row.account_last4, date: new Date(outcome.row.cooling_off_until).toISOString() },
      idempotencyKey: `credit-destination:${outcome.row.id}:verified`,
    });
  }
  if (outcome.error) {
    throw new AppError('That does not match', 409, outcome.error, { attempts_left: Math.max(0, MAX_ATTEMPTS - Number(outcome.row.verification_attempts || 0)) });
  }
  return view(outcome.row);
}

async function listDestinations(user) {
  const { rows } = await pool.query(
    `SELECT * FROM credit_payout_destinations WHERE user_id = $1 AND status <> 'disabled' ORDER BY created_at DESC LIMIT 20`,
    [user.id]
  );
  return rows.map(view);
}

async function disableDestination({ user, destinationId, isImpersonated = false }) {
  if (isImpersonated) throw new AppError('Impersonated sessions cannot change payout accounts', 403, 'impersonation_blocked');
  return withTransaction(pool, async (client) => {
    const { rows: open } = await client.query(
      `SELECT 1 FROM credit_cashout_requests WHERE destination_id = $1 AND status IN ('requested', 'held_for_review', 'submitting', 'submitted') LIMIT 1`,
      [destinationId]
    );
    if (open[0]) throw new AppError('A cash-out to this account is in progress', 409, 'destination_in_use');
    const { rows } = await client.query(
      `UPDATE credit_payout_destinations SET status = 'disabled', disabled_at = NOW(), disabled_reason = 'owner_removed', updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND status <> 'disabled' RETURNING *`,
      [destinationId, user.id]
    );
    if (!rows[0]) throw new AppError('Payout account not found', 404, 'destination_not_found');
    return view(rows[0]);
  }, 'credit_payout_destination_disable');
}

/**
 * Load a destination usable for a payout by this user, locking it. Throws
 * when not verified. Returns { row, availableAt } where availableAt is the
 * cooling-off end for the first payout, else now.
 */
async function loadPayableDestination(client, { userId, destinationId, currency, countryCode }) {
  const { rows } = await client.query('SELECT * FROM credit_payout_destinations WHERE id = $1 AND user_id = $2 FOR UPDATE', [destinationId, userId]);
  const row = rows[0];
  if (!row) throw new AppError('Choose a confirmed payout account', 400, 'validation_failed', { destination_id: 'cashout_destination_required' });
  if (row.status !== 'verified') throw new AppError('Confirm this payout account first', 409, 'cashout_destination_unverified', { status: row.status });
  if (currency && row.currency_code !== currency) throw new AppError('This account is in another currency', 409, 'cashout_destination_currency_mismatch');
  if (countryCode && row.country_code !== countryCode) throw new AppError('This account is in another country', 409, 'cashout_destination_country_mismatch');
  const coolingEnd = row.first_payout_at ? null : new Date(row.cooling_off_until);
  const availableAt = coolingEnd && coolingEnd > new Date() ? coolingEnd : new Date();
  return { row, availableAt, firstPayout: !row.first_payout_at };
}

/** Decrypt for the bank export only. */
function decryptDetails(row) {
  return JSON.parse(decrypt(row.encrypted_details));
}

module.exports = {
  COOLING_OFF_DAYS,
  MAX_ATTEMPTS,
  fingerprintFor,
  secretHash,
  microDepositSecret,
  addDestination,
  verifyDestination,
  listDestinations,
  disableDestination,
  loadPayableDestination,
  decryptDetails,
  view,
  validateInput,
};
