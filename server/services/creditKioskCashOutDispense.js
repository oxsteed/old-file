'use strict';

// G13-B3 (D-754): kiosk cash-out dispense confirmation.
//
// A kiosk cash-out debited the wallet the moment the journal leg posted,
// before any physical cash was dispensed, and nothing reconciled the cash:
// no dispenser integration, no confirmation endpoint, and the closeout's
// `cash_out_reconciled` check compared the ledger against itself. The
// dispense record is the missing leg:
//
// - Every cash-out inserts a `pending` dispense row in the same
//   transaction as the journal leg (see cashOutWithCardInTransaction).
// - The kiosk reports the dispense outcome through
//   POST /kiosk/cash-out/:transactionId/confirm-dispense, authenticated
//   as the same device that took the cash-out.
// - `dispensed` closes the row. `failed` (nothing dispensed) and
//   `partial` (some dispensed) auto-reverse the undispensed value with
//   a `cash_out_reversal` journal leg in the same transaction, so the
//   customer is made whole without waiting for a dispute.
// - A confirm is idempotent per transaction: a second confirm replays
//   the stored outcome and never posts a second reversal.
// - A cash-out with no confirmation stays `pending` and fails the
//   closeout's `cash_out_reconciled` check (see creditKioskCashier),
//   so an unconfirmed dispense can never silently pass a shift close.
//
// There is still no dispenser hardware integration: the confirm endpoint
// is the seam the kiosk client (or the cashier, on a jam) reports
// through. What the endpoint guarantees is that whatever outcome is
// reported is recorded, reconciled at closeout, and — on failure —
// reversed in the ledger.

const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { recordIncident } = require('./incidentStore');
const logger = require('../utils/logger');
const pool = require('../db');
const { postJournalTransaction } = require('./oxsteedCreditService');

const DISPENSE_STATUSES = ['pending', 'dispensed', 'failed', 'partial'];
const TERMINAL_DISPENSE_STATUSES = ['dispensed', 'failed', 'partial'];

