'use strict';

/**
 * Gated OxSteed Credit cash-out for helpers (decision #14, hardened for
 * licence readiness — review bugs 1, 2, 5, 10 and §4/§5):
 *
 *  Eligibility
 *   - identity verified with Didit AND an unexpired Credit KYC tier of at
 *     least OXSTEED_CREDIT_CASHOUT_MIN_KYC_TIER (default 2), with no open
 *     re-verification requirement;
 *   - sanctions clear (fail closed when screening is unavailable);
 *   - funds earned in the last `cashout_hold_days` are not withdrawable;
 *   - per-country policy caps plus per-currency / per-country limit data
 *     (cash_out_transaction, daily_cash_out);
 *   - only through a configured payout partner for the country (Haiti: the
 *     OxSteed in-house bank rail); elsewhere Credit is spend-only;
 *   - only to a VERIFIED payout destination; the first payout to a new
 *     destination waits for its cooling-off (3 days).
 *
 *  Money safety
 *   - funds are RESERVED on the helper's partner_payable account when the
 *     request is made, so the balance can never be spent twice and never
 *     goes negative (the DB also forbids a negative helper balance);
 *   - the worker CLAIMS due requests with a lease ('submitting') under
 *     FOR UPDATE SKIP LOCKED and calls the partner with a stable
 *     partner_idempotency_key, so a crash or a second worker can never pay
 *     twice; the in-house rail files its instruction inside the same
 *     transaction (outbox);
 *   - when the partner confirms 'paid', the reservation is released and the
 *     cash_out journal (helper partner_payable -> platform_treasury) is
 *     posted in ONE transaction and its UUID recorded; on failure the
 *     reservation is released and the helper is told the money is back.
 *
 *  Review
 *   - real-time rules can hold a request ('held_for_review'); release needs
 *     two administrators (oversight action 'credit_cashout_release'); a
 *     single administrator may reject (which only returns the money).
 */

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const flags = require('./paymentLayerFlags');
const railPolicy = require('./paymentRailPolicy');
const partners = require('./payoutPartners');
const { resolveLimitMinor } = require('./creditCompliance/limitRules');
const { insertComplianceAudit } = require('./creditCompliance/audit');

const MIN_KYC_TIER = Math.min(2, Math.max(0, Number.parseInt(process.env.OXSTEED_CREDIT_CASHOUT_MIN_KYC_TIER || '2', 10)));
const LEASE_SECONDS = 300;
const MAX_SUBMIT_ATTEMPTS = 8;
const OPEN_STATUSES = Object.freeze(['requested', 'held_for_review', 'submitting', 'submitted']);

function assertEnabled() {
  if (!flags.isEnabled('CREDIT_CASHOUT')) throw new AppError('Cash-out is not available', 404, 'feature_disabled');
}

