'use strict';

/**
 * OxSteed Credit balance lots and eligibility.
 *
 * The wallet used to keep one fungible balance per customer per currency
 * with no record of origin, so eligibility could not be decided. See
 * docs/oxsteed-invest/credit-origin-verification.md (verdict: CANNOT).
 * Lots fix that: every wallet inflow is tagged to exactly one lot, and a
 * lot keeps its source and restrictions for its whole life.
 *
 * Eligibility at launch (the eligible set is purchased settled only in
 * practice, because no earned issuance path exists yet):
 *   purchased    eligible when settled_at is set (completed top-up).
 *   earned       eligible only when settled_at is set AND approval_ref
 *                is set. There is currently NO earned issuance path, so
 *                no earned lot can exist yet; the category is modeled,
 *                never issued without an approval record.
 *   promotional, referral, borrowed, distribution, unknown: NOT eligible.
 *   Any lot with an encumbered portion: only the unencumbered remainder
 *   counts, and a disputed lot contributes nothing while fully encumbered.
 *
 * ASSUMPTION A8 (docs/oxsteed-invest/SETTLEMENT_ASSUMPTIONS.md):
 * eligibility is purchased settled only in practice. The brief allows
 * earned settled plus approved Credit, but there is no earned issuance
 * path and no ledger definition of earned approval, so no earned lot
 * can exist yet; the backfill classifies existing balances as
 * `unknown` (ineligible) except for provably completed top-ups.
 *
 * SPEND-ALLOCATION RULE (the one deterministic rule, applied everywhere):
 * oldest settled eligible lot first (settled_at ascending, then
 * created_at ascending). A commitment records exactly which lots and
 * amounts it consumed in investment_commitment_lots, so a release
 * restores value to the ORIGINAL lots with their original
 * classifications and restrictions, never to the fungible pool.
 *
 * Every function here takes a transaction client and must run inside the
 * caller's transaction. getEligibleBalance locks the account row and the
 * eligible lot rows FOR UPDATE, so the eligibility check and the
 * reservation in the same transaction cannot race.
 */

const AppError = require('../../utils/appError');

const LOT_SOURCES = Object.freeze([
  'purchased', 'earned', 'promotional', 'referral', 'borrowed', 'adjustment', 'distribution', 'unknown',
]);

const ELIGIBLE_SOURCES = Object.freeze(['purchased', 'earned']);

function fail(message, code, status = 400) {
  throw new AppError(message, status, code);
}

function parseAmountCents(value, name = 'amountCents') {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    fail(`${name} must be a positive integer number of cents`, 'invest_lot_amount_invalid');
  }
  return amount;
}