function formatDispense(row) {
  if (!row) return null;
  return {
    id: row.id,
    transactionId: String(row.transaction_id),
    kioskDeviceId: Number(row.kiosk_device_id),
    customerId: String(row.customer_id),
    amountCents: Number(row.amount_cents),
    status: row.status,
    dispensedCents: Number(row.dispensed_cents),
    // For a terminal row the reversed value is exactly what was not
    // dispensed; a pending row has reversed nothing yet.
    reversedCents: TERMINAL_DISPENSE_STATUSES.includes(row.status)
      ? Number(row.amount_cents) - Number(row.dispensed_cents)
      : 0,
    reversalTransactionId: row.reversal_transaction_id ? String(row.reversal_transaction_id) : null,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// One dispense row per cash-out, created in the same transaction as the
// journal leg. Idempotent on transaction_id: a replayed cash-out never
// creates a second row.
async function recordCashOutDispense(client, { transactionId, kioskDeviceId, customerId, amountCents }) {
  const { rows: [row] } = await client.query(
    `INSERT INTO oxsteed_credit_cash_out_dispenses
       (transaction_id, kiosk_device_id, customer_id, amount_cents, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (transaction_id) DO NOTHING
     RETURNING *`,
    [transactionId, Number(kioskDeviceId), customerId, Number(amountCents)],
  );
  if (row) return formatDispense(row);
  const { rows: [existing] } = await client.query(
    `SELECT * FROM oxsteed_credit_cash_out_dispenses WHERE transaction_id = $1`,
    [transactionId],
  );
  return formatDispense(existing);
}

function parseDispenseOutcome({ status, dispensedCents, amountCents }) {
  if (!TERMINAL_DISPENSE_STATUSES.includes(status)) {
    throw new AppError('Invalid dispense status', 400, 'credit_cash_out_dispense_invalid');
  }
  const dispensed = Number.parseInt(String(dispensedCents), 10);
  if (!Number.isSafeInteger(dispensed) || dispensed < 0 || dispensed > amountCents) {
    throw new AppError('Invalid dispensed amount', 400, 'credit_cash_out_dispense_invalid');
  }
  // The status must agree with the amount it claims: a failure dispensed
  // nothing, a full dispense dispensed everything, a partial is in between.
  // A mismatch is a caller error, not a state to store.
  if (status === 'failed' && dispensed !== 0) {
    throw new AppError('A failed dispense must report 0 dispensed', 400, 'credit_cash_out_dispense_invalid');
  }
  if (status === 'dispensed' && dispensed !== amountCents) {
    throw new AppError('A full dispense must report the full amount', 400, 'credit_cash_out_dispense_invalid');
  }
  if (status === 'partial' && (dispensed === 0 || dispensed === amountCents)) {
    throw new AppError('A partial dispense must report a partial amount', 400, 'credit_cash_out_dispense_invalid');
  }
  return dispensed;
}

// Confirm the dispense outcome for one cash-out. Device-scoped: another
// device's cash-out is 404, never 403, so its existence cannot be probed
// (same rule as the 684 transaction read).
async function confirmCashOutDispense({ deviceId, transactionId, status, dispensedCents }) {
  let incident = null;
  const result = await withTransaction(pool, async (client) => {
    const { rows: [tx] } = await client.query(
      `SELECT id, transaction_type, status, amount_cents, currency_code,
              debit_account_id, credit_account_id, metadata
         FROM oxsteed_credit_transactions
        WHERE id = $1 AND transaction_type = 'cash_out' AND status = 'posted'
          AND metadata ->> 'kioskDeviceId' = $2`,
      [transactionId, String(deviceId)],
    );
    if (!tx) throw new AppError('Cash-out not found', 404, 'credit_kiosk_cash_out_not_found');
    const amountCents = Number(tx.amount_cents);
    // The ledger has no customer column on transactions; the customer is
    // the owner of the debited wallet account.
    const { rows: [wallet] } = await client.query(
      `SELECT customer_id FROM oxsteed_credit_accounts WHERE id = $1`,
      [tx.debit_account_id],
    );
    const customerId = wallet?.customer_id || null;

    // Pre-change cash-outs have no dispense row: create the pending row
    // from the transaction itself so they are confirmable too.
    let { rows: [dispense] } = await client.query(
      `SELECT * FROM oxsteed_credit_cash_out_dispenses WHERE transaction_id = $1 FOR UPDATE`,
      [tx.id],
    );
    if (!dispense) {
      ({ rows: [dispense] } = await client.query(
        `INSERT INTO oxsteed_credit_cash_out_dispenses
           (transaction_id, kiosk_device_id, customer_id, amount_cents, status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (transaction_id) DO NOTHING
         RETURNING *`,
        [tx.id, Number(deviceId), customerId, amountCents],
      ));
      if (!dispense) {
        ({ rows: [dispense] } = await client.query(
          `SELECT * FROM oxsteed_credit_cash_out_dispenses WHERE transaction_id = $1 FOR UPDATE`,
          [tx.id],
        ));
      }
    }
    if (TERMINAL_DISPENSE_STATUSES.includes(dispense.status)) {
      return { ...formatDispense(dispense), replayed: true };
    }

    const dispensed = parseDispenseOutcome({ status, dispensedCents, amountCents });
    let reversalTransactionId = null;
    const reversalCents = amountCents - dispensed;
    if (reversalCents > 0) {
      // The undispensed value returns to the wallet now, in the same
      // transaction as the confirmation — the customer is not left
      // waiting on a dispute for money the machine never gave them.
      // The idempotency key makes the reversal itself replay-safe if
      // this confirm is ever retried after a crash between the post
      // and the row update.
      const { transaction } = await postJournalTransaction(client, {
        transactionType: 'cash_out_reversal',
        debitAccountId: tx.credit_account_id,
        creditAccountId: tx.debit_account_id,
        amountCents: reversalCents,
        currencyCode: tx.currency_code,
        idempotencyKey: `credit-cash-out-reversal:${tx.id}`,
        actorType: 'kiosk',
        reason: 'Kiosk cash-out dispense failed — undispensed value returned',
        description: 'OxSteed Credit kiosk cash-out reversal',
        referenceType: 'credit_kiosk_cash_out_reversal',
        referenceId: String(tx.id),
        metadata: {
          originalTransactionId: String(tx.id),
          dispensedCents: dispensed,
          kioskDeviceId: String(deviceId),
        },
      });
      reversalTransactionId = transaction.id;
    }

    const { rows: [updated] } = await client.query(
      `UPDATE oxsteed_credit_cash_out_dispenses
          SET status = $2, dispensed_cents = $3, reversal_transaction_id = $4,
              confirmed_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [dispense.id, status, dispensed, reversalTransactionId],
    );
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, customer_id, resource_type, resource_id, after_state)
       VALUES ('credit.card.cash_out_dispense_confirmed', $1, 'credit_transaction', $2, $3::jsonb)`,
      [
        customerId,
        String(tx.id),
        JSON.stringify({
          status, dispensedCents: dispensed, amountCents,
          reversalTransactionId: reversalTransactionId ? String(reversalTransactionId) : null,
          kioskDeviceId: String(deviceId),
        }),
      ],
    );
    if (reversalCents > 0) {
      incident = {
        transactionId: String(tx.id),
        status,
        dispensedCents: dispensed,
        amountCents,
        reversalCents,
      };
    }
    return { ...formatDispense(updated), replayed: false };
  }, 'credit_kiosk_cash_out_confirm_dispense');

  if (incident) {
    try {
      await recordIncident({
        type: 'oxsteed_credit_cash_out_dispense_failed',
        severity: 'critical',
        message: 'Kiosk cash-out dispense failed; undispensed value reversed',
        dedupeKey: `credit-cash-out-dispense-failed:${incident.transactionId}`,
        details: {
          transactionId: incident.transactionId,
          status: incident.status,
          dispensedCents: incident.dispensedCents,
          amountCents: incident.amountCents,
          reversalCents: incident.reversalCents,
        },
      });
    } catch (incidentErr) {
      logger.error('[oxsteed-credit] Failed to record cash-out dispense failure incident', {
        error: incidentErr.message,
      });
    }
  }
  return result;
}

// Dispense facts for one shift window, for the closeout checklist. The
// window is the same device + created_at window the ledger aggregate
// uses, so the two legs are comparable.
async function getCashOutDispenseFacts(client, { deviceId, openedAt, closedAt = null }) {
  const params = [String(deviceId), openedAt];
  let closedCondition = '';
  if (closedAt) {
    params.push(closedAt);
    closedCondition = `AND t.created_at <= $${params.length}::timestamptz`;
  }
  // A cash-out with no dispense row at all (created before G13-B3)
  // is unconfirmed too: its money left the wallet with no record of
  // what the dispenser did. Only a `dispensed`/`partial` confirmation
  // counts toward the dispensed total; `failed` rows dispensed nothing
  // and their value came back through the reversal leg.
  const { rows: [counts] } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE d.status = 'pending')::int AS pending_count,
            COUNT(*) FILTER (WHERE d.id IS NULL)::int AS no_row_count,
            COUNT(*) FILTER (WHERE d.status = 'dispensed')::int AS dispensed_count,
            COUNT(*) FILTER (WHERE d.status = 'failed')::int AS failed_count,
            COUNT(*) FILTER (WHERE d.status = 'partial')::int AS partial_count,
            COALESCE(SUM(d.dispensed_cents), 0)::int AS confirmed_dispensed_cents
       FROM oxsteed_credit_transactions t
       LEFT JOIN oxsteed_credit_cash_out_dispenses d ON d.transaction_id = t.id
      WHERE t.transaction_type = 'cash_out' AND t.status = 'posted'
        AND t.metadata ->> 'kioskDeviceId' = $1
        AND t.created_at >= $2::timestamptz ${closedCondition}`,
    params,
  );
  const reversalParams = [String(deviceId), openedAt];
  let reversalClosed = '';
  if (closedAt) {
    reversalParams.push(closedAt);
    reversalClosed = `AND t.created_at <= $${reversalParams.length}::timestamptz`;
  }
  const { rows: [reversals] } = await client.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(t.amount_cents), 0)::int AS amount_cents
       FROM oxsteed_credit_transactions t
      WHERE t.transaction_type = 'cash_out_reversal'
        AND t.metadata ->> 'kioskDeviceId' = $1
        AND t.created_at >= $2::timestamptz ${reversalClosed}`,
    reversalParams,
  );
  return {
    unconfirmedCount: Number(counts?.pending_count || 0) + Number(counts?.no_row_count || 0),
    dispensedCount: Number(counts?.dispensed_count || 0),
    failedCount: Number(counts?.failed_count || 0),
    partialCount: Number(counts?.partial_count || 0),
    confirmedDispensedCents: Number(counts?.confirmed_dispensed_cents || 0),
    reversedCents: Number(reversals?.amount_cents || 0),
    reversalCount: Number(reversals?.count || 0),
  };
}

module.exports = {
  DISPENSE_STATUSES,
  TERMINAL_DISPENSE_STATUSES,
  formatDispense,
  recordCashOutDispense,
  confirmCashOutDispense,
  getCashOutDispenseFacts,
};