function rowsOf(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function loadHelper(client, userId) {
  const { rows } = await client.query('SELECT id, country, didit_status, preferred_language, first_name, last_name FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new AppError('User not found', 404, 'user_not_found');
  return rows[0];
}

async function partnerLedger(client, userId) {
  const { resolveSpendParticipant } = require('./creditSpendAdapter');
  let partnerId;
  try {
    ({ partnerId } = await resolveSpendParticipant(client, { type: 'helper', subjectId: String(userId) }, null));
  } catch {
    return null;
  }
  const { rows } = await client.query(
    `SELECT a.id AS account_id, a.balance_cents, a.reserved_cents, a.currency_code, a.partner_id
       FROM oxsteed_credit_accounts a
      WHERE a.partner_id = $1 AND a.account_type = 'partner_payable' AND a.status = 'active'
      ORDER BY a.id LIMIT 1`,
    [partnerId]
  );
  return rows[0] ? { ...rows[0], partner_id: partnerId } : null;
}

async function kycStatus(client, userId) {
  const { getCustomerVerificationTier } = require('./identityVerificationService');
  const tier = await getCustomerVerificationTier(client, userId);
  let reverification = null;
  try {
    const kyc = require('./creditCompliance/kycRequirementsService');
    reverification = await kyc.getOpenRequirement(client, userId);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  return { tier: Number(tier?.tier || 0), reverification };
}

/** Everything the UI needs to show (or hide) cash-out. */
async function getEligibility(client, userId) {
  const helper = await loadHelper(client, userId);
  const country = railPolicy.helperCountry(helper);
  const policy = await railPolicy.getCountryPolicy(client, country);
  const partner = partners.getPartner(policy?.cashout_partner);
  const base = {
    country, partner: partner?.name || null, currency: null, balance_minor: 0, available_minor: 0,
    hold_days: Number(policy?.cashout_hold_days ?? 7), min_kyc_tier: MIN_KYC_TIER, kyc_tier: null,
    stepup_from_minor: null, cooling_off_days: require('./creditPayoutDestinationService').COOLING_OFF_DAYS,
  };
  if (!policy || !partner || !partner.isConfigured() || !partner.countries.includes(country)) return { ...base, available: false, reason: 'cashout_unavailable_spend_only' };
  if (String(helper.didit_status || '').toLowerCase() !== 'verified') return { ...base, available: false, reason: 'cashout_identity_required' };
  const kyc = await kycStatus(client, userId);
  if (kyc.tier < MIN_KYC_TIER) return { ...base, kyc_tier: kyc.tier, available: false, reason: 'cashout_kyc_tier_required' };
  if (kyc.reverification) return { ...base, kyc_tier: kyc.tier, available: false, reason: 'cashout_reverification_required' };
  const ledger = await partnerLedger(client, userId);
  if (!ledger) return { ...base, kyc_tier: kyc.tier, available: false, reason: 'cashout_no_balance' };
  const currency = String(ledger.currency_code).trim().toUpperCase();
  const holdDays = Number(policy.cashout_hold_days ?? 7);
  const { rows: recent } = await client.query(
    `SELECT COALESCE(SUM(amount_minor - platform_fee_minor), 0)::bigint AS n FROM job_credit_payments
      WHERE helper_id = $1 AND status = 'captured' AND currency = $2 AND captured_at > NOW() - ($3::int * INTERVAL '1 day')`,
    [userId, currency, holdDays]
  );
  const { rows: tips } = await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS n FROM job_tips
      WHERE helper_id = $1 AND rail = 'credit' AND status = 'succeeded' AND currency = $2 AND updated_at > NOW() - ($3::int * INTERVAL '1 day')`,
    [userId, currency, holdDays]
  );
  const { rows: used } = await client.query(
    `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE created_at > NOW() - INTERVAL '1 day'), 0)::bigint AS day,
            COALESCE(SUM(amount_minor) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'), 0)::bigint AS month
       FROM credit_cashout_requests
      WHERE user_id = $1 AND status IN ('requested', 'held_for_review', 'submitting', 'submitted', 'paid')`,
    [userId]
  );
  const limitScope = { currency, country };
  const perTransaction = resolveLimitMinor('cash_out_transaction', limitScope);
  const dailyLimit = resolveLimitMinor('daily_cash_out', limitScope);
  const balance = Number(ledger.balance_cents);
  const reserved = Number(ledger.reserved_cents || 0);
  // Reserved funds already cover every open request (they are reserved at
  // request time), so they are subtracted once, here.
  let available = balance - reserved - Number(recent[0].n) - Number(tips[0].n);
  if (policy.cashout_daily_cap_minor) available = Math.min(available, Number(policy.cashout_daily_cap_minor) - Number(used[0].day));
  if (policy.cashout_monthly_cap_minor) available = Math.min(available, Number(policy.cashout_monthly_cap_minor) - Number(used[0].month));
  available = Math.min(available, dailyLimit - Number(used[0].day), perTransaction);
  available = Math.max(0, available);
  return {
    ...base, kyc_tier: kyc.tier, available: available > 0, reason: available > 0 ? null : 'cashout_nothing_available', currency,
    balance_minor: balance, reserved_minor: reserved, available_minor: available,
    stepup_from_minor: resolveLimitMinor('stepup_threshold', limitScope),
    ledger: { ...ledger, currency_code: currency }, policy, partnerAdapter: partner,
  };
}

function publicEligibility(e) {
  const { ledger, policy, partnerAdapter, ...rest } = e;
  return rest;
}

async function eligibility(user) {
  assertEnabled();
  return publicEligibility(await getEligibility(pool, user.id));
}

function requestFingerprint({ userId, amount, destinationId }) {
  return crypto.createHash('sha256').update(`credit-cashout:v1:${userId}:${amount}:${destinationId}`).digest('hex');
}

/**
 * Real-time review rules for a cash-out (AML §4). Returns a review reason
 * or null. Kept deliberately small and data-driven; the batch monitor runs
 * the wider rule set.
 */
async function realTimeReviewReason(client, { userId, amount, currency, country, destination }) {
  const reviewFloor = resolveLimitMinor('helper_cashout_review', { currency, country });
  if (destination.firstPayout && amount >= reviewFloor) return 'first_payout_large';
  try {
    const aml = require('./creditCompliance/amlRules');
    return await aml.cashoutReviewReason(client, { userId, amount, currency, country, destinationId: destination.row.id });
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  return null;
}

async function requestCashout({ user, amountMinor, destinationId, idempotencyKey, isImpersonated = false, stepupChallengeId = null, stepupCode = null, requestIp = null }) {
  assertEnabled();
  if (isImpersonated) throw new AppError('Impersonated sessions cannot move money', 403, 'impersonation_blocked');
  const amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('Enter an amount', 400, 'validation_failed', { amount_minor: 'cashout_amount_invalid' });
  const destId = String(destinationId || '').trim();
  if (!/^\d{1,18}$/.test(destId)) throw new AppError('Choose a confirmed payout account', 400, 'validation_failed', { destination_id: 'cashout_destination_required' });
  if (!idempotencyKey) throw new AppError('Idempotency-Key is required', 400, 'idempotency_key_required');
  const { assertCreditRailEnabled } = require('./oxsteedCreditService');
  await assertCreditRailEnabled(pool);
  const fingerprint = requestFingerprint({ userId: user.id, amount, destinationId: destId });

  // Replays return the original receipt before any step-up is demanded.
  const { rows: prior } = await pool.query('SELECT * FROM credit_cashout_requests WHERE idempotency_key = $1', [idempotencyKey]);
  if (prior[0]) return replay(prior[0], user, fingerprint);

  // Step-up for large amounts, in the payout currency.
  const pre = await getEligibility(pool, user.id);
  if (pre.currency && amount >= Number(pre.stepup_from_minor)) {
    const { verifyStepupChallenge } = require('./stepupChallengeService');
    await verifyStepupChallenge({ challengeId: stepupChallengeId, actorUserId: user.id, actionType: 'helper_cashout', code: stepupCode });
  }

  const result = await withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`credit-cashout:${user.id}`]);
    const { rows: existing } = await client.query('SELECT * FROM credit_cashout_requests WHERE idempotency_key = $1', [idempotencyKey]);
    if (existing[0]) return { row: replay(existing[0], user, fingerprint), replayed: true };
    const e = await getEligibility(client, user.id);
    if (!e.available && e.reason !== 'cashout_nothing_available') throw new AppError('Cash-out is not available', 409, e.reason);
    if (amount > e.available_minor) throw new AppError('That is more than you can cash out right now', 409, 'cashout_exceeds_available', { available_minor: e.available_minor });

    const { assertSanctionsClear } = require('./sanctionsScreeningService');
    await assertSanctionsClear(client, { subjectType: 'customer', subjectId: user.id });

    const destinations = require('./creditPayoutDestinationService');
    const destination = await destinations.loadPayableDestination(client, { userId: user.id, destinationId: destId, currency: e.currency, countryCode: e.country });
    const sanctions = require('./sanctionsScreeningService');
    if (typeof sanctions.assertCounterpartyNameClear === 'function') {
      await sanctions.assertCounterpartyNameClear(client, {
        subjectType: 'payout_destination', subjectId: String(destination.row.id), name: destination.row.holder_name, country: destination.row.country_code, ownerUserId: user.id,
      });
    }

    const reviewReason = await realTimeReviewReason(client, { userId: user.id, amount, currency: e.currency, country: e.country, destination });
    const { rows } = await client.query(
      `INSERT INTO credit_cashout_requests
         (user_id, credit_partner_id, country_code, partner_name, amount_minor, currency, destination_ref,
          destination_id, available_at, idempotency_key, partner_idempotency_key, request_fingerprint, kyc_tier,
          status, review_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [user.id, e.ledger.partner_id, e.country, e.partner, amount, e.currency,
        `destination:${destination.row.id}:${destination.row.account_last4}`, destination.row.id,
        destination.availableAt.toISOString(), idempotencyKey, `oxsteed-cashout:${crypto.randomUUID()}`, fingerprint, e.kyc_tier,
        reviewReason ? 'held_for_review' : 'requested', reviewReason]
    );
    let row = rows[0];
    const { reserveFunds } = require('./oxsteedCreditReservationService');
    const { reservation } = await reserveFunds(client, {
      accountId: e.ledger.account_id, reservationType: 'cash_out', referenceType: 'credit_cashout', referenceId: String(row.id), amountCents: amount,
    });
    const { rows: updated } = await client.query(
      `UPDATE credit_cashout_requests SET reservation_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [row.id, reservation.id]
    );
    row = updated[0];
    if (reviewReason) {
      const { openComplianceCase } = require('./complianceCaseService');
      await openComplianceCase(client, {
        caseType: 'cashout_review', subjectType: 'customer', subjectId: String(user.id), severity: 'medium',
        evidence: { cashoutId: String(row.id), reason: reviewReason, amountMinor: amount, currency: e.currency },
        dedupeKey: `credit-cashout:${row.id}:review`,
      });
    }
    await insertComplianceAudit(client, {
      actionType: 'credit.cashout.requested', actorUserId: user.id, customerId: user.id, partnerId: e.ledger.partner_id,
      resourceType: 'credit_cashout', resourceId: String(row.id),
      reason: reviewReason ? `Requested; held for review (${reviewReason})` : 'Requested', requestIp,
      afterState: { amountMinor: amount, currency: e.currency, destinationId: String(destination.row.id), availableAt: row.available_at, status: row.status },
    });
    return { row: view(row), replayed: false, held: Boolean(reviewReason), raw: row };
  }, 'credit_cashout_request');
  if (result.held) {
    const notices = require('./creditCompliance/notices');
    await notices.sendUserNotice({ userId: user.id, key: 'cashout_held_for_review', params: { amount_minor: Number(result.raw.amount_minor), currency: result.raw.currency }, idempotencyKey: `credit-cashout:${result.raw.id}:held` });
  }
  return result.row;
}

// Review bug 9: a replay must match the full request (owner, amount,
// destination), not just the key.
function replay(row, user, fingerprint) {
  if (String(row.user_id) !== String(user.id) || row.request_fingerprint !== fingerprint) {
    throw new AppError('This Idempotency-Key was used for a different cash-out', 409, 'cashout_idempotency_conflict');
  }
  return view(row);
}

function view(row) {
  return {
    id: String(row.id), status: row.status, amount_minor: Number(row.amount_minor), currency: row.currency,
    partner: row.partner_name, failure_code: row.failure_code || null, created_at: row.created_at,
    available_at: row.available_at || null, destination_id: row.destination_id ? String(row.destination_id) : null,
    review_reason: row.status === 'held_for_review' ? 'cashout_under_review' : null,
  };
}

async function listCashouts(user) {
  assertEnabled();
  const { rows } = await pool.query('SELECT * FROM credit_cashout_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 50', [user.id]);
  return rows.map(view);
}

async function postCashOutJournal(client, row) {
  const credit = require('./oxsteedCreditService');
  const payable = await credit.ensureAccount(client, { accountType: 'partner_payable', partnerId: row.credit_partner_id, currencyCode: row.currency });
  const treasury = await credit.ensureAccount(client, { accountType: 'platform_treasury', currencyCode: row.currency });
  const tx = await credit.postJournalTransaction(client, {
    transactionType: 'cash_out', debitAccountId: payable.id, creditAccountId: treasury.id, amountCents: Number(row.amount_minor),
    currencyCode: row.currency, partnerId: row.credit_partner_id, idempotencyKey: `credit-cashout:${row.id}`, actorType: 'system',
    actorUserId: null, referenceType: 'credit_cashout', referenceId: String(row.id), reason: 'Helper cash-out paid',
    description: `Credit cash-out via ${row.partner_name}`,
    metadata: { cashoutId: String(row.id) },
  });
  const id = tx?.transaction?.id || null;
  if (!id) throw new AppError('Cash-out journal was not posted', 500, 'cashout_journal_missing');
  return id;
}

async function releaseFunds(client, row, reason) {
  const { releaseReservation } = require('./oxsteedCreditReservationService');
  if (row.reservation_id) {
    await releaseReservation(client, { reservationId: row.reservation_id, reason });
  } else {
    await releaseReservation(client, { referenceType: 'credit_cashout', referenceId: String(row.id), reason });
  }
}

/**
 * Apply a partner outcome inside the caller's transaction. `leaseToken`,
 * when given, must match (a worker whose lease expired cannot settle).
 * Returns the terminal status reached, or null when nothing changed.
 */
async function settleInTransaction(client, cashoutId, outcome, { leaseToken = null } = {}) {
  const { rows } = await client.query('SELECT * FROM credit_cashout_requests WHERE id = $1 FOR UPDATE', [cashoutId]);
  const current = rows[0];
  if (!current || !['requested', 'submitting', 'submitted'].includes(current.status)) return null;
  if (leaseToken && current.status === 'submitting' && String(current.lease_token) !== String(leaseToken)) return null;
  if (outcome.status === 'paid') {
    await releaseFunds(client, current, 'cash-out paid');
    const txId = await postCashOutJournal(client, current);
    await client.query(
      `UPDATE credit_cashout_requests
          SET status = 'paid', partner_reference = COALESCE($2, partner_reference), journal_transaction_id = $3,
              lease_token = NULL, lease_expires_at = NULL, released_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [current.id, outcome.reference ? String(outcome.reference).slice(0, 160) : null, txId]
    );
    if (current.destination_id) {
      await client.query('UPDATE credit_payout_destinations SET first_payout_at = COALESCE(first_payout_at, NOW()), updated_at = NOW() WHERE id = $1', [current.destination_id]);
    }
    await insertComplianceAudit(client, {
      actionType: 'credit.cashout.paid', customerId: current.user_id, partnerId: current.credit_partner_id,
      resourceType: 'credit_cashout', resourceId: String(current.id), reason: 'Partner confirmed payout',
      afterState: { journalTransactionId: txId, reference: outcome.reference || null },
    });
    return 'paid';
  }
  if (outcome.status === 'failed') {
    await releaseFunds(client, current, `cash-out failed: ${outcome.failureCode || 'partner_failed'}`);
    await client.query(
      `UPDATE credit_cashout_requests
          SET status = 'failed', failure_code = $2, lease_token = NULL, lease_expires_at = NULL,
              released_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [current.id, String(outcome.failureCode || 'partner_failed').slice(0, 80)]
    );
    await insertComplianceAudit(client, {
      actionType: 'credit.cashout.failed', customerId: current.user_id, partnerId: current.credit_partner_id,
      resourceType: 'credit_cashout', resourceId: String(current.id), reason: String(outcome.failureCode || 'partner_failed'),
    });
    return 'failed';
  }
  await client.query(
    `UPDATE credit_cashout_requests
        SET status = 'submitted', partner_reference = COALESCE($2, partner_reference),
            submitted_at = COALESCE(submitted_at, NOW()), lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
      WHERE id = $1`,
    [current.id, outcome.reference ? String(outcome.reference).slice(0, 160) : null]
  );
  return current.status === 'submitted' ? null : 'submitted';
}

async function settle(row, outcome, options = {}) {
  const status = await withTransaction(pool, (client) => settleInTransaction(client, row.id, outcome, options), 'credit_cashout_settle');
  if (status === 'paid' || status === 'failed') await notify(row, status).catch((err) => logger.warn('cashout.notify_failed', { error: err.message }));
  return status;
}

async function notify(row, status) {
  const templates = require('./notificationTemplates');
  const { sendNotification } = require('./notificationService');
  const recipient = await templates.loadRecipient(pool, row.user_id);
  const copy = templates.render(status === 'paid' ? 'cashout_paid' : 'cashout_failed', recipient, { amount_minor: Number(row.amount_minor), currency: row.currency });
  return sendNotification({ userId: row.user_id, type: `credit_cashout_${status}`, title: copy.title, body: copy.body, data: { cashout_id: String(row.id) }, action_url: '/wallet', idempotencyKey: `credit-cashout:${row.id}:${status}` });
}

/**
 * Claim due requests (and requests whose lease expired) with a fresh lease.
 * Only one worker can hold a row; the lease token fences late writers.
 */
async function claimDueCashouts(limit) {
  const leaseToken = crypto.randomUUID();
  const { rows } = await pool.query(
    `UPDATE credit_cashout_requests c
        SET status = 'submitting', lease_token = $1,
            lease_expires_at = NOW() + ($3::int * INTERVAL '1 second'),
            submit_attempts = c.submit_attempts + 1, updated_at = NOW()
      WHERE c.id IN (
        SELECT id FROM credit_cashout_requests
         WHERE (status = 'requested' AND available_at <= NOW())
            OR (status = 'submitting' AND lease_expires_at < NOW())
         ORDER BY id
         LIMIT $2
         FOR UPDATE SKIP LOCKED)
      RETURNING c.*`,
    [leaseToken, limit, LEASE_SECONDS]
  );
  return rowsOf({ rows });
}

async function holdUnknownOutcome(row, reason) {
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `UPDATE credit_cashout_requests
          SET status = 'held_for_review', review_reason = $2, lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND status = 'submitting' AND lease_token = $3 RETURNING *`,
      [row.id, reason, row.lease_token]
    );
    if (!rows[0]) return;
    const { openComplianceCase } = require('./complianceCaseService');
    await openComplianceCase(client, {
      caseType: 'cashout_review', subjectType: 'customer', subjectId: String(row.user_id), severity: 'high',
      evidence: { cashoutId: String(row.id), reason, attempts: row.submit_attempts },
      dedupeKey: `credit-cashout:${row.id}:${reason}`,
    });
  }, 'credit_cashout_hold_unknown');
}

async function submitClaimed(row) {
  const partner = partners.getPartner(row.partner_name);
  if (!partner || !partner.isConfigured()) {
    // Partner switched off after the request: give the row back untouched.
    await pool.query(
      `UPDATE credit_cashout_requests SET status = 'requested', lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2`,
      [row.id, row.lease_token]
    );
    return false;
  }
  if (Number(row.submit_attempts) > MAX_SUBMIT_ATTEMPTS) {
    // The partner may or may not have paid; never retry blindly forever.
    await holdUnknownOutcome(row, 'partner_outcome_unknown');
    return false;
  }
  if (partner.inHouse) {
    // In-house rail: the instruction and the 'submitted' state commit
    // together under the row lock (transactional outbox).
    await withTransaction(pool, async (client) => {
      const { rows } = await client.query('SELECT * FROM credit_cashout_requests WHERE id = $1 FOR UPDATE', [row.id]);
      const current = rows[0];
      if (!current || current.status !== 'submitting' || String(current.lease_token) !== String(row.lease_token)) return;
      const { rows: dest } = await client.query('SELECT * FROM credit_payout_destinations WHERE id = $1', [current.destination_id]);
      if (!dest[0] || dest[0].status !== 'verified') {
        await settleInTransaction(client, current.id, { status: 'failed', failureCode: 'destination_not_verified' }, { leaseToken: row.lease_token });
        return;
      }
      const outcome = await partner.submitPayout({
        client, requestId: String(current.id), amountMinor: Number(current.amount_minor), currency: current.currency,
        destination: dest[0], userId: String(current.user_id), idempotencyKey: current.partner_idempotency_key,
      });
      await settleInTransaction(client, current.id, outcome || { status: 'submitted' }, { leaseToken: row.lease_token });
    }, 'credit_cashout_submit_in_house');
    return true;
  }
  // External partner: the call happens while we hold the lease; the stable
  // idempotency key makes a retry after a crash safe at the partner.
  const { rows: dest } = await pool.query('SELECT * FROM credit_payout_destinations WHERE id = $1', [row.destination_id]);
  const outcome = await partner.submitPayout({
    requestId: String(row.id), amountMinor: Number(row.amount_minor), currency: row.currency,
    destination: dest[0] || null, userId: String(row.user_id), idempotencyKey: row.partner_idempotency_key,
  });
  await settle(row, outcome || { status: 'submitted' }, { leaseToken: row.lease_token });
  return true;
}

/** Worker: submit due requests and poll submitted ones. */
async function processCashouts(limit = 50) {
  if (!flags.isEnabled('CREDIT_CASHOUT')) return 0;
  let handled = 0;
  // New submissions stop while the Credit rail is off; settling payouts
  // already in flight continues so helpers are not left in limbo.
  const { isCreditRailEnabled } = require('./oxsteedCreditService');
  const railOn = await isCreditRailEnabled(pool).catch(() => false);
  if (railOn) {
    for (const row of await claimDueCashouts(limit)) {
      try {
        if (await submitClaimed(row)) handled += 1;
      } catch (err) {
        // Lease stays; it expires and the same idempotency key is retried.
        logger.warn('cashout.partner_error', { cashoutId: row.id, partner: row.partner_name, code: err.code, error: err.message });
      }
    }
  }
  const { rows: submitted } = await pool.query(
    `SELECT * FROM credit_cashout_requests WHERE status = 'submitted' ORDER BY updated_at LIMIT $1`,
    [limit]
  );
  for (const row of submitted) {
    const partner = partners.getPartner(row.partner_name);
    if (!partner || typeof partner.getPayoutStatus !== 'function') continue;
    try {
      const outcome = await partner.getPayoutStatus({ requestId: String(row.id), reference: row.partner_reference });
      if (outcome && outcome.status && outcome.status !== 'submitted') {
        await settle(row, outcome);
        handled += 1;
      }
    } catch (err) {
      logger.warn('cashout.partner_status_error', { cashoutId: row.id, partner: row.partner_name, code: err.code, error: err.message });
    }
  }
  return handled;
}

// ── Review of held requests ─────────────────────────────────────────────

async function listHeldCashouts({ limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT c.*, u.email FROM credit_cashout_requests c JOIN users u ON u.id = c.user_id
      WHERE c.status = 'held_for_review' ORDER BY c.created_at LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  return rows.map((r) => ({ ...view(r), user_id: r.user_id, email: r.email, review_reason: r.review_reason, submit_attempts: Number(r.submit_attempts) }));
}

/** Oversight executor (two admins): release a held request for payout. */
async function releaseHeldCashout({ client, payload, actorUserId, requestedBy }) {
  const { rows } = await client.query('SELECT * FROM credit_cashout_requests WHERE id = $1 FOR UPDATE', [payload.cashoutId]);
  const row = rows[0];
  if (!row) throw new AppError('Cash-out not found', 404, 'cashout_not_found');
  if (row.status !== 'held_for_review') throw new AppError('Cash-out is not held', 409, 'cashout_not_held');
  // An unknown partner outcome goes back to 'submitted' (poll), never to a
  // fresh submission; anything else is queued for submission.
  const next = row.review_reason === 'partner_outcome_unknown' ? 'submitted' : 'requested';
  await client.query(
    `UPDATE credit_cashout_requests SET status = $2, review_reason = NULL, updated_at = NOW() WHERE id = $1`,
    [row.id, next]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.cashout.released', actorUserId, customerId: row.user_id, resourceType: 'credit_cashout', resourceId: String(row.id),
    reason: String(payload.reason || 'Released after review').slice(0, 1000), metadata: { requestedBy, approvedBy: actorUserId, previousReason: row.review_reason },
  });
  return { cashoutId: String(row.id), status: next };
}

/** Single admin may reject a held request: the money only goes back. */
async function rejectHeldCashout({ cashoutId, actorUserId, reason, requestIp = null }) {
  const text = String(reason || '').trim();
  if (!text) throw new AppError('A reason is required', 400, 'credit_decision_reason_required');
  const row = await withTransaction(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM credit_cashout_requests WHERE id = $1 FOR UPDATE', [cashoutId]);
    const current = rows[0];
    if (!current) throw new AppError('Cash-out not found', 404, 'cashout_not_found');
    if (current.status !== 'held_for_review') throw new AppError('Cash-out is not held', 409, 'cashout_not_held');
    if (current.review_reason === 'partner_outcome_unknown') {
      throw new AppError('The partner may have paid; confirm the outcome instead of rejecting', 409, 'cashout_outcome_unknown');
    }
    await releaseFunds(client, current, `rejected: ${text.slice(0, 200)}`);
    const { rows: updated } = await client.query(
      `UPDATE credit_cashout_requests SET status = 'rejected', failure_code = 'rejected_after_review', released_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [current.id]
    );
    await insertComplianceAudit(client, {
      actionType: 'credit.cashout.rejected', actorUserId, customerId: current.user_id, resourceType: 'credit_cashout', resourceId: String(current.id),
      reason: text.slice(0, 1000), requestIp,
    });
    return updated[0];
  }, 'credit_cashout_reject');
  await notify(row, 'failed').catch((err) => logger.warn('cashout.notify_failed', { error: err.message }));
  return view(row);
}

