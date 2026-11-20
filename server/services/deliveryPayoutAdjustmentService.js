'use strict';

// Group 9 Slice F (item 493): payout adjustment explanations.
//
// The payout lifecycle accepted an ops note on approve/void/mark-paid
// but never persisted a reason for an AMOUNT change, and the driver
// history table showed amount/status/reference/date only — so a driver
// whose payout changed had no way to learn what changed, why, or by
// whom. An adjustment is now a persisted row (previous/new amounts, a
// required reason, the adjusting operator), written in the same
// transaction as the payout rewrite, so the explanation can never be
// invented client-side or drift from the amount. Only accrued or
// approved payouts can be adjusted: a paid payout is money that
// already moved, and a voided one is closed. Adjusting never changes
// the payout status, the approver, or the payment reference.

const AppError = require('../utils/appError');
const { getPayout } = require('./deliveryDriverPayoutService');

function fail(message, code, status = 409) {
  throw new AppError(message, status, code);
}

async function adjustPayout(client, payoutId, actorUserId, newPayoutCents, reason) {
  const payout = await getPayout(client, payoutId, { lock: true });
  if (!['accrued', 'approved'].includes(payout.status)) {
    fail(`A ${payout.status} payout cannot be adjusted`, 'driver_payout_adjustment_invalid');
  }
  const nextCents = Number(newPayoutCents);
  if (!Number.isInteger(nextCents) || nextCents <= 0) {
    fail('The adjusted payout amount must be a positive number of cents', 'driver_payout_adjustment_invalid', 400);
  }
  const cleanReason = String(reason || '').trim().slice(0, 1000);
  if (cleanReason.length < 10) {
    fail('An adjustment needs a reason of at least 10 characters', 'driver_payout_adjustment_reason_required', 400);
  }
  if (nextCents === Number(payout.payout_cents)) {
    fail('The adjusted amount is the same as the current payout', 'driver_payout_adjustment_invalid', 400);
  }
  const { rows: [adjustment] } = await client.query(
    `INSERT INTO delivery_payout_adjustments
       (payout_id, previous_payout_cents, new_payout_cents, reason, adjusted_by_user_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [payoutId, payout.payout_cents, nextCents, cleanReason, actorUserId],
  );
  const { rows: [updated] } = await client.query(
    `UPDATE delivery_driver_payouts
        SET payout_cents = $2, updated_at = NOW()
      WHERE id = $1 AND status IN ('accrued', 'approved')
      RETURNING *`,
    [payoutId, nextCents],
  );
  if (!updated) fail('Payout status changed concurrently');
  return { payout: updated, adjustment };
}

async function listPayoutAdjustments(db, payoutId) {
  const { rows } = await db.query(
    `SELECT a.*, u.email AS adjusted_by_email, u.first_name, u.last_name
       FROM delivery_payout_adjustments a
       LEFT JOIN users u ON u.id = a.adjusted_by_user_id
      WHERE a.payout_id = $1 ORDER BY a.created_at DESC, a.id DESC`,
    [payoutId],
  );
  return rows;
}

// Attachments for the payout list reads: one query per list, keyed by
// payout id, so the driver history and the ops list can both show the
// explanation without N+1 reads.
async function listAdjustmentsForPayouts(db, payoutIds) {
  if (!payoutIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT a.*, u.email AS adjusted_by_email, u.first_name, u.last_name
       FROM delivery_payout_adjustments a
       LEFT JOIN users u ON u.id = a.adjusted_by_user_id
      WHERE a.payout_id = ANY($1::bigint[])
      ORDER BY a.created_at DESC, a.id DESC`,
    [payoutIds],
  );
  const byPayout = new Map();
  for (const row of rows) {
    if (!byPayout.has(String(row.payout_id))) byPayout.set(String(row.payout_id), []);
    byPayout.get(String(row.payout_id)).push(row);
  }
  return byPayout;
}

module.exports = { adjustPayout, listPayoutAdjustments, listAdjustmentsForPayouts };
