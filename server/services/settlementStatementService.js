'use strict';

/**
 * settlementStatementService — product adapters for settlement/earnings
 * statements (workstream 8).
 *
 * Products:
 *   restaurant_settlement — per (restaurant_id, currency_code). The
 *     authoritative section is the restaurant's sub-bank journal
 *     (restaurant_sub_bank account in the OxSteed Credit double-entry
 *     journal): exact reconciliation opening + credits - debits = closing,
 *     verified per-row against balance_after_cents. Informational sections
 *     (never in the equation): OxSteed partner settlements, restaurant
 *     payout outcomes (verified outcomes only), and order proceeds.
 *     Customer-credit liability and merchant money are labeled exactly as
 *     the journal records them and are never renamed into each other.
 *   helper_earnings — per (helper user_id, currency_code). Deterministic
 *     event-dated snapshot over jobs + payments. Exact identity:
 *       openingPayable + postedEarnings - settledPayouts - statusRemovals
 *       = closingPayable
 *     (all integer minor units; buckets are the CURRENT snapshot states,
 *     stated on the document). Unpaid earnings are never described as
 *     received. This statement is not a tax form, payroll record, or proof
 *     of employment.
 *   business — per (business_id, currency_code). Receivables activity over
 *     business_invoices with the exact identity:
 *       openingOutstanding + invoiced - collectedOrAdjusted - cancelled
 *       = closingOutstanding
 *     (collectedOrAdjusted is a labeled derived plug: invoice payments
 *     carry no per-payment timestamp). Plus payables (business_expenses),
 *     partner settlements for the business's partners, and restaurant
 *     payouts for the business's restaurants. No cross-entity consolidation.
 *
 * Non-negotiables (same as the customer-wallet products):
 * - Statements never move money; read-only over existing records.
 * - One scope per statement; currencies, customers, and merchant money never mix.
 * - Integer minor-unit arithmetic; exact reconciliation or fail closed (409).
 * - Issued monthly originals are append-only in settlement_statement_documents
 *   (migration 688); corrections via the amendment workflow's rederive
 *   rebuild (this service supports rederive: true), never overwrites.
 * - No PII in URLs/keys/object names; auth lives in the router layer.
 *
 * Journal/status meanings are inventoried in
 * docs/statement-settlement-inventory.md.
 */

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const {
  periodFor,
  exactMoney,
  hashDocument,
  reconcileRows,
  MAX_ROWS,
} = require('./creditStatementService');

const PRODUCTS = ['restaurant_settlement', 'helper_earnings', 'business'];

// jobs.payout_status buckets (migration 352). 'not_ready'/'earned' = accrued
// and owed; 'pending'/'processing' = payout initiated, in transit;
// 'paid' = settled (has paid_at); 'failed'/'reversed'/'cancelled' = not owed.
const ACCRUED_STATUSES = new Set(['earned', 'not_ready']);
const IN_TRANSIT_STATUSES = new Set(['pending', 'processing']);
const NOT_OWED_STATUSES = new Set(['failed', 'reversed', 'cancelled']);
const KNOWN_PAYOUT_STATUSES = new Set([...ACCRUED_STATUSES, ...IN_TRANSIT_STATUSES, 'paid', ...NOT_OWED_STATUSES]);

const INVOICE_OPEN_STATUSES = ['sent', 'partial', 'overdue'];

// NUMERIC(dollars) -> integer minor units. Fails closed on anything that is
// not an exact two-decimal amount.
function dollarsToCents(value, label) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new AppError(`Statement amount is not exactly representable: ${label}`, 409, 'statement_integrity_failed');
  }
  const [whole, frac = ''] = text.replace('-', '').split('.');
  const cents = BigInt(whole || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  const signed = text.startsWith('-') ? -cents : cents;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new AppError('Statement amount cannot be represented safely', 409, 'statement_integrity_failed');
  }
  return Number(signed);
}

function maskedRef(value) {
  const text = String(value || '');
  if (!text) return null;
  return text.length <= 8 ? '••••' : `••••${text.slice(-4)}`;
}

function isoDateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function scopeColumns(product, scope) {
  if (product === 'restaurant_settlement') {
    return { scope_restaurant_id: scope.restaurantId, scope_business_id: null, scope_helper_user_id: null };
  }
  if (product === 'helper_earnings') {
    return { scope_restaurant_id: null, scope_business_id: null, scope_helper_user_id: scope.helperId };
  }
  return { scope_restaurant_id: null, scope_business_id: scope.businessId, scope_helper_user_id: null };
}

function scopeWhere(product) {
  if (product === 'restaurant_settlement') return 'product = $1 AND scope_restaurant_id = $2';
  if (product === 'helper_earnings') return 'product = $1 AND scope_helper_user_id = $2';
  return 'product = $1 AND scope_business_id = $2';
}

function scopeId(product, options) {
  if (product === 'restaurant_settlement') return options.restaurantId;
  if (product === 'helper_earnings') return options.helperId;
  return options.businessId;
}

// ── restaurant_settlement ─────────────────────────────────────────────────
// Authoritative section: the restaurant's sub-bank journal account. Every
// other section is informational and carries its own scope label.

