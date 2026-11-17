'use strict';

/**
 * Investment subledger: the immutable journal behind every investment
 * money movement, integrated with the Credit ledger.
 *
 * Categories (every financial event lands in at least one):
 *   pending_reservations      Credit reserved for a commitment, not yet
 *                             an investment position.
 *   cancelled_released        Reservations released back to the original
 *                             lots on cancellation or unsuccessful close.
 *   completed_contributions   Reservations completed into positions at
 *                             closing (Credit debited from the wallet).
 *   proceeds_awaiting_release Entity proceeds held until closing
 *                             conditions are approved.
 *   released_proceeds         Proceeds released through the settlement
 *                             flow after approved closing.
 *   distributions             Value credited back to investors as Credit.
 *   corrections_reversals     Explicit compensating entries only.
 *
 * Append-only: investment_ledger_entries rejects UPDATE and DELETE at
 * the database level. A correction is a new compensating entry, never
 * an edit. Staff never edit totals directly: every total here is a SUM
 * over this table, and reconciliation proves it against the domain
 * tables. Entries are idempotent on idempotency_key.
 */

const AppError = require('../../utils/appError');

const LEDGER_CATEGORIES = Object.freeze([
  'pending_reservations',
  'cancelled_released',
  'completed_contributions',
  'proceeds_awaiting_release',
  'released_proceeds',
  'distributions',
  'corrections_reversals',
]);

const LEDGER_ENTRY_TYPES = Object.freeze([
  'reservation',
  'release',
  'completion',
  'proceeds_awaiting',
  'proceeds_released',
  'distribution_credit',
  'correction',
  'reversal',
]);

function fail(message, code, status = 400) {
  throw new AppError(message, status, code);
}

function formatEntry(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    entryType: row.entry_type,
    category: row.category,
    opportunityId: row.opportunity_id ? String(row.opportunity_id) : null,
    commitmentId: row.commitment_id ? String(row.commitment_id) : null,
    userId: row.user_id ? String(row.user_id) : null,
    amountCents: Number(row.amount_cents || 0),
    currencyCode: row.currency_code,
    referenceType: row.reference_type || null,
    referenceId: row.reference_id || null,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at || null,
  };
}

/**
 * Append one immutable entry. Signed amount_cents: positive moves value
 * into the category, negative moves it out. A replay of the same
 * idempotency key returns the existing entry.
 */
async function appendEntry(client, input) {
  const {
    entryType, category, opportunityId = null, commitmentId = null, userId = null,
    amountCents, currencyCode = 'USD', referenceType = null, referenceId = null,
    idempotencyKey, metadata = {},
  } = input || {};
  if (!LEDGER_ENTRY_TYPES.includes(entryType)) fail(`Unknown subledger entry type: ${String(entryType)}`, 'invest_ledger_entry_type_invalid');
  if (!LEDGER_CATEGORIES.includes(category)) fail(`Unknown subledger category: ${String(category)}`, 'invest_ledger_category_invalid');
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount === 0) fail('Subledger amount must be a non-zero integer number of cents', 'invest_ledger_amount_invalid');
  if (!idempotencyKey || !String(idempotencyKey).trim()) fail('Subledger entries require an idempotency key', 'invest_ledger_idempotency_required');
  const currency = String(currencyCode || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail('currencyCode must be a 3-letter code', 'invest_ledger_currency_invalid');

  const { rows } = await client.query(
    `INSERT INTO investment_ledger_entries
       (entry_type, category, opportunity_id, commitment_id, user_id,
        amount_cents, currency_code, reference_type, reference_id,
        idempotency_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      entryType, category, opportunityId || null, commitmentId || null, userId || null,
      amount, currency, referenceType || null, referenceId || null,
      String(idempotencyKey).slice(0, 160), JSON.stringify(metadata || {}),
    ],
  );
  if (rows[0]) return { entry: formatEntry(rows[0]), replayed: false };
  const { rows: existing } = await client.query(
    `SELECT * FROM investment_ledger_entries WHERE idempotency_key = $1`,
    [String(idempotencyKey).slice(0, 160)],
  );
  if (!existing[0]) fail('Subledger entry could not be confirmed after an idempotent retry', 'invest_ledger_retry_required', 409);
  return { entry: formatEntry(existing[0]), replayed: true };
}

/** Signed SUM per category, optionally scoped to one opportunity or investor. */
async function getCategoryTotals(client, { opportunityId = null, userId = null, currencyCode = null } = {}) {
  const { rows } = await client.query(
    `SELECT category, COALESCE(SUM(amount_cents), 0)::bigint AS total_cents
       FROM investment_ledger_entries
      WHERE ($1::uuid IS NULL OR opportunity_id = $1::uuid)
        AND ($2::uuid IS NULL OR user_id = $2::uuid)
        AND ($3::text IS NULL OR currency_code = $3)
      GROUP BY category`,
    [opportunityId || null, userId || null, currencyCode || null],
  );
  const totals = Object.fromEntries(LEDGER_CATEGORIES.map((category) => [category, 0]));
  for (const row of rows) totals[row.category] = Number(row.total_cents || 0);
  return totals;
}

/**
 * The eight subledger balances from the brief, computed from the journal.
 * availableEligibleCents is supplied by the caller (creditLots
 * getEligibleBalance) because it is a wallet view, not a journal sum;
 * everything else is a journal SUM, never a stored total.
 */
async function getSubledgerBalances(client, { opportunityId = null, userId = null, currencyCode = 'USD', availableEligibleCents = null } = {}) {
  const totals = await getCategoryTotals(client, { opportunityId, userId, currencyCode });
  return {
    availableEligibleCents,
    pendingReservationsCents: totals.pending_reservations,
    cancelledReleasedCents: totals.cancelled_released,
    completedContributionsCents: totals.completed_contributions,
    proceedsAwaitingReleaseCents: totals.proceeds_awaiting_release,
    releasedProceedsCents: totals.released_proceeds,
    distributionsCents: totals.distributions,
    correctionsReversalsCents: totals.corrections_reversals,
    currencyCode,
  };
}

module.exports = {
  LEDGER_CATEGORIES,
  LEDGER_ENTRY_TYPES,
  appendEntry,
  getCategoryTotals,
  getSubledgerBalances,
};
