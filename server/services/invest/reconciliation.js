'use strict';

/**
 * Investment reconciliation: verifies that every financial event
 * reconciles across the Credit ledger, the investment domain tables,
 * and the settlement records, and reports differences.
 *
 * It NEVER silently corrects anything. A difference is a finding for
 * an operator to investigate; the function only reports.
 *
 * Checks (each produces a difference entry with a stable code):
 * 1. lot_balance: for every customer wallet that has lots, the sum of
 *    lot remaining balances equals the wallet balance_cents. A capture
 *    debits both together through the journal; a mismatch means a lot
 *    write and a journal write disagreed.
 * 2. reservation: the sum of reserved commitments per wallet equals the
 *    sum of active oxsteed_credit_reservations for that wallet, and
 *    every reserved commitment has exactly one active reservation row.
 * 3. subledger_pending: the pending_reservations journal total equals
 *    the sum of reserved commitments.
 * 4. subledger_completed: the completed_contributions journal total
 *    equals the sum of completed commitments.
 * 5. subledger_cancelled: the cancelled_released journal total equals
 *    the sum of cancelled commitments.
 * 6. proceeds: the proceeds_awaiting_release journal total equals the
 *    sum of awaiting-release proceeds rows, and the released_proceeds
 *    total equals the sum of released proceeds rows.
 * 7. distributions: the distributions journal total equals the sum of
 *    credited distributions.
 * 8. settlement_expectation: every reserved commitment has a
 *    pending_partner_confirmation or confirmed escrow settlement row.
 *
 * Read-only: no transaction, no writes, no locks beyond the queries.
 */

const pool = require('../../db');

