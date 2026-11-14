'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');

/**
 * Decision Q3 (2026-10-31): a refund landing between payout calculation
 * and transfer VOIDS the claimed commission and ADJUSTS the payout total.
 * The payout row stays the source of truth.
 *
 * Called from the marketplace refund settlement transaction, after the
 * order flips to 'refunded', so the void and the refund commit or roll
 * back together.
 *
 * Boundaries (fail closed):
 * - Only commissions already claimed (status 'confirmed') into a payout
 *   that is still 'pending' are voided. A payout in 'processing' has a
 *   transfer in flight, so it is left untouched: the transfer's own
 *   amount checks and failure path own that window. A 'completed'
 *   payout's commissions are 'paid' and never match the filter.
 * - Unclaimed ('pending', payout_id NULL) commissions are left alone;
 *   the item-42 calculation exclusion already keeps them out of any
 *   future payout.
 * - A payout whose total empties is marked 'failed' with an explicit
 *   reason, so no zero-amount transfer is ever attempted against it.
 * - The void is idempotent: re-running finds no 'confirmed' rows, so it
 *   voids nothing the second time.
 */
async function voidClaimedCommissionsForRefund(client, orderId) {
  // Lock the pending payouts holding this order's claimed commissions.
  // A concurrent transfer claim (UPDATE affiliate_payouts ... WHERE
  // status = 'pending') blocks on these row locks and then re-reads the
  // adjusted row, where the approval TOCTOU check fails it closed if
  // the amount moved. Conversely, if the claim already committed, the
  // payout reads 'processing' here and is skipped.
  const locked = await client.query(
    `SELECT ap.id AS payout_id
       FROM affiliate_payouts ap
       JOIN affiliate_commissions ac ON ac.payout_id = ap.id
      WHERE ac.order_id = $1 AND ac.status = 'confirmed' AND ap.status = 'pending'
      FOR UPDATE OF ap`,
    [orderId]
  );
  if (!locked.rows.length) {
    return { voidedCount: 0, voidedCents: 0, payouts: [], orderId };
  }

  const voided = await client.query(
    `UPDATE affiliate_commissions ac
        SET status = 'void'
       FROM affiliate_payouts ap
      WHERE ac.payout_id = ap.id
        AND ac.order_id = $1
        AND ac.status = 'confirmed'
        AND ap.status = 'pending'
      RETURNING ac.id, ac.commission_cents, ac.payout_id, ap.affiliate_program_id`,
    [orderId]
  );
  if (!voided.rows.length) {
    return { voidedCount: 0, voidedCents: 0, payouts: [], orderId };
  }

  // Group by payout (an order's commissions can span payouts in theory).
  const byPayout = new Map();
  for (const row of voided.rows) {
    const key = String(row.payout_id);
    const entry = byPayout.get(key) || {
      payoutId: row.payout_id,
      programId: row.affiliate_program_id,
      cents: 0n,
      count: 0,
    };
    entry.cents += BigInt(row.commission_cents);
    entry.count += 1;
    byPayout.set(key, entry);
  }

  const payouts = [];
  for (const entry of byPayout.values()) {
    const sum = entry.cents.toString();
    await client.query(
      `UPDATE affiliate_payouts
          SET total_commission_cents = GREATEST(total_commission_cents - $2, 0),
              commission_count = GREATEST(commission_count - $3, 0),
              status = CASE WHEN total_commission_cents - $2 <= 0 THEN 'failed' ELSE status END,
              failed_reason = CASE WHEN total_commission_cents - $2 <= 0 THEN 'all_commissions_voided_by_refund' ELSE failed_reason END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'pending'`,
      [entry.payoutId, sum, entry.count]
    );
    // Mirror the transfer-failure path: a voided commission is no longer
    // pending payout money and no longer earned commission.
    await client.query(
      `UPDATE affiliate_programs
          SET pending_cents = GREATEST(pending_cents - $2, 0),
              total_commission_cents = GREATEST(total_commission_cents - $2, 0)
        WHERE id = $1`,
      [entry.programId, sum]
    );
    payouts.push({ payoutId: entry.payoutId, programId: entry.programId, voidedCents: sum, voidedCount: entry.count });
  }

  const totalCents = [...byPayout.values()].reduce((acc, e) => acc + e.cents, 0n).toString();
  logger.info('Affiliate commissions voided by post-calculation refund', {
    orderId,
    voidedCount: voided.rows.length,
    voidedCents: totalCents,
    payoutIds: payouts.map((p) => String(p.payoutId)),
  });
  return { voidedCount: voided.rows.length, voidedCents: totalCents, payouts, orderId };
}

/**
 * Notifications audit item 54: a refund-void notified nobody. Call this
 * AFTER the refund settlement transaction commits (never inside it: a
 * rolled-back void must not produce a "voided" notice). One notice per
 * affected payout, through the shared sendNotification path (in-app row +
 * email leg via emailTypes); a notify failure is logged, never fatal.
 * The idempotency key is per (payout, order), so a reconciled replay
 * cannot double-notify.
 */
async function notifyVoidedAffiliates(voidResult) {
  const payouts = voidResult?.payouts || [];
  if (!payouts.length) return { notified: 0 };
  let notified = 0;
  for (const payout of payouts) {
    try {
      const { rows: [program] } = await pool.query(
        'SELECT helper_id FROM affiliate_programs WHERE id = $1',
        [payout.programId || null]
      );
      // The voided rows carry affiliate_program_id; fall back to the
      // payout's program when the caller did not include it.
      let ownerId = program?.helper_id || null;
      if (!ownerId && payout.payoutId != null) {
        const { rows: [row] } = await pool.query(
          `SELECT aprg.helper_id FROM affiliate_payouts ap
             JOIN affiliate_programs aprg ON ap.affiliate_program_id = aprg.id
            WHERE ap.id = $1`,
          [payout.payoutId]
        );
        ownerId = row?.helper_id || null;
      }
      if (!ownerId) {
        logger.warn('Affiliate void notice skipped: no program owner', { payoutId: payout.payoutId });
        continue;
      }
      await sendNotification({
        userId: ownerId,
        type: 'affiliate_payout_voided',
        data: {
          payout_id: payout.payoutId,
          voided_cents: Number(payout.voidedCents) || 0,
          voided_count: payout.voidedCount,
          order_id: voidResult.orderId,
          params: { payoutId: payout.payoutId, voidedCount: payout.voidedCount },
        },
        action_url: '/affiliate',
        idempotencyKey: `affiliate-payout:voided:${payout.payoutId}:${voidResult.orderId}`,
      });
      notified += 1;
    } catch (err) {
      logger.warn('Failed to notify affiliate of voided payout', { payoutId: payout.payoutId, error: err.message });
    }
  }
  return { notified };
}

module.exports = { voidClaimedCommissionsForRefund, notifyVoidedAffiliates };
