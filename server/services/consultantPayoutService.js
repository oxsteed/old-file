'use strict';

/**
 * G10-1 consultant payout leg (Nov 21 audit finding G10-1).
 *
 * Today the consultant's share of a business-launch engagement is computed,
 * stored on consulting_requests (estimated_consultant_share_cents) and
 * displayed on the contractor dashboard, but never paid: zero payout
 * consumers exist anywhere in the repo. This service closes the leg:
 * settlement in OxSteed Credit, automatic on completion (Emile-approved
 * design, 06:13 EST Nov 23). The leg ships default ON: there is no opt-in
 * flag. The Credit rail kill-switch, the operator freeze, and the
 * country legal-clearance gates are counterparty/legal gates in Emile's
 * domain; this leg honors them and FAILS CLOSED when they are off
 * (parks the payout with a visible reason, never pays via a fallback rail,
 * never silently drops the payout).
 *
 * Flow:
 *   1. Completion (PATCH /api/consulting/business-launch/requests/:id,
 *      admin-only) transitions a request to 'completed'. Inside that
 *      transaction, createPayoutForCompletedRequest() inserts one
 *      consulting_consultant_payouts row (unique per request) when a
 *      consultant is assigned and the estimated share is > 0.
 *   2. After COMMIT, attemptPayout() posts the Credit load via
 *      loadCustomerCredit under the row's idempotency key
 *      (consultant-payout:<request_id>), so a completion can never pay
 *      twice even across retries and crashes. The load's own idempotency
 *      replay is the second guard: a concurrent second attempt replays
 *      the existing transaction instead of posting a second load.
 *   3. Rail / legal-clearance failures park the row (status 'parked',
 *      reason_code set, consultant notified); any other attempt error
 *      fails it (status 'failed', reason set, consultant notified). Both
 *      are retryable by the hourly sweeper (server/jobs/
 *      consultantPayoutSweeper.js) and by the admin retry endpoint.
 *   4. The completing admin's UUID is stored as created_by and reused as
 *      the Credit actor for retries: migration 487's trigger rejects
 *      actor_type 'system' for load transactions, so retries must never
 *      post as 'system'.
 *
 * Deliberate non-check (D-163): consulting_requests has no link to any
 * payment, purchase, or invoice, so there is no reliable "the client paid
 * for this request" check. The admin's completion decision is the
 * authorization. An admin can mark an unpaid engagement complete and the
 * payout will still fire; that residual risk sits next to the G10-7
 * maker-checker hole (out of scope for this wave).
 */

const db = require('../db');
const logger = require('../utils/logger');
const { loadCustomerCredit, CREDIT_CURRENCY } = require('./oxsteedCreditService');
const { getCountryPolicy, clearPolicyCache } = require('./paymentRailPolicy');
const paymentLayerFlags = require('./paymentLayerFlags');
const { sendNotification } = require('./notificationService');

const PAYOUT_STATUSES = ['pending', 'paid', 'parked', 'failed'];
const RETRYABLE_STATUSES = ['pending', 'parked', 'failed'];
// AppError codes from the Credit rail that mean "the rail cannot move
// money right now" (operator state, not a payout defect): park, do not fail.
const RAIL_PARK_CODES = new Set([
  'credit_rail_suspended',
  'credit_rail_frozen',
  'credit_rail_status_unavailable',
]);

function payoutIdempotencyKey(requestId) {
  return `consultant-payout:${requestId}`;
}

