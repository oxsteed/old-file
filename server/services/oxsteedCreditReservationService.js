'use strict';

/**
 * OxSteed Credit non-hold reservations (Phase 7, gap 11).
 *
 * Holds reserve via reserved_cents without a journal entry; withdrawals and
 * settlement payouts need the same protection while their money is in
 * flight. oxsteed_credit_reservations is the source of truth for those
 * reservations so reconciliation can prove
 *   reserved_cents = SUM(active holds) + SUM(active reservations)
 * per account. Compensating rows only; reservations are never edited in
 * place (a release marks the row released).
 *
 * These helpers run inside the CALLER's transaction (client is passed in),
 * mirroring releaseHoldReservation in oxsteedCreditService.js.
 */

const { AppError } = require('../middleware/errorHandler');

function normalizeText(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function formatReservation(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    reservationType: row.reservation_type,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    amountCents: Number(row.amount_cents || 0),
    status: row.status,
    createdAt: row.created_at || null,
    releasedAt: row.released_at || null,
    releasedReason: row.released_reason || null,
  };
}

/**
 * Reserve amountCents on an account: locks the account, fails closed with
 * 409 credit_insufficient_funds when amount exceeds balance - reserved,
 * increments reserved_cents, and records the reservation row, all in the
 * caller's transaction.
 */
async function reserveFunds(client, { accountId, reservationType, referenceType, referenceId, amountCents }) {
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError('Reservation amount must be a positive integer number of cents', 400, 'credit_reservation_amount_invalid');
  }
  const normalizedType = normalizeText(reservationType, 40);
  const normalizedReferenceType = normalizeText(referenceType, 60);
  const normalizedReferenceId = normalizeText(referenceId, 255);
  if (!accountId || !normalizedType || !normalizedReferenceType || !normalizedReferenceId) {
    throw new AppError('Reservation account, type, and reference are required', 400, 'credit_reservation_reference_required');
  }
  const { rows: accountRows } = await client.query(
    `SELECT id, balance_cents, reserved_cents, status
       FROM oxsteed_credit_accounts
      WHERE id = $1
      FOR UPDATE`,
    [accountId]
  );
  const account = accountRows[0];
  if (!account) throw new AppError('Credit account not found for reservation', 404, 'credit_reservation_account_not_found');
  if (account.status === 'closed') throw new AppError('Credit account is closed', 409, 'credit_account_inactive');
  const available = Number(account.balance_cents || 0) - Number(account.reserved_cents || 0);
  if (amount > available) {
    throw new AppError('Insufficient available OxSteed Credit for reservation', 409, 'credit_insufficient_funds', {
      availableBalanceCents: String(Math.max(0, available)),
      requestedCents: String(amount),
    });
  }
  const { rows } = await client.query(
    `INSERT INTO oxsteed_credit_reservations
       (account_id, reservation_type, reference_type, reference_id, amount_cents)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (reference_type, reference_id) WHERE status = 'active' DO NOTHING
     RETURNING *`,
    [account.id, normalizedType, normalizedReferenceType, normalizedReferenceId, amount]
  );
  if (!rows[0]) {
    // The partial unique index serializes concurrent requests for the same
    // business reference without aborting the caller's transaction. A
    // matching row is an idempotent replay; any mismatch is a conflict.
    const { rows: existingRows } = await client.query(
      `SELECT * FROM oxsteed_credit_reservations
        WHERE reference_type = $1 AND reference_id = $2 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [normalizedReferenceType, normalizedReferenceId]
    );
    const existing = existingRows[0];
    if (existing
      && Number(existing.amount_cents) === amount
      && String(existing.account_id) === String(account.id)) {
      return { reservation: formatReservation(existing), replayed: true };
    }
    throw new AppError('An active reservation already exists for this reference', 409, 'credit_reservation_conflict');
  }
  await client.query(
    `UPDATE oxsteed_credit_accounts
        SET reserved_cents = reserved_cents + $1, updated_at = NOW()
      WHERE id = $2`,
    [amount, account.id]
  );
  return { reservation: formatReservation(rows[0]), replayed: false };
}

/**
 * Release an active reservation: decrements reserved_cents under a
 * WHERE reserved_cents >= amount guard (fail closed with
 * credit_reservation_release_invalid on inconsistency, mirroring
 * releaseHoldReservation) and marks the row released. Releasing an
 * already-released or never-created reservation is a no-op returning
 * { released: false } so pre-Phase-7 rows (withdrawals requested before
 * reservations existed) can still be cancelled/rejected.
 */
async function releaseReservation(client, { reservationId = null, referenceType = null, referenceId = null, reason = null }) {
  let row = null;
  if (reservationId) {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_reservations WHERE id = $1 FOR UPDATE`,
      [reservationId]
    );
    row = rows[0] || null;
  } else {
    const normalizedReferenceType = normalizeText(referenceType, 60);
    const normalizedReferenceId = normalizeText(referenceId, 255);
    if (!normalizedReferenceType || !normalizedReferenceId) {
      throw new AppError('A reservation id or reference is required to release', 400, 'credit_reservation_reference_required');
    }
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_reservations
        WHERE reference_type = $1 AND reference_id = $2 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [normalizedReferenceType, normalizedReferenceId]
    );
    row = rows[0] || null;
  }
  if (!row || row.status !== 'active') return { released: false, reservation: formatReservation(row) };
  const amount = Number(row.amount_cents || 0);
  const { rows: updatedAccounts } = await client.query(
    `UPDATE oxsteed_credit_accounts
        SET reserved_cents = reserved_cents - $1, updated_at = NOW()
      WHERE id = $2 AND reserved_cents >= $1
      RETURNING id`,
    [amount, row.account_id]
  );
  if (!updatedAccounts[0]) {
    throw new AppError('Credit reservation release is inconsistent', 409, 'credit_reservation_release_invalid');
  }
  const { rows: releasedRows } = await client.query(
    `UPDATE oxsteed_credit_reservations
        SET status = 'released', released_at = NOW(), released_reason = $2
      WHERE id = $1
      RETURNING *`,
    [row.id, normalizeText(reason, 500) || null]
  );
  return { released: true, reservation: formatReservation(releasedRows[0]) };
}

async function getActiveReservation(client, { referenceType, referenceId }) {
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_reservations
      WHERE reference_type = $1 AND reference_id = $2 AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalizeText(referenceType, 60), normalizeText(referenceId, 255)]
  );
  return formatReservation(rows[0] || null);
}

module.exports = {
  reserveFunds,
  releaseReservation,
  getActiveReservation,
  formatReservation,
};