function normalizeCurrency(currencyCode) {
  const currency = String(currencyCode || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail('currencyCode must be a 3-letter code', 'invest_lot_currency_invalid');
  return currency;
}

function formatLot(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    customerId: String(row.customer_id),
    currencyCode: row.currency_code,
    source: row.source,
    amountCents: Number(row.amount_cents || 0),
    remainingCents: Number(row.remaining_cents || 0),
    settledAt: row.settled_at || null,
    approvalRef: row.approval_ref || null,
    disputeStatus: row.dispute_status,
    encumberedCents: Number(row.encumbered_cents || 0),
    originatingTransactionId: row.originating_transaction_id ? String(row.originating_transaction_id) : null,
    topupId: row.topup_id ? String(row.topup_id) : null,
    referenceType: row.reference_type || null,
    referenceId: row.reference_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function isLotEligible(lot) {
  if (!ELIGIBLE_SOURCES.includes(lot.source)) return false;
  if (!lot.settled_at && !lot.settledAt) return false;
  if (lot.source === 'earned' && !lot.approval_ref && !lot.approvalRef) return false;
  return true;
}

/**
 * Tag a wallet inflow to a lot. Idempotent on the inflow identity: a
 * retry for the same top-up or originating journal transaction returns
 * the existing lot instead of double-tagging. Earned lots require an
 * approval reference and a settlement time; purchased lots require a
 * settlement time. Any issuance without a known source creates an
 * `unknown` lot, and `unknown` is ineligible by default.
 */
async function createLot(client, input) {
  const {
    accountId, customerId, currencyCode = 'USD', source,
    amountCents, settledAt = null, approvalRef = null,
    originatingTransactionId = null, topupId = null,
    referenceType = null, referenceId = null, metadata = {},
  } = input || {};
  if (!accountId) fail('accountId is required to create a Credit lot', 'invest_lot_account_required');
  if (!customerId) fail('customerId is required to create a Credit lot', 'invest_lot_customer_required');
  if (!LOT_SOURCES.includes(source)) fail(`Unknown Credit lot source: ${String(source)}`, 'invest_lot_source_invalid');
  const amount = parseAmountCents(amountCents);
  const currency = normalizeCurrency(currencyCode);
  if (source === 'earned' && !approvalRef) {
    fail('Earned Credit lots require an approval reference', 'invest_lot_earned_approval_required');
  }
  if (source === 'earned' && !settledAt) {
    fail('Earned Credit lots require a settlement time', 'invest_lot_earned_settlement_required');
  }
  if (source === 'purchased' && !settledAt) {
    fail('Purchased Credit lots require a settlement time', 'invest_lot_purchased_settlement_required');
  }

  if (topupId || originatingTransactionId) {
    const { rows: existing } = await client.query(
      `SELECT * FROM oxsteed_credit_balance_lots
        WHERE ($1::uuid IS NOT NULL AND topup_id = $1::uuid)
           OR ($2::uuid IS NOT NULL AND originating_transaction_id = $2::uuid)
        LIMIT 1`,
      [topupId || null, originatingTransactionId || null],
    );
    if (existing[0]) return { lot: formatLot(existing[0]), replayed: true };
  }

  const { rows } = await client.query(
    `INSERT INTO oxsteed_credit_balance_lots
       (account_id, customer_id, currency_code, source, amount_cents, remaining_cents,
        settled_at, approval_ref, originating_transaction_id, topup_id,
        reference_type, reference_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
     RETURNING *`,
    [
      accountId, customerId, currency, source, amount,
      settledAt ? new Date(settledAt).toISOString() : null,
      approvalRef || null, originatingTransactionId || null, topupId || null,
      referenceType || null, referenceId || null, JSON.stringify(metadata || {}),
    ],
  );
  return { lot: formatLot(rows[0]), replayed: false };
}

/**
 * Lock the customer wallet account row and return the eligible available
 * amount: eligible lots minus their encumbered portions minus their
 * active commitment allocations, capped by the wallet available balance
 * (balance minus reserved_cents, which already includes the investment
 * reservations through oxsteed_credit_reservations). The cap keeps the
 * lot view and the journal view in agreement: ordinary holds that do
 * not carry lot allocations still reduce what a commitment may take.
 */
async function getEligibleBalance(client, { customerId, currencyCode = 'USD' }) {
  const currency = normalizeCurrency(currencyCode);
  const { rows: accountRows } = await client.query(
    `SELECT * FROM oxsteed_credit_accounts
      WHERE customer_id = $1 AND currency_code = $2 AND account_type = 'customer_wallet'
      FOR UPDATE`,
    [customerId, currency],
  );
  const account = accountRows[0];
  if (!account) {
    return {
      accountId: null, currencyCode: currency, accountStatus: null,
      balanceCents: 0, reservedCents: 0, availableBalanceCents: 0,
      eligibleAvailableCents: 0, lots: [],
    };
  }
  if (account.status !== 'active') {
    return {
      accountId: String(account.id), currencyCode: currency, accountStatus: account.status,
      balanceCents: Number(account.balance_cents || 0),
      reservedCents: Number(account.reserved_cents || 0),
      availableBalanceCents: 0, eligibleAvailableCents: 0, lots: [],
    };
  }

  // Lock the eligible lots in two steps: FOR UPDATE cannot combine with
  // GROUP BY, so first read the candidate ids, lock those rows, then
  // re-read the allocation sums while the locks are held. A concurrent
  // commit blocks on the same lot locks, so the sums cannot change
  // under us after this point.
  const { rows: candidateRows } = await client.query(
    `SELECT l.id
       FROM oxsteed_credit_balance_lots l
      WHERE l.account_id = $1 AND l.currency_code = $2 AND l.source IN ('purchased', 'earned')
      ORDER BY l.settled_at ASC NULLS LAST, l.created_at ASC`,
    [account.id, currency],
  );
  const candidateIds = candidateRows.map((row) => row.id);
  if (!candidateIds.length) {
    const balanceCents = Number(account.balance_cents || 0);
    const reservedCents = Number(account.reserved_cents || 0);
    return {
      accountId: String(account.id), currencyCode: currency, accountStatus: account.status,
      balanceCents, reservedCents,
      availableBalanceCents: Math.max(0, balanceCents - reservedCents),
      eligibleAvailableCents: 0, lots: [],
    };
  }
  await client.query(
    `SELECT id FROM oxsteed_credit_balance_lots WHERE id = ANY($1::uuid[]) FOR UPDATE`,
    [candidateIds],
  );
  const { rows: lotRows } = await client.query(
    `SELECT l.*,
            COALESCE(SUM(CASE WHEN cl.status = 'active' THEN cl.amount_cents ELSE 0 END), 0) AS allocated_cents
       FROM oxsteed_credit_balance_lots l
       LEFT JOIN investment_commitment_lots cl ON cl.lot_id = l.id
      WHERE l.id = ANY($1::uuid[])
      GROUP BY l.id
      ORDER BY l.settled_at ASC NULLS LAST, l.created_at ASC`,
    [candidateIds],
  );

  const lots = [];
  let lotAvailableTotal = 0;
  for (const row of lotRows) {
    if (!isLotEligible(row)) continue;
    const available = Math.max(
      0,
      Number(row.remaining_cents || 0)
        - Number(row.encumbered_cents || 0)
        - Number(row.allocated_cents || 0),
    );
    lotAvailableTotal += available;
    lots.push({ ...formatLot(row), allocatedCents: Number(row.allocated_cents || 0), availableCents: available });
  }

  const balanceCents = Number(account.balance_cents || 0);
  const reservedCents = Number(account.reserved_cents || 0);
  const availableBalanceCents = Math.max(0, balanceCents - reservedCents);
  return {
    accountId: String(account.id),
    currencyCode: currency,
    accountStatus: account.status,
    balanceCents,
    reservedCents,
    availableBalanceCents,
    eligibleAvailableCents: Math.min(lotAvailableTotal, availableBalanceCents),
    lots,
  };
}

/**
 * Oldest settled eligible lot first. Returns the exact lot slices a
 * commitment consumes. Throws 409 when the eligible available amount
 * cannot cover the request; the caller records these slices in
 * investment_commitment_lots in the same transaction.
 */
async function allocateEligibleLots(client, { customerId, currencyCode = 'USD', amountCents }) {
  const amount = parseAmountCents(amountCents);
  const balance = await getEligibleBalance(client, { customerId, currencyCode });
  if (balance.eligibleAvailableCents < amount) {
    fail('Insufficient eligible OxSteed Credit for this commitment', 'invest_insufficient_eligible_credit', 409);
  }
  const allocations = [];
  let remaining = amount;
  for (const lot of balance.lots) {
    if (remaining <= 0) break;
    if (lot.availableCents <= 0) continue;
    const take = Math.min(lot.availableCents, remaining);
    allocations.push({ lotId: lot.id, source: lot.source, amountCents: take });
    remaining -= take;
  }
  if (remaining > 0) {
    fail('Eligible Credit allocation failed after the availability check', 'invest_allocation_failed', 409);
  }
  return { allocations, eligibleBalance: balance };
}

/** Encumber part of a lot for an open dispute; the encumbered portion is ineligible until resolved. */
async function encumberLotForDispute(client, { lotId, amountCents, disputeRef = null }) {
  const amount = parseAmountCents(amountCents);
  const { rows } = await client.query(
    `UPDATE oxsteed_credit_balance_lots
        SET dispute_status = 'encumbered',
            encumbered_cents = encumbered_cents + $2,
            updated_at = NOW()
      WHERE id = $1 AND remaining_cents >= encumbered_cents + $2
      RETURNING *`,
    [lotId, amount],
  );
  if (!rows[0]) fail('Credit lot not found or encumbrance exceeds the lot remainder', 'invest_lot_encumber_failed', 409);
  if (disputeRef) {
    await client.query(
      `UPDATE oxsteed_credit_balance_lots SET metadata = metadata || $2::jsonb WHERE id = $1`,
      [lotId, JSON.stringify({ disputeRef })],
    );
  }
  const { rows: refreshed } = await client.query(`SELECT * FROM oxsteed_credit_balance_lots WHERE id = $1`, [lotId]);
  return formatLot(refreshed[0]);
}

/** Resolve a dispute encumbrance. A resolved lot returns to eligibility; a rejected one stays encumbered. */
async function resolveLotDispute(client, { lotId, resolved, approvalRef = null }) {
  const { rows } = await client.query(
    `UPDATE oxsteed_credit_balance_lots
        SET dispute_status = CASE WHEN $2 THEN 'resolved' ELSE 'encumbered' END,
            encumbered_cents = CASE WHEN $2 THEN 0 ELSE encumbered_cents END,
            approval_ref = COALESCE($3, approval_ref),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [lotId, !!resolved, approvalRef || null],
  );
  if (!rows[0]) fail('Credit lot not found', 'invest_lot_not_found', 404);
  return formatLot(rows[0]);
}

/**
 * Reclassify a lot with an audit record. Never silent: the actor, the
 * reason, and the evidence reference are recorded, and reclassifying to
 * `purchased` requires evidence. Used by the backfill attestation path
 * and by admin review; it is not a way to manufacture eligibility.
 */
async function reclassifyLot(client, { lotId, toSource, actorUserId = null, reason, evidenceRef = null, approvalRef = null }) {
  if (!LOT_SOURCES.includes(toSource)) fail(`Unknown Credit lot source: ${String(toSource)}`, 'invest_lot_source_invalid');
  if (!reason || !String(reason).trim()) fail('A reason is required to reclassify a Credit lot', 'invest_lot_reclassify_reason_required');
  if (toSource === 'purchased' && !evidenceRef) {
    fail('Reclassifying a lot to purchased requires an evidence reference', 'invest_lot_reclassify_evidence_required');
  }
  const { rows: lotRows } = await client.query(
    `SELECT * FROM oxsteed_credit_balance_lots WHERE id = $1 FOR UPDATE`, [lotId],
  );
  const lot = lotRows[0];
  if (!lot) fail('Credit lot not found', 'invest_lot_not_found', 404);
  if (lot.source === toSource) fail('Lot already has that source', 'invest_lot_reclassify_noop', 409);
  if (toSource === 'earned' && !lot.approval_ref && !approvalRef) {
    fail('Earned Credit lots require an approval reference', 'invest_lot_earned_approval_required');
  }
  await client.query(
    `INSERT INTO oxsteed_credit_lot_reclassifications
       (lot_id, from_source, to_source, actor_user_id, reason, evidence_ref)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [lotId, lot.source, toSource, actorUserId || null, String(reason).trim(), evidenceRef || null],
  );
  const { rows } = await client.query(
    `UPDATE oxsteed_credit_balance_lots
        SET source = $2, approval_ref = COALESCE($3, approval_ref), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [lotId, toSource, approvalRef || null],
  );
  return formatLot(rows[0]);
}

async function summarizeLots(client, { customerId, currencyCode = 'USD' }) {
  const currency = normalizeCurrency(currencyCode);
  const { rows } = await client.query(
    `SELECT source,
            COUNT(*)::bigint AS lot_count,
            COALESCE(SUM(amount_cents), 0)::bigint AS amount_cents,
            COALESCE(SUM(remaining_cents), 0)::bigint AS remaining_cents,
            COALESCE(SUM(encumbered_cents), 0)::bigint AS encumbered_cents
       FROM oxsteed_credit_balance_lots
      WHERE customer_id = $1 AND currency_code = $2
      GROUP BY source ORDER BY source`,
    [customerId, currency],
  );
  return rows.map((row) => ({
    source: row.source,
    lotCount: Number(row.lot_count || 0),
    amountCents: Number(row.amount_cents || 0),
    remainingCents: Number(row.remaining_cents || 0),
    encumberedCents: Number(row.encumbered_cents || 0),
    eligible: ELIGIBLE_SOURCES.includes(row.source),
  }));
}

module.exports = {
  LOT_SOURCES,
  ELIGIBLE_SOURCES,
  createLot,
  getEligibleBalance,
  allocateEligibleLots,
  encumberLotForDispute,
  resolveLotDispute,
  reclassifyLot,
  summarizeLots,
  isLotEligible,
};