function formatPayout(row) {
  if (!row) return null;
  return {
    id: row.id,
    consulting_request_id: row.consulting_request_id,
    consultant_user_id: row.consultant_user_id,
    amount_cents: Number(row.amount_cents),
    currency_code: row.currency_code,
    status: row.status,
    reason_code: row.reason_code || null,
    reason_detail: row.reason_detail || null,
    credit_transaction_id: row.credit_transaction_id || null,
    idempotency_key: row.idempotency_key || null,
    attempt_count: Number(row.attempt_count || 0),
    last_attempted_at: row.last_attempted_at || null,
    paid_at: row.paid_at || null,
    created_by: row.created_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Legal-clearance gate for paying a consultant in Credit, mirroring the
 * credit branch of railOptions() in paymentRailPolicy.js (payment mode,
 * not collateral: a payout is a payment, so credit_payment_legal_cleared
 * is required). Returns { eligible: true } or { eligible: false,
 * reasonCode, reasonDetail }. The FEATURE flags and the country policy
 * rows are Emile's domain (G4-1); this leg only reads them.
 */
async function checkCreditPayoutEligibility(client, countryCode) {
  const country = String(countryCode || 'US').toUpperCase();
  if (!paymentLayerFlags.isEnabled('PAYMENT_RAILS')) {
    return {
      eligible: false,
      reasonCode: 'credit_rails_not_enabled',
      reasonDetail: 'Payment rails are not enabled, so the Credit payout cannot be verified against country policy.',
    };
  }
  if (!paymentLayerFlags.isEnabled('CREDIT_RAIL')) {
    return {
      eligible: false,
      reasonCode: 'credit_rail_not_enabled',
      reasonDetail: 'The Credit rail is not enabled.',
    };
  }
  const policy = await getCountryPolicy(client, country);
  if (!policy) {
    return {
      eligible: false,
      reasonCode: 'country_not_supported',
      reasonDetail: `No payment policy exists for country ${country}.`,
    };
  }
  if (!policy.tax_review_cleared) {
    return {
      eligible: false,
      reasonCode: 'country_tax_review_pending',
      reasonDetail: `Tax review is pending for country ${country}.`,
    };
  }
  if (!policy.enabled) {
    return {
      eligible: false,
      reasonCode: 'country_not_enabled',
      reasonDetail: `Payments are not enabled for country ${country}.`,
    };
  }
  if (!policy.credit_rail_enabled) {
    return {
      eligible: false,
      reasonCode: 'rail_disabled_in_country',
      reasonDetail: `The Credit rail is disabled in country ${country}.`,
    };
  }
  if (!policy.credit_payment_legal_cleared) {
    return {
      eligible: false,
      reasonCode: 'credit_payment_not_cleared',
      reasonDetail: `Credit payments are not legally cleared in country ${country}.`,
    };
  }
  return { eligible: true };
}

/**
 * Create the payout row for a request that just transitioned to
 * 'completed'. MUST be called inside the caller's transaction (client is
 * the transaction client) so the row commits atomically with the status
 * change. Returns the created (or pre-existing, on re-completion) row, or
 * null when there is nothing to pay (no consultant assigned, or the
 * estimated consultant share is not positive).
 */
async function createPayoutForCompletedRequest(client, { request, adminUserId }) {
  const consultantUserId = request.consultant_assigned_id;
  const amountCents = Math.round(Number(request.estimated_consultant_share_cents || 0));
  if (!consultantUserId || amountCents <= 0) return null;
  if (!adminUserId) {
    throw new Error('createPayoutForCompletedRequest requires the completing admin user id');
  }
  const { rows } = await client.query(
    `INSERT INTO consulting_consultant_payouts
       (consulting_request_id, consultant_user_id, amount_cents, currency_code,
        status, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     ON CONFLICT (consulting_request_id) DO NOTHING
     RETURNING *`,
    [
      request.id,
      consultantUserId,
      amountCents,
      CREDIT_CURRENCY,
      payoutIdempotencyKey(request.id),
      adminUserId,
    ]
  );
  if (rows[0]) return formatPayout(rows[0]);
  const { rows: existing } = await client.query(
    `SELECT * FROM consulting_consultant_payouts WHERE consulting_request_id = $1`,
    [request.id]
  );
  return formatPayout(existing[0]);
}

async function getPayoutById(payoutId) {
  const { rows } = await db.query(
    `SELECT * FROM consulting_consultant_payouts WHERE id = $1`,
    [payoutId]
  );
  return formatPayout(rows[0]);
}

async function getPayoutByRequestId(requestId) {
  const { rows } = await db.query(
    `SELECT * FROM consulting_consultant_payouts WHERE consulting_request_id = $1`,
    [requestId]
  );
  return formatPayout(rows[0]);
}

async function listPayoutsForConsultant(consultantUserId, { limit = 50 } = {}) {
  const { rows } = await db.query(
    `SELECT p.*,
            r.business_name, r.first_name, r.last_name, r.package_selected
       FROM consulting_consultant_payouts p
       LEFT JOIN consulting_requests r ON r.id = p.consulting_request_id
      WHERE p.consultant_user_id = $1
      ORDER BY p.created_at DESC
      LIMIT $2`,
    [consultantUserId, Math.max(1, Math.min(100, Number(limit) || 50))]
  );
  return rows.map((row) => {
    const payout = formatPayout(row);
    // created_by is the completing admin's id (internal retry actor) and
    // idempotency_key is ledger plumbing: neither is consultant-facing.
    delete payout.created_by;
    delete payout.idempotency_key;
    return {
      ...payout,
      business_name: row.business_name || null,
      client_name: [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
      package_selected: row.package_selected || null,
    };
  });
}

async function notifyConsultant(payout, outcome, { businessName } = {}) {
  const type = `consultant_payout_${outcome}`;
  const amount = `$${(Number(payout.amount_cents || 0) / 100).toFixed(2)}`;
  try {
    await sendNotification({
      userId: payout.consultant_user_id,
      type,
      data: {
        reference_id: String(payout.id),
        consulting_request_id: String(payout.consulting_request_id),
        amount_cents: Number(payout.amount_cents),
        currency_code: payout.currency_code,
        payout_status: payout.status,
        reason_code: payout.reason_code || null,
        params: { amount, business: businessName || 'your business-launch engagement' },
      },
      action_url: '/consulting/contractor-dashboard',
      idempotencyKey: `consultant-payout-notify:${payout.id}:${outcome}`,
    });
  } catch (err) {
    // A failed notification must never unwind a completed payout.
    logger.warn('Failed to send consultant payout notification', {
      payoutId: payout.id,
      outcome,
      err: err.message,
    });
  }
}

/**
 * Attempt to pay one payout row in OxSteed Credit. Idempotent: a row
 * already 'paid' returns as-is, and the Credit load's own idempotency
 * replay makes a concurrent second attempt return the same transaction
 * instead of posting a second load.
 *
 * actorUserId is the Credit actor for the load (migration 487 requires a
 * real admin UUID). The sync completion attempt passes the completing
 * admin; sweeper/admin retries pass the row's stored created_by.
 */
async function attemptPayout(payoutId, { actorUserId } = {}) {
  const payout = await getPayoutById(payoutId);
  if (!payout) throw new Error(`Consultant payout not found: ${payoutId}`);
  if (payout.status === 'paid') return payout;

  const actor = actorUserId || payout.created_by;
  if (!actor) {
    const failed = await markPayout(payout.id, 'failed', 'payout_actor_missing', 'No admin actor is recorded for this payout.');
    await notifyConsultant(failed, 'failed');
    return failed;
  }

  // Claim the attempt (serializes the bookkeeping; the load's idempotency
  // key serializes the money even if two attempts race past this claim).
  await db.query(
    `UPDATE consulting_consultant_payouts
        SET attempt_count = attempt_count + 1,
            last_attempted_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [payout.id]
  );

  // Recipient jurisdiction: the consultant's users.country, falling back
  // to the engagement's operating country, then US.
  const client = await db.connect();
  let country = 'US';
  let businessName = null;
  try {
    const { rows } = await client.query(
      `SELECT u.country AS consultant_country, r.operating_country, r.business_name
         FROM consulting_consultant_payouts p
         JOIN consulting_requests r ON r.id = p.consulting_request_id
         LEFT JOIN users u ON u.id = p.consultant_user_id
        WHERE p.id = $1`,
      [payout.id]
    );
    const row = rows[0] || {};
    country = String(row.consultant_country || row.operating_country || 'US').toUpperCase();
    businessName = row.business_name || null;
  } finally {
    client.release();
  }

  // Legal-clearance gate first: a payout that cannot legally move in
  // Credit parks with a visible reason instead of attempting the load.
  const gateClient = await db.connect();
  let eligibility;
  try {
    eligibility = await checkCreditPayoutEligibility(gateClient, country);
  } finally {
    gateClient.release();
  }
  if (!eligibility.eligible) {
    const parked = await markPayout(payout.id, 'parked', eligibility.reasonCode, eligibility.reasonDetail);
    logger.info('Consultant payout parked: legal/rail gate not cleared', {
      payoutId: payout.id,
      requestId: payout.consulting_request_id,
      reasonCode: eligibility.reasonCode,
      country,
    });
    await notifyConsultant(parked, 'parked', { businessName });
    return parked;
  }

  let loadResult;
  try {
    loadResult = await loadCustomerCredit({
      customerId: payout.consultant_user_id,
      amountCents: payout.amount_cents,
      currencyCode: payout.currency_code,
      idempotencyKey: payout.idempotency_key,
      actorUserId: actor,
      reason: `Consultant payout for business-launch engagement ${payout.consulting_request_id}`,
      referenceType: 'consultant_payout',
      referenceId: String(payout.id),
      metadata: {
        consulting_request_id: String(payout.consulting_request_id),
        consultant_user_id: String(payout.consultant_user_id),
      },
    });
  } catch (err) {
    const code = err && err.code ? String(err.code) : 'payout_failed';
    const detail = String((err && err.message) || 'Credit load failed').slice(0, 500);
    if (RAIL_PARK_CODES.has(code)) {
      const parked = await markPayout(payout.id, 'parked', code, detail);
      logger.info('Consultant payout parked: Credit rail unavailable', {
        payoutId: payout.id,
        requestId: payout.consulting_request_id,
        reasonCode: code,
      });
      await notifyConsultant(parked, 'parked', { businessName });
      return parked;
    }
    const failed = await markPayout(payout.id, 'failed', code, detail);
    logger.warn('Consultant payout attempt failed', {
      payoutId: payout.id,
      requestId: payout.consulting_request_id,
      reasonCode: code,
      err: detail,
    });
    await notifyConsultant(failed, 'failed', { businessName });
    return failed;
  }

  // loadCustomerCredit returns { transaction, replayed }: on replay the
  // same transaction id comes back, so a concurrent second attempt marks
  // the same payout paid against the same load, never a second load.
  const creditTransactionId = loadResult && loadResult.transaction && loadResult.transaction.id
    ? String(loadResult.transaction.id)
    : null;
  if (!creditTransactionId) {
    // Fail closed: a load with no transaction id must never be marked
    // paid, or the money would be untraceable from the payout row.
    const failed = await markPayout(payout.id, 'failed', 'payout_transaction_missing', 'The Credit load completed without returning a transaction id.');
    logger.warn('Consultant payout load returned no transaction id', {
      payoutId: payout.id,
      requestId: payout.consulting_request_id,
    });
    await notifyConsultant(failed, 'failed', { businessName });
    return failed;
  }
  const paid = await markPayout(payout.id, 'paid', null, null, {
    creditTransactionId,
  });
  logger.info('Consultant payout paid in OxSteed Credit', {
    payoutId: payout.id,
    requestId: payout.consulting_request_id,
    consultantUserId: payout.consultant_user_id,
    amountCents: payout.amount_cents,
    creditTransactionId: paid.credit_transaction_id,
  });
  await notifyConsultant(paid, 'paid', { businessName });
  return paid;
}

async function markPayout(payoutId, status, reasonCode, reasonDetail, { creditTransactionId } = {}) {
  if (!PAYOUT_STATUSES.includes(status)) throw new Error(`Invalid payout status: ${status}`);
  // NOTE: the paid flag rides its own boolean parameter. Reusing the
  // status parameter in `CASE WHEN $2 = 'paid'` makes Postgres infer two
  // types for $2 (varchar from the column, text from the literal) and
  // fail the query with 42P08.
  const { rows } = await db.query(
    `UPDATE consulting_consultant_payouts
        SET status = $2,
            reason_code = $3,
            reason_detail = $4,
            credit_transaction_id = COALESCE($5, credit_transaction_id),
            paid_at = CASE WHEN $6 THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [payoutId, status, reasonCode || null, reasonDetail || null, creditTransactionId || null, status === 'paid']
  );
  return formatPayout(rows[0]);
}

/**
 * Retry one payout by request id (admin retry endpoint + sweeper share
 * this path). A paid payout is returned as-is; anything else is
 * re-attempted under the same idempotency key.
 */
async function retryPayoutByRequestId(requestId, { actorUserId } = {}) {
  const payout = await getPayoutByRequestId(requestId);
  if (!payout) return null;
  if (payout.status === 'paid') return payout;
  return attemptPayout(payout.id, { actorUserId: actorUserId || payout.created_by });
}

/**
 * Sweep due payouts: every pending / parked / failed row, oldest first,
 * bounded per run. The caller (hourly fenced cron) skips the whole run
 * when the rail kill-switch is off, so a disabled rail does not churn
 * parked rows; parked rows retry on the first tick after the rail (or
 * the legal clearance) comes back.
 */
async function sweepDuePayouts({ limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT id FROM consulting_consultant_payouts
      WHERE status = ANY ($1::text[])
      ORDER BY last_attempted_at ASC NULLS FIRST, created_at ASC
      LIMIT $2`,
    [RETRYABLE_STATUSES, Math.max(1, Math.min(500, Number(limit) || 100))]
  );
  const results = [];
  for (const row of rows) {
    try {
      results.push(await attemptPayout(row.id, {}));
    } catch (err) {
      logger.warn('Consultant payout sweep attempt errored', { payoutId: row.id, err: err.message });
      results.push({ id: row.id, status: 'error', reason_detail: err.message });
    }
  }
  return results;
}

module.exports = {
  PAYOUT_STATUSES,
  RETRYABLE_STATUSES,
  payoutIdempotencyKey,
  formatPayout,
  checkCreditPayoutEligibility,
  createPayoutForCompletedRequest,
  getPayoutById,
  getPayoutByRequestId,
  listPayoutsForConsultant,
  attemptPayout,
  retryPayoutByRequestId,
  sweepDuePayouts,
  // Re-exported for tests: the policy cache must be cleared after a test
  // inserts a country policy row, or getCountryPolicy serves the stale hit.
  clearPolicyCache,
};