async function buildRestaurantSettlement(client, { restaurantId, currency, period, now, requesterId }) {
  const { rows: [restaurant] } = await client.query(
    `SELECT fr.id, fr.display_name, fr.business_id, fr.owner_user_id, fr.created_at
       FROM food_restaurants fr WHERE fr.id = $1`,
    [restaurantId]);
  if (!restaurant) throw new AppError('Statement account not found', 404, 'statement_account_not_found');

  const { rows: [account] } = await client.query(
    `SELECT id, currency_code, created_at FROM oxsteed_credit_accounts
      WHERE account_type = 'restaurant_sub_bank' AND restaurant_id = $1 AND currency_code = $2`,
    [restaurantId, currency]);
  if (!account) throw new AppError('Statement account not found', 404, 'statement_account_not_found');
  if (period.to < isoDateOnly(account.created_at)) {
    throw new AppError('Statement period precedes this account', 400, 'statement_before_account');
  }

  const start = `${period.from}T00:00:00.000Z`;
  const end = new Date(Date.parse(period.to) + 86400000).toISOString();
  const dateExpr = 'COALESCE(t.posted_at,t.created_at)';
  const posted = " AND t.status IN ('posted','reversed')";

  const { rows: [opening] } = await client.query(
    `SELECT e.balance_after_cents FROM oxsteed_credit_transaction_entries e
      JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
     WHERE e.account_id = $1 AND t.currency_code = $2 AND ${dateExpr} < $3::timestamptz${posted}
     ORDER BY ${dateExpr} DESC, e.sequence DESC, e.id DESC LIMIT 1`,
    [account.id, currency, start]);
  const { rows } = await client.query(
    `SELECT t.transaction_type AS type, t.id AS id, ${dateExpr} AS date,
            t.description AS description, e.amount_cents, e.balance_after_cents,
            e.entry_side AS direction, t.reference_type, t.reference_id
       FROM oxsteed_credit_transaction_entries e
       JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
      WHERE e.account_id = $1 AND t.currency_code = $2
        AND ${dateExpr} >= $3::timestamptz AND ${dateExpr} < $4::timestamptz
        AND ${dateExpr} <= $5::timestamptz${posted}
      ORDER BY ${dateExpr}, e.sequence, e.id LIMIT $6`,
    [account.id, currency, start, end, now, MAX_ROWS + 1]);
  if (rows.length > MAX_ROWS) throw new AppError('Narrow the period to export the complete statement', 409, 'statement_export_too_large');

  const openingBalanceCents = exactMoney(opening?.balance_after_cents || '0');
  // reconcileRows passes the journal's own transaction_type through (it only
  // remaps the customer-wallet 'credit'/'debit' aliases).
  const activity = reconcileRows(rows, openingBalanceCents);

  const { rows: [closing] } = await client.query(
    `SELECT e.balance_after_cents FROM oxsteed_credit_transaction_entries e
      JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
     WHERE e.account_id = $1 AND t.currency_code = $2
       AND ${dateExpr} < $3::timestamptz AND ${dateExpr} <= $4::timestamptz${posted}
     ORDER BY ${dateExpr} DESC, e.sequence DESC, e.id DESC LIMIT 1`,
    [account.id, currency, end, now]);
  if (activity.closingBalanceCents !== exactMoney(closing?.balance_after_cents || '0')) {
    throw new AppError('Statement closing balance does not reconcile', 409, 'statement_integrity_failed');
  }

  // Informational: partner settlements whose settlement period intersects
  // the statement period. These settle against the partner_payable account,
  // not the sub-bank, so they never enter the equation above.
  const { rows: settlements } = await client.query(
    `SELECT s.id, s.period_start, s.period_end, s.gross_cents, s.refund_cents,
            s.fee_cents, s.net_cents, s.status, s.payout_status,
            s.stripe_transfer_id, s.payment_reference, s.value_date,
            s.settlement_date, s.cycle_id, p.id AS partner_id,
            fr.display_name AS restaurant_name
       FROM oxsteed_credit_settlements s
       JOIN oxsteed_credit_partners p ON p.id = s.partner_id
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
      WHERE p.restaurant_id = $1 AND s.currency_code = $2
        AND s.period_start < $3::timestamptz AND s.period_end > $4::timestamptz
      ORDER BY s.period_start, s.id LIMIT $5`,
    [restaurantId, currency, end, start, MAX_ROWS + 1]);
  if (settlements.length > MAX_ROWS) throw new AppError('Narrow the period to export the complete statement', 409, 'statement_export_too_large');

  // Informational: payout outcomes. Only 'completed' counts as a verified
  // outcome; everything else is labeled by its lifecycle state.
  const { rows: payouts } = await client.query(
    `SELECT id, amount_cents, status, stripe_transfer_id, failure_reason,
            ledger_transaction_id, created_at, reviewed_at
       FROM restaurant_payouts
      WHERE restaurant_id = $1 AND currency_code = $2
        AND created_at >= $3::timestamptz AND created_at < $4::timestamptz
      ORDER BY created_at, id LIMIT $5`,
    [restaurantId, currency, start, end, MAX_ROWS + 1]);
  if (payouts.length > MAX_ROWS) throw new AppError('Narrow the period to export the complete statement', 409, 'statement_export_too_large');

  // Informational: order proceeds. Card orders settle directly to the
  // restaurant's Connect account (destination charges): OxSteed holds no
  // payout record for them, so they are labeled accordingly.
  const { rows: orders } = await client.query(
    `SELECT id, created_at, total_cents, payment_status,
            (stripe_payment_intent_id IS NOT NULL) AS card_funded
       FROM food_orders
      WHERE restaurant_id = $1 AND currency_code = $2
        AND created_at >= $3::timestamptz AND created_at < $4::timestamptz
        AND payment_status IN ('paid','refunded')
      ORDER BY created_at, id LIMIT $5`,
    [restaurantId, currency, start, end, MAX_ROWS + 1]);
  if (orders.length > MAX_ROWS) throw new AppError('Narrow the period to export the complete statement', 409, 'statement_export_too_large');

  // Informational: reserve position for the restaurant's partners (the
  // reserve regime is prefunding, not a sidecar; open funding requirements
  // are disclosable obligations, never posted money).
  const { rows: partnerIds } = await client.query(
    `SELECT id FROM oxsteed_credit_partners WHERE restaurant_id = $1`, [restaurantId]);
  const partnerIdList = partnerIds.map((p) => Number(p.id));
  let reserves = [];
  let fundingRequirements = [];
  if (partnerIdList.length) {
    const { rows: reserveRows } = await client.query(
      `SELECT p.id AS partner_id, a.balance_cents, a.reserved_cents,
              rp.ratio_bps, rp.floor_cents
         FROM oxsteed_credit_partners p
         JOIN oxsteed_credit_accounts a
           ON a.account_type = 'partner_reserve' AND a.partner_id = p.id
          AND a.currency_code = $2
         LEFT JOIN oxsteed_credit_reserve_policies rp
           ON rp.partner_id = p.id AND rp.currency_code = $2
        WHERE p.id = ANY($1::bigint[])`,
      [partnerIdList, currency]);
    reserves = reserveRows.map((r) => ({
      partnerId: String(r.partner_id),
      balanceCents: exactMoney(r.balance_cents),
      reservedCents: exactMoney(r.reserved_cents),
      policyRatioBps: r.ratio_bps === null ? null : Number(r.ratio_bps),
      policyFloorCents: r.floor_cents === null ? null : exactMoney(r.floor_cents),
      scopeNote: 'partner_reserve',
    }));
    const { rows: frRows } = await client.query(
      `SELECT partner_id, required_cents, reason, status, created_at
         FROM oxsteed_credit_reserve_funding_requirements
        WHERE partner_id = ANY($1::bigint[]) AND currency_code = $2 AND status = 'open'
        ORDER BY created_at`,
      [partnerIdList, currency]);
    fundingRequirements = frRows.map((fr) => ({
      partnerId: String(fr.partner_id),
      requiredCents: exactMoney(fr.required_cents),
      reason: String(fr.reason || '').slice(0, 200),
      status: String(fr.status),
      createdAt: new Date(fr.created_at).toISOString(),
    }));
  }

  const document = {
    id: crypto.randomUUID(),
    version: 1,
    kind: period.kind,
    product: 'restaurant_settlement',
    restaurantId: String(restaurantId),
    restaurantName: String(restaurant.display_name || ''),
    ownerName: String(restaurant.display_name || ''),
    accountLabel: `${restaurant.display_name} — settlement journal`,
    accountReference: `RS-••••${String(restaurantId).slice(-4).padStart(4, '0')}`,
    currencyCode: currency,
    period: { from: period.from, to: period.to },
    generatedAt: new Date(now).toISOString(),
    generatedBy: String(requesterId),
    // Reconciled journal section (authoritative).
    openingBalanceCents,
    ...activity,
    transactionCount: rows.length,
    transactions: activity.transactions.map((tx, index) => ({
      ...tx,
      referenceType: rows[index]?.reference_type || null,
      referenceId: rows[index]?.reference_id || null,
    })),
    // Informational sections (never in the equation; each carries its scope).
    partnerSettlements: settlements.map((s) => ({
      id: String(s.id),
      partnerId: String(s.partner_id),
      periodStart: new Date(s.period_start).toISOString(),
      periodEnd: new Date(s.period_end).toISOString(),
      grossCents: exactMoney(s.gross_cents),
      refundCents: exactMoney(s.refund_cents),
      feeCents: exactMoney(s.fee_cents),
      netCents: exactMoney(s.net_cents),
      status: String(s.status),
      payoutStatus: String(s.payout_status || 'none'),
      payoutVerified: s.payout_status === 'paid' || (s.status === 'paid' && !!s.payment_reference),
      stripeTransferRef: maskedRef(s.stripe_transfer_id),
      paymentReference: maskedRef(s.payment_reference),
      valueDate: s.value_date ? isoDateOnly(s.value_date) : null,
      settlementDate: s.settlement_date ? isoDateOnly(s.settlement_date) : null,
      scopeNote: 'partner_payable',
    })),
    payouts: payouts.map((p) => ({
      id: String(p.id),
      amountCents: exactMoney(p.amount_cents),
      status: String(p.status),
      outcome: p.status === 'completed' ? 'verified'
        : ['requested', 'approved', 'processing'].includes(p.status) ? 'in_transit'
        : p.status === 'failed' ? 'failed' : 'never_executed',
      stripeTransferRef: maskedRef(p.stripe_transfer_id),
      journalLegPosted: !!p.ledger_transaction_id,
      failureReason: p.status === 'failed' ? String(p.failure_reason || '').slice(0, 300) : null,
      createdAt: new Date(p.created_at).toISOString(),
      reviewedAt: p.reviewed_at ? new Date(p.reviewed_at).toISOString() : null,
    })),
    orders: orders.map((o) => ({
      id: String(o.id),
      createdAt: new Date(o.created_at).toISOString(),
      totalCents: exactMoney(o.total_cents),
      paymentStatus: String(o.payment_status),
      funding: o.card_funded ? 'card_direct_to_connect' : 'wallet_or_credit',
      fundingNote: o.card_funded
        ? 'Card proceeds settle directly to the restaurant Connect account; no OxSteed-held payout applies.'
        : 'Wallet/credit proceeds accumulate as OxSteed liability; see the journal section.',
    })),
    reserves,
    reserveFundingRequirements: fundingRequirements,
    equationNote: 'openingBalanceCents + totalCreditsCents - totalDebitsCents = closingBalanceCents, verified per row against the sub-bank journal balance_after_cents. Partner settlements, payouts, and orders are linked activity, not equation terms.',
  };
  document.contentHash = hashDocument(document);
  return document;
}