/** Customer cancels a request that has not been submitted yet. */
async function cancelCashout({ user, cashoutId }) {
  assertEnabled();
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM credit_cashout_requests WHERE id = $1 AND user_id = $2 FOR UPDATE', [cashoutId, user.id]);
    const current = rows[0];
    if (!current) throw new AppError('Cash-out not found', 404, 'cashout_not_found');
    if (current.status !== 'requested') throw new AppError('This cash-out can no longer be canceled', 409, 'cashout_not_cancelable');
    await releaseFunds(client, current, 'canceled by owner');
    const { rows: updated } = await client.query(
      `UPDATE credit_cashout_requests SET status = 'canceled', released_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [current.id]
    );
    await insertComplianceAudit(client, {
      actionType: 'credit.cashout.canceled', actorUserId: user.id, customerId: user.id, resourceType: 'credit_cashout', resourceId: String(current.id), reason: 'Canceled by owner',
    });
    return view(updated[0]);
  }, 'credit_cashout_cancel');
}

function registerOversightActions(register) {
  register('credit_cashout_release', releaseHeldCashout);
}

module.exports = {
  MIN_KYC_TIER,
  OPEN_STATUSES,
  eligibility,
  getEligibility,
  requestCashout,
  listCashouts,
  cancelCashout,
  processCashouts,
  claimDueCashouts,
  settle,
  settleInTransaction,
  listHeldCashouts,
  releaseHeldCashout,
  rejectHeldCashout,
  registerOversightActions,
  requestFingerprint,
  view,
};