async function reconcileInvestments(input = {}, dbPool = pool) {
  const { opportunityId = null, customerId = null } = input;
  const differences = [];
  const add = (code, details) => differences.push({ code, ...details });

  const scope = (sql, params) => dbPool.query(sql, params);
  // When scoped to one opportunity, the wallet-level checks (lots and
  // active reservations) cover only the customers with a commitment in
  // that opportunity; otherwise every other opportunity's live
  // reservations would read as mismatches against this scope.
  const scopedCustomerFilter = opportunityId
    ? `AND l.customer_id IN (SELECT user_id FROM investment_commitments WHERE opportunity_id = $2::uuid)`
    : '';
  const scopedReservationFilter = opportunityId
    ? `AND a.customer_id IN (SELECT user_id FROM investment_commitments WHERE opportunity_id = $2::uuid)`
    : '';

  // 1. Lot remaining totals vs wallet balances.
  const { rows: lotRows } = await scope(
    `SELECT l.customer_id, l.currency_code,
            COALESCE(SUM(l.remaining_cents), 0)::bigint AS lots_remaining,
            a.id AS account_id, a.balance_cents
       FROM oxsteed_credit_balance_lots l
       JOIN oxsteed_credit_accounts a
         ON a.id = l.account_id
      WHERE ($1::uuid IS NULL OR l.customer_id = $1::uuid)
        ${scopedCustomerFilter}
      GROUP BY l.customer_id, l.currency_code, a.id, a.balance_cents`,
    [customerId || null, opportunityId || null],
  );
  for (const row of lotRows) {
    if (Number(row.lots_remaining) !== Number(row.balance_cents)) {
      add('lot_balance_mismatch', {
        customerId: String(row.customer_id),
        currencyCode: row.currency_code,
        lotsRemainingCents: Number(row.lots_remaining),
        walletBalanceCents: Number(row.balance_cents),
        differenceCents: Number(row.lots_remaining) - Number(row.balance_cents),
      });
    }
  }

  // 2. Reserved commitments vs active Credit reservations.
  const { rows: commitmentRows } = await scope(
    `SELECT c.id, c.user_id, c.currency_code, c.amount_cents, c.credit_reservation_id,
            r.status AS reservation_status, r.amount_cents AS reservation_cents
       FROM investment_commitments c
       LEFT JOIN oxsteed_credit_reservations r ON r.id = c.credit_reservation_id
      WHERE c.status = 'reserved'
        AND ($1::uuid IS NULL OR c.opportunity_id = $1::uuid)
        AND ($2::uuid IS NULL OR c.user_id = $2::uuid)`,
    [opportunityId || null, customerId || null],
  );
  const reservationByWallet = new Map();
  for (const row of commitmentRows) {
    const key = `${row.user_id}:${row.currency_code}`;
    reservationByWallet.set(key, (reservationByWallet.get(key) || 0) + Number(row.amount_cents || 0));
    if (!row.credit_reservation_id || row.reservation_status !== 'active') {
      add('reservation_missing', {
        commitmentId: String(row.id),
        customerId: String(row.user_id),
        amountCents: Number(row.amount_cents || 0),
        reservationStatus: row.reservation_status || null,
      });
    } else if (Number(row.reservation_cents) !== Number(row.amount_cents)) {
      add('reservation_amount_mismatch', {
        commitmentId: String(row.id),
        commitmentCents: Number(row.amount_cents || 0),
        reservationCents: Number(row.reservation_cents || 0),
      });
    }
  }
  const { rows: activeReservationRows } = await scope(
    `SELECT a.customer_id, a.currency_code,
            COALESCE(SUM(r.amount_cents), 0)::bigint AS reserved_cents
       FROM oxsteed_credit_reservations r
       JOIN oxsteed_credit_accounts a ON a.id = r.account_id
      WHERE r.status = 'active' AND r.reference_type = 'investment_commitment'
        AND ($1::uuid IS NULL OR a.customer_id = $1::uuid)
        ${scopedReservationFilter}
      GROUP BY a.customer_id, a.currency_code`,
    [customerId || null, opportunityId || null],
  );
  for (const row of activeReservationRows) {
    const key = `${row.customer_id}:${row.currency_code}`;
    const expected = reservationByWallet.get(key) || 0;
    if (Number(row.reserved_cents) !== expected) {
      add('reservation_total_mismatch', {
        customerId: String(row.customer_id),
        currencyCode: row.currency_code,
        reservationTotalCents: Number(row.reserved_cents),
        commitmentTotalCents: expected,
      });
    }
  }

  // 3-7. Subledger journal totals vs domain tables.
  const { rows: ledgerRows } = await scope(
    `SELECT category, COALESCE(SUM(amount_cents), 0)::bigint AS total_cents
       FROM investment_ledger_entries
      WHERE ($1::uuid IS NULL OR opportunity_id = $1::uuid)
        AND ($2::uuid IS NULL OR user_id = $2::uuid)
      GROUP BY category`,
    [opportunityId || null, customerId || null],
  );
  const ledger = Object.fromEntries(ledgerRows.map((row) => [row.category, Number(row.total_cents || 0)]));
  const ledgerTotal = (category) => ledger[category] || 0;

  const { rows: domainRows } = await scope(
    `SELECT
       (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM investment_commitments
         WHERE status = 'reserved'
           AND ($1::uuid IS NULL OR opportunity_id = $1::uuid)
           AND ($2::uuid IS NULL OR user_id = $2::uuid)) AS reserved_total,
       (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM investment_commitments
         WHERE status = 'completed'
           AND ($1::uuid IS NULL OR opportunity_id = $1::uuid)
           AND ($2::uuid IS NULL OR user_id = $2::uuid)) AS completed_total,
       (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM investment_commitments
         WHERE status = 'cancelled'
           AND ($1::uuid IS NULL OR opportunity_id = $1::uuid)
           AND ($2::uuid IS NULL OR user_id = $2::uuid)) AS cancelled_total,
       (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM investment_proceeds
         WHERE status = 'awaiting_release'
           AND ($1::uuid IS NULL OR opportunity_id = $1::uuid)) AS proceeds_awaiting_total,
       (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM investment_proceeds
         WHERE status = 'released'
           AND ($1::uuid IS NULL OR opportunity_id = $1::uuid)) AS proceeds_released_total,
       (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM investment_distributions
         WHERE status = 'credited'
           AND ($1::uuid IS NULL OR opportunity_id = $1::uuid)
           AND ($2::uuid IS NULL OR user_id = $2::uuid)) AS distributions_total`,
    [opportunityId || null, customerId || null],
  );
  const domain = domainRows[0] || {};
  const check = (code, journalCents, domainCents) => {
    if (Number(journalCents) !== Number(domainCents)) {
      add(code, { journalCents: Number(journalCents), domainCents: Number(domainCents), differenceCents: Number(journalCents) - Number(domainCents) });
    }
  };
  check('subledger_pending_mismatch', ledgerTotal('pending_reservations'), Number(domain.reserved_total || 0));
  check('subledger_completed_mismatch', ledgerTotal('completed_contributions'), Number(domain.completed_total || 0));
  check('subledger_cancelled_mismatch', ledgerTotal('cancelled_released'), Number(domain.cancelled_total || 0));
  check('subledger_proceeds_awaiting_mismatch', ledgerTotal('proceeds_awaiting_release'), Number(domain.proceeds_awaiting_total || 0));
  check('subledger_proceeds_released_mismatch', ledgerTotal('released_proceeds'), Number(domain.proceeds_released_total || 0));
  check('subledger_distributions_mismatch', ledgerTotal('distributions'), Number(domain.distributions_total || 0));

  // 8. Every reserved commitment has an escrow-expectation settlement row.
  const { rows: settlementRows } = await scope(
    `SELECT c.id AS commitment_id, c.user_id, s.status AS settlement_status
       FROM investment_commitments c
       LEFT JOIN investment_settlements s
         ON s.commitment_id = c.id AND s.kind = 'escrow_expectation'
      WHERE c.status = 'reserved'
        AND ($1::uuid IS NULL OR c.opportunity_id = $1::uuid)
        AND ($2::uuid IS NULL OR c.user_id = $2::uuid)`,
    [opportunityId || null, customerId || null],
  );
  for (const row of settlementRows) {
    if (!row.settlement_status || !['pending_partner_confirmation', 'confirmed'].includes(row.settlement_status)) {
      add('settlement_expectation_missing', {
        commitmentId: String(row.commitment_id),
        customerId: String(row.user_id),
        settlementStatus: row.settlement_status || null,
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    opportunityId: opportunityId ? String(opportunityId) : null,
    customerId: customerId ? String(customerId) : null,
    ok: differences.length === 0,
    differenceCount: differences.length,
    differences,
  };
}

module.exports = { reconcileInvestments };