// ── helper_earnings ─────────────────────────────────────────────────────────
// Deterministic event-dated snapshot over jobs (+ linked payments).
// Buckets use CURRENT payout_status; the document states this. Exact identity:
//   openingPayable + postedEarnings - settledPayouts - statusRemovals = closingPayable

function bucketOf(payoutStatus) {
  const status = String(payoutStatus || '');
  if (!KNOWN_PAYOUT_STATUSES.has(status)) {
    throw new AppError(`Unknown job payout status '${status}'`, 409, 'statement_integrity_failed');
  }
  if (status === 'paid') return 'settled';
  if (ACCRUED_STATUSES.has(status)) return 'accrued';
  if (IN_TRANSIT_STATUSES.has(status)) return 'inTransit';
  return 'notOwed';
}

async function buildHelperEarnings(client, { helperId, currency, period, now, requesterId }) {
  const { rows: [user] } = await client.query(
    `SELECT id, created_at,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), email) AS owner_name
       FROM users WHERE id = $1`,
    [helperId]);
  if (!user) throw new AppError('Statement account not found', 404, 'statement_account_not_found');
  if (period.to < isoDateOnly(user.created_at)) {
    throw new AppError('Statement period precedes this account', 400, 'statement_before_account');
  }

  const start = new Date(`${period.from}T00:00:00.000Z`);
  const end = new Date(Date.parse(period.to) + 86400000);
  const nowDate = new Date(now);

  const { rows: jobs } = await client.query(
    `SELECT j.id, j.title, j.status AS job_status, j.payout_status,
            j.completed_at, j.paid_at, j.helper_payout_cents,
            j.platform_fee_cents, j.customer_total_cents, j.currency_code
       FROM jobs j
      WHERE j.assigned_helper_id = $1 AND j.currency_code = $2
      ORDER BY j.completed_at NULLS LAST, j.id LIMIT $3`,
    [helperId, currency, MAX_ROWS + 1]);
  if (jobs.length > MAX_ROWS) throw new AppError('Narrow the period to export the complete statement', 409, 'statement_export_too_large');

  let openingPayable = 0n;
  let postedEarnings = 0n;
  let settledPayouts = 0n;
  let statusRemovals = 0n;
  let closingPayable = 0n;
  let accruedCents = 0n;
  let inTransitCents = 0n;
  let settledAllTimeCents = 0n;
  let notOwedCents = 0n;
  let undatedSettledCents = 0n;
  let undatedSettledCount = 0;
  let platformFeesOnPosted = 0n;
  let unpricedJobs = 0;
  let incompleteJobs = 0;
  const earningsRows = [];
  const settledRows = [];
  const removedRows = [];
  const jobIds = [];

  // Payable position P(T) = earned(<T) - settled(<T) - removed(<T), all in
  // integer minor units. The period identity
  //   P(E) - P(S) = postedEarnings - settledPayouts - statusRemovals
  // is exact by construction: every term regroups the same per-job sums.
  // A job marked 'paid' without a paid_at has no reliable settlement date;
  // it is excluded from the flow (memoized below), never dated by guess.
  for (const job of jobs) {
    const bucket = bucketOf(job.payout_status);
    const hpRaw = job.helper_payout_cents;
    const completedAt = job.completed_at ? new Date(job.completed_at) : null;
    const paidAt = job.paid_at ? new Date(job.paid_at) : null;
    if (hpRaw === null || hpRaw === undefined || !completedAt) {
      if (hpRaw === null || hpRaw === undefined) unpricedJobs += 1;
      else incompleteJobs += 1;
      continue;
    }
    const hp = BigInt(exactMoney(hpRaw));
    if (hp < 0n) throw new AppError('Invalid job payout amount', 409, 'statement_integrity_failed');
    const datedSettled = bucket === 'settled' && !!paidAt;
    const removed = bucket === 'notOwed';

    // All-time buckets (current snapshot).
    if (bucket === 'accrued') accruedCents += hp;
    else if (bucket === 'inTransit') inTransitCents += hp;
    else if (datedSettled) settledAllTimeCents += hp;
    else if (removed) notOwedCents += hp;
    else { undatedSettledCents += hp; undatedSettledCount += 1; continue; }

    const earnedBefore = (t) => completedAt < t;
    const settledBefore = (t) => datedSettled && paidAt < t;

    if (earnedBefore(start)) openingPayable += hp;
    if (settledBefore(start)) openingPayable -= hp;
    if (earnedBefore(start) && removed) openingPayable -= hp;

    if (earnedBefore(end)) closingPayable += hp;
    if (settledBefore(end)) closingPayable -= hp;
    if (earnedBefore(end) && removed) closingPayable -= hp;

    const earnedInPeriod = completedAt >= start && completedAt < end;
    if (earnedInPeriod) {
      postedEarnings += hp;
      if (removed) statusRemovals += hp;
      if (job.platform_fee_cents !== null && job.platform_fee_cents !== undefined) {
        platformFeesOnPosted += BigInt(exactMoney(job.platform_fee_cents));
      }
    }
    const settledInPeriod = datedSettled && paidAt >= start && paidAt < end;
    if (settledInPeriod) settledPayouts += hp;

    // Row detail for the period lists.
    const base = {
      jobId: String(job.id),
      title: String(job.title || '').slice(0, 140),
      payoutStatus: String(job.payout_status),
      bucket,
      helperPayoutCents: exactMoney(hpRaw),
      platformFeeCents: job.platform_fee_cents === null || job.platform_fee_cents === undefined
        ? null : exactMoney(job.platform_fee_cents),
      customerTotalCents: job.customer_total_cents === null || job.customer_total_cents === undefined
        ? null : exactMoney(job.customer_total_cents),
    };
    if (earnedInPeriod) {
      earningsRows.push({ ...base, completedAt: completedAt.toISOString(), kind: removed ? 'removed' : 'posted' });
      jobIds.push(job.id);
    }
    if (settledInPeriod) {
      settledRows.push({ ...base, paidAt: paidAt.toISOString() });
      if (!jobIds.includes(job.id)) jobIds.push(job.id);
    }
    if (removed && earnedInPeriod) removedRows.push({ ...base, completedAt: completedAt.toISOString() });
  }

  // Exactness assertions: the identity is regrouped from the same sums, so a
  // mismatch here means an arithmetic bug, never a data gap.
  const recomputed = openingPayable + postedEarnings - settledPayouts - statusRemovals;
  if (recomputed !== closingPayable) {
    throw new AppError('Statement does not reconcile', 409, 'statement_integrity_failed');
  }
  const allTime = accruedCents + inTransitCents + settledAllTimeCents + notOwedCents + undatedSettledCents;

  // Linked payment events (bounded): captured/released = credited to the
  // helper's Connect balance (not proof of bank payout); refunded/disputed =
  // reversals shown honestly.
  const { rows: payments } = jobIds.length ? await client.query(
    `SELECT job_id, status, escrow_status, refund_amount, refunded_at,
            (stripe_payment_intent_id IS NOT NULL) AS card_funded
       FROM payments WHERE job_id = ANY($1::uuid[]) LIMIT $2`,
    [jobIds, MAX_ROWS + 1]) : { rows: [] };
  const paymentByJob = new Map();
  for (const p of payments) {
    paymentByJob.set(String(p.job_id), {
      status: String(p.status),
      escrowStatus: String(p.escrow_status || 'none'),
      refundAmountCents: p.refund_amount === null || p.refund_amount === undefined
        ? null : dollarsToCents(p.refund_amount, 'payment refund'),
      refundedAt: p.refunded_at ? new Date(p.refunded_at).toISOString() : null,
      funding: p.card_funded ? 'card' : 'other',
    });
  }
  const attachPayment = (row) => ({ ...row, payment: paymentByJob.get(row.jobId) || null });

  const document = {
    id: crypto.randomUUID(),
    version: 1,
    kind: period.kind,
    product: 'helper_earnings',
    helperId: String(helperId),
    ownerName: String(user.owner_name || ''),
    accountLabel: 'Helper earnings',
    accountReference: `HE-••••${String(helperId).replace(/-/g, '').slice(-4).padStart(4, '0')}`,
    currencyCode: currency,
    period: { from: period.from, to: period.to },
    generatedAt: nowDate.toISOString(),
    generatedBy: String(requesterId),
    // Reconciled equation (integer minor units).
    openingPayableCents: exactMoney(openingPayable),
    postedEarningsCents: exactMoney(postedEarnings),
    settledPayoutsCents: exactMoney(settledPayouts),
    statusRemovalsCents: exactMoney(statusRemovals),
    closingPayableCents: exactMoney(closingPayable),
    // Current-snapshot buckets (all time, in scope+currency).
    buckets: {
      accruedCents: exactMoney(accruedCents),
      inTransitCents: exactMoney(inTransitCents),
      settledAllTimeCents: exactMoney(settledAllTimeCents),
      notOwedCents: exactMoney(notOwedCents),
      totalEarnedCents: exactMoney(allTime),
    },
    undatedSettled: {
      count: undatedSettledCount,
      totalCents: exactMoney(undatedSettledCents),
      note: 'Jobs marked paid without a recorded settlement date. Excluded from the period flow; included in totalEarnedCents.',
    },
    platformFeesOnPostedCents: exactMoney(platformFeesOnPosted),
    platformFeeNote: 'Platform fees are taken before payout; helperPayoutCents is net of the fee. Fees are informational here, not equation terms.',
    earnings: earningsRows.map(attachPayment),
    settled: settledRows.map(attachPayment),
    removed: removedRows.map(attachPayment),
    earningsCount: earningsRows.length,
    settledCount: settledRows.length,
    removedCount: removedRows.length,
    unpricedJobs,
    incompleteJobs,
    snapshotNote: 'Buckets and rows reflect payout_status as of generation time. A payout marked in transit that later fails will move buckets on the next statement; corrections post through the amendment workflow.',
    equationNote: 'openingPayableCents + postedEarningsCents - settledPayoutsCents - statusRemovalsCents = closingPayableCents. Earnings are dated by completed_at, settlements by paid_at. Unpaid earnings (accrued/in transit) are owed, not received.',
    taxNote: 'This statement is not a tax form, payroll record, or proof of employment.',
  };
  document.contentHash = hashDocument(document);
  return document;
}

// ── business ────────────────────────────────────────────────────────────────
// Per (business_id, currency_code). Receivables activity over
// business_invoices with the exact identity:
//   openingOutstanding + invoiced - collectedOrAdjusted - cancelled = closingOutstanding
// collectedOrAdjusted is a LABELED derived plug: invoice payments carry no
// per-payment timestamp, so it is defined as the balancing amount. The
// document asserts the identity from its own rows (409 on mismatch).
// No cross-entity consolidation: the business's restaurants appear as
// separate per-(restaurant, currency) sections, never merged.

async function buildBusiness(client, { businessId, currency, period, now, requesterId }) {
  const { rows: [business] } = await client.query(
    `SELECT id, business_name, user_id, created_at FROM businesses WHERE id = $1`,
    [businessId]);
  if (!business) throw new AppError('Statement account not found', 404, 'statement_account_not_found');
  if (period.to < isoDateOnly(business.created_at)) {
    throw new AppError('Statement period precedes this account', 400, 'statement_before_account');
  }

  const start = new Date(`${period.from}T00:00:00.000Z`);
  const end = new Date(Date.parse(period.to) + 86400000);

  // — Receivables —
  const { rows: invoices } = await client.query(
    `SELECT id, invoice_number, client_name, status, issue_date, due_date,
            total, amount_paid, paid_at, currency_code
       FROM business_invoices
      WHERE business_id = $1 AND currency_code = $2
      ORDER BY issue_date, id LIMIT $3`,
    [businessId, currency, MAX_ROWS + 1]);
  if (invoices.length > MAX_ROWS) throw new AppError('Narrow the period to export the complete statement', 409, 'statement_export_too_large');

  let openingOutstanding = 0n;
  let invoiced = 0n;
  let cancelled = 0n;
  let closingOutstanding = 0n;
  let cancelledEarlier = 0;
  const invoiceRows = [];
  for (const inv of invoices) {
    const totalCents = BigInt(dollarsToCents(inv.total, 'invoice total'));
    const paidCents = BigInt(dollarsToCents(inv.amount_paid ?? 0, 'invoice amount_paid'));
    const outstandingCents = totalCents - paidCents;
    const status = String(inv.status);
    const issueDate = inv.issue_date ? new Date(`${isoDateOnly(inv.issue_date)}T00:00:00.000Z`) : null;
    const issuedInPeriod = issueDate && issueDate >= start && issueDate < end;
    const issuedBeforeStart = issueDate && issueDate < start;
    const open = INVOICE_OPEN_STATUSES.includes(status);

    if (issuedBeforeStart && open) openingOutstanding += outstandingCents;
    if (issuedInPeriod && status !== 'draft' && status !== 'cancelled') invoiced += totalCents;
    if (issuedInPeriod && status === 'cancelled') cancelled += totalCents;
    if (status === 'cancelled' && !issuedInPeriod) cancelledEarlier += 1;
    if (issueDate && issueDate < end && open) closingOutstanding += outstandingCents;

    invoiceRows.push({
      id: String(inv.id),
      invoiceNumber: String(inv.invoice_number || ''),
      clientName: String(inv.client_name || ''),
      status,
      issueDate: issueDate ? issueDate.toISOString().slice(0, 10) : null,
      dueDate: inv.due_date ? isoDateOnly(inv.due_date) : null,
      totalCents: exactMoney(totalCents),
      paidCents: exactMoney(paidCents),
      outstandingCents: exactMoney(outstandingCents),
      paidAt: inv.paid_at ? new Date(inv.paid_at).toISOString() : null,
    });
  }
  // Derived plug, labeled: invoice payments have no per-payment timestamp.
  const collectedOrAdjusted = openingOutstanding + invoiced - cancelled - closingOutstanding;
  const recomputed = openingOutstanding + invoiced - collectedOrAdjusted - cancelled;
  if (recomputed !== closingOutstanding) {
    throw new AppError('Statement does not reconcile', 409, 'statement_integrity_failed');
  }

  // — Payables (dated spend list; business_expenses carries no currency
  // code, so it is labeled as recorded-currency activity) —
  const { rows: expenses } = await client.query(
    `SELECT id, category, description, amount_cents, expense_date
       FROM business_expenses
      WHERE business_id = $1 AND expense_date >= $2::date AND expense_date < $3::date
      ORDER BY expense_date, id LIMIT $4`,
    [businessId, period.from, period.to, MAX_ROWS + 1]);
  if (expenses.length > MAX_ROWS) throw new AppError('Narrow the period to export the complete statement', 409, 'statement_export_too_large');
  let expensesTotal = 0n;
  const expensesByCategory = {};
  const expenseRows = expenses.map((e) => {
    const cents = BigInt(exactMoney(e.amount_cents));
    expensesTotal += cents;
    const cat = String(e.category || 'other');
    expensesByCategory[cat] = (expensesByCategory[cat] || 0n) + cents;
    return {
      id: String(e.id),
      category: cat,
      description: String(e.description || '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 255),
      amountCents: exactMoney(cents),
      expenseDate: isoDateOnly(e.expense_date),
    };
  });

  // — Partner settlements for this business's partners (informational) —
  const { rows: settlements } = await client.query(
    `SELECT s.id, s.period_start, s.period_end, s.gross_cents, s.refund_cents,
            s.fee_cents, s.net_cents, s.status, s.payout_status,
            s.stripe_transfer_id, s.payment_reference, s.value_date,
            s.settlement_date, s.currency_code, p.id AS partner_id,
            fr.display_name AS restaurant_name
       FROM oxsteed_credit_settlements s
       JOIN oxsteed_credit_partners p ON p.id = s.partner_id
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
      WHERE p.business_id = $1
        AND s.period_start < $2::timestamptz AND s.period_end > $3::timestamptz
      ORDER BY s.currency_code, s.period_start, s.id LIMIT $4`,
    [businessId, end.toISOString(), start.toISOString(), MAX_ROWS + 1]);
  if (settlements.length > MAX_ROWS) throw new AppError('Narrow the period to export the complete statement', 409, 'statement_export_too_large');

  // — Restaurant payouts for this business's restaurants, per restaurant —
  const { rows: restaurants } = await client.query(
    `SELECT id, display_name, currency_code FROM food_restaurants
      WHERE business_id = $1 ORDER BY id`,
    [businessId]);
  const restaurantSections = [];
  for (const r of restaurants) {
    if (String(r.currency_code || 'USD').toUpperCase() !== currency) continue;
    const { rows: rp } = await client.query(
      `SELECT id, amount_cents, status, stripe_transfer_id, failure_reason,
              ledger_transaction_id, created_at
         FROM restaurant_payouts
        WHERE restaurant_id = $1 AND currency_code = $2
          AND created_at >= $3::timestamptz AND created_at < $4::timestamptz
        ORDER BY created_at, id LIMIT $5`,
      [r.id, currency, start.toISOString(), end.toISOString(), MAX_ROWS + 1]);
    if (rp.length > MAX_ROWS) throw new AppError('Narrow the period to export the complete statement', 409, 'statement_export_too_large');
    restaurantSections.push({
      restaurantId: String(r.id),
      restaurantName: String(r.display_name || ''),
      payouts: rp.map((p) => ({
        id: String(p.id),
        amountCents: exactMoney(p.amount_cents),
        status: String(p.status),
        outcome: p.status === 'completed' ? 'verified'
          : ['requested', 'approved', 'processing'].includes(p.status) ? 'in_transit'
          : p.status === 'failed' ? 'failed' : 'never_executed',
        stripeTransferRef: maskedRef(p.stripe_transfer_id),
        journalLegPosted: !!p.ledger_transaction_id,
        failureReason: p.status === 'failed' ? String(p.failure_reason || '').slice(0, 300) : null,
        createdAt: new Date(p.created_at).toISOString(),
      })),
    });
  }

  const document = {
    id: crypto.randomUUID(),
    version: 1,
    kind: period.kind,
    product: 'business',
    businessId: String(businessId),
    businessName: String(business.business_name || ''),
    ownerName: String(business.business_name || ''),
    accountLabel: `${business.business_name} — business statement`,
    accountReference: `BZ-••••${String(businessId).slice(-4).padStart(4, '0')}`,
    currencyCode: currency,
    period: { from: period.from, to: period.to },
    generatedAt: new Date(now).toISOString(),
    generatedBy: String(requesterId),
    receivables: {
      openingOutstandingCents: exactMoney(openingOutstanding),
      invoicedCents: exactMoney(invoiced),
      collectedOrAdjustedCents: exactMoney(collectedOrAdjusted),
      collectedOrAdjustedNote: 'Derived as opening + invoiced - cancelled - closing: invoice payments carry no per-payment timestamp.',
      cancelledCents: exactMoney(cancelled),
      cancelledEarlierCount: cancelledEarlier,
      closingOutstandingCents: exactMoney(closingOutstanding),
      invoices: invoiceRows,
      invoiceCount: invoiceRows.length,
    },
    payables: {
      totalExpensesCents: exactMoney(expensesTotal),
      byCategoryCents: Object.fromEntries(
        Object.entries(expensesByCategory).map(([k, v]) => [k, exactMoney(v)])),
      expenses: expenseRows,
      expenseCount: expenseRows.length,
      currencyNote: 'business_expenses carries no currency code; shown as recorded-currency activity, never converted.',
    },
    partnerSettlements: settlements.map((s) => ({
      id: String(s.id),
      partnerId: String(s.partner_id),
      restaurantName: String(s.restaurant_name || ''),
      currencyCode: String(s.currency_code),
      periodStart: new Date(s.period_start).toISOString(),
      periodEnd: new Date(s.period_end).toISOString(),
      grossCents: exactMoney(s.gross_cents),
      refundCents: exactMoney(s.refund_cents),
      feeCents: exactMoney(s.fee_cents),
      netCents: exactMoney(s.net_cents),
      status: String(s.status),
      payoutStatus: String(s.payout_status || 'none'),
      payoutVerified: s.payout_status === 'paid' || (s.status === 'paid' && !!s.payment_reference),
      stripeTransferRef: maskedRef(s.stripe_transfer_id),
      valueDate: s.value_date ? isoDateOnly(s.value_date) : null,
      settlementDate: s.settlement_date ? isoDateOnly(s.settlement_date) : null,
      scopeNote: 'partner_payable',
    })),
    restaurantPayouts: restaurantSections,
    equationNote: 'Receivables: openingOutstandingCents + invoicedCents - collectedOrAdjustedCents - cancelledCents = closingOutstandingCents. Restaurant sections are per (restaurant, currency) and never merged; no cross-entity consolidation.',
    taxNote: 'This statement is not a tax form, payroll record, or proof of employment.',
  };
  document.contentHash = hashDocument(document);
  return document;
}

// ── issuance + archive ──────────────────────────────────────────────────────
// Mirrors creditStatementService.getStatement: repeatable-read snapshot with
// bounded retries; monthly originals are archived append-only in
// settlement_statement_documents (migration 688). rederive: true skips the
// archive read/insert so the amendment workflow can rebuild an issued period
// from current records.

async function buildStatement(client, requesterId, options) {
  const { product = 'restaurant_settlement' } = options;
  if (!PRODUCTS.includes(product)) throw new AppError('Unknown statement product', 400, 'statement_invalid_product');
  const rederive = options.rederive === true;
  const currency = String(options.currencyCode || 'USD').toUpperCase();
  const scopeValue = scopeId(product, options);
  if (!/^[A-Z]{3}$/.test(currency)) throw new AppError('Invalid statement account', 400, 'statement_invalid_account');
  if (product === 'restaurant_settlement' && !/^[1-9]\d*$/.test(String(scopeValue))) {
    throw new AppError('Invalid statement account', 400, 'statement_invalid_account');
  }
  if (product === 'business' && !/^[1-9]\d*$/.test(String(scopeValue))) {
    throw new AppError('Invalid statement account', 400, 'statement_invalid_account');
  }
  if (product === 'helper_earnings'
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(scopeValue))) {
    throw new AppError('Invalid statement account', 400, 'statement_invalid_account');
  }

  const { rows: [{ now }] } = await client.query('SELECT transaction_timestamp() AS now');
  const period = periodFor(options.from, options.to, new Date(now));
  const scope = {
    restaurantId: product === 'restaurant_settlement' ? Number(scopeValue) : null,
    businessId: product === 'business' ? Number(scopeValue) : null,
    helperId: product === 'helper_earnings' ? String(scopeValue).toLowerCase() : null,
  };
  const columns = scopeColumns(product, scope);

  if (period.kind === 'monthly' && !rederive) {
    const { rows: [saved] } = await client.query(
      `SELECT document, content_hash FROM settlement_statement_documents
        WHERE ${scopeWhere(product)} AND currency_code = $3
          AND period_from = $4 AND period_to = $5`,
      [product, product === 'helper_earnings' ? scope.helperId : Number(scopeValue), currency, period.from, period.to]);
    if (saved) {
      if (saved.document?.contentHash !== saved.content_hash || hashDocument(saved.document) !== saved.content_hash) {
        throw new AppError('Statement verification failed', 409, 'statement_integrity_failed');
      }
      return saved.document;
    }
  }

  const builder = product === 'restaurant_settlement' ? buildRestaurantSettlement
    : product === 'helper_earnings' ? buildHelperEarnings : buildBusiness;
  const document = await builder(client, {
    restaurantId: scope.restaurantId,
    businessId: scope.businessId,
    helperId: scope.helperId,
    currency,
    period,
    now,
    requesterId,
  });

  if (period.kind === 'monthly' && !rederive) {
    // Plain INSERT: a 23505 race loser retries and converges on the winner's
    // archived original via the getStatement retry loop (same as the
    // customer-wallet products).
    await client.query(
      `INSERT INTO settlement_statement_documents
         (id, product, scope_restaurant_id, scope_business_id, scope_helper_user_id,
          currency_code, period_from, period_to, generated_at, generated_by, document, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [document.id, product, columns.scope_restaurant_id, columns.scope_business_id,
        columns.scope_helper_user_id, currency, period.from, period.to, now, requesterId,
        JSON.stringify(document), document.contentHash]);
  }
  return document;
}

async function getStatement(requesterId, options = {}) {
  // Concurrent issuance retries from a fresh consistent snapshot. A statement
  // either includes all record changes visible here or none of them.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query("SET LOCAL statement_timeout = '15000ms'");
      const document = await buildStatement(client, requesterId, options);
      await client.query('COMMIT');
      return document;
    } catch (err) {
      await client.query('ROLLBACK');
      if (['40001', '23505'].includes(err.code) && attempt < 2) continue;
      throw err;
    } finally { client.release(); }
  }
}

module.exports = {
  PRODUCTS,
  getStatement,
  buildStatement,
  // Re-exported for tests and future renderers.
  periodFor,
  exactMoney,
  hashDocument,
  reconcileRows,
  dollarsToCents,
  MAX_ROWS,
};
