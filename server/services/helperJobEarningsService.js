'use strict';
// Group 4 rest (items 186, 189): one job's earnings breakdown for the
// assigned helper, with every difference between the job value and the
// helper's payout explained by a reason code. Read-only; nothing here moves
// money or changes a payout. Amounts come from the job and payment records.
const pool = require('../db');
const AppError = require('../utils/appError');
const { requireHelper } = require('./helperReputationService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const int = (v) => (v == null ? null : Math.round(Number(v)));
const fromMajor = (v) => (v == null ? null : Math.round(Number(v) * 100));

async function jobEarnings(userId, jobId) {
  if (!UUID.test(jobId || '')) throw new AppError('Invalid job', 400, 'validation_failed');
  await requireHelper(pool, userId);
  const { rows: [job] } = await pool.query(
    `SELECT id, title, status, payout_status, currency_code,
            job_value_cents, final_price_cents, platform_fee_cents, broker_fee_cents,
            helper_payout_cents, completed_at
       FROM jobs
      WHERE id = $1 AND assigned_helper_id = $2 AND deleted_at IS NULL`,
    [jobId, userId],
  );
  // Not the assigned helper (or no such job): same answer, no existence leak.
  if (!job) throw new AppError('Job not found', 404, 'not_found');

  const [{ rows: payments }, { rows: changeOrders }] = await Promise.all([
    pool.query(
      `SELECT id, amount, platform_fee, helper_payout, currency, status, escrow_status,
              GREATEST(COALESCE(refunded_amount, 0), COALESCE(refund_amount, 0)) AS refunded, refund_reason,
              captured_at, released_at, refunded_at, created_at
         FROM payments
        WHERE job_id = $1 AND payee_id = $2
        ORDER BY created_at ASC, id ASC`,
      [jobId, userId],
    ),
    pool.query(
      `SELECT co.id, co.price_change_cents, co.decided_at, co.applied_at
         FROM work_agreement_change_orders co
         JOIN work_agreements wa ON wa.id = co.agreement_id
        WHERE wa.job_id = $1 AND co.status = 'approved'
        ORDER BY co.decided_at ASC NULLS LAST, co.created_at ASC`,
      [jobId],
    ),
  ]);

  const jobValueCents = int(job.job_value_cents ?? job.final_price_cents);
  const platformFeeCents = int(job.platform_fee_cents) || 0;
  const brokerFeeCents = int(job.broker_fee_cents) || 0;
  const helperPayoutCents = int(job.helper_payout_cents);

  // 189: explanation lines. Each has a code the client translates and the
  // signed effect in cents on what the helper receives.
  const adjustments = [];
  for (const co of changeOrders) {
    if (int(co.price_change_cents)) {
      adjustments.push({ code: 'change_order', amountCents: int(co.price_change_cents), at: co.applied_at || co.decided_at, reference: co.id });
    }
  }
  if (platformFeeCents) adjustments.push({ code: 'platform_fee', amountCents: -platformFeeCents });
  if (brokerFeeCents) adjustments.push({ code: 'broker_fee', amountCents: -brokerFeeCents });
  for (const p of payments) {
    const refunded = fromMajor(p.refunded);
    if (refunded > 0) adjustments.push({ code: 'refund', amountCents: -refunded, at: p.refunded_at, reference: String(p.id), reason: p.refund_reason || null });
  }
  if (jobValueCents != null && helperPayoutCents != null) {
    const explained = adjustments.filter((a) => a.code !== 'change_order' && a.code !== 'refund')
      .reduce((sum, a) => sum + a.amountCents, 0);
    const residual = helperPayoutCents - (jobValueCents + explained);
    // Anything the record does not itemize is shown, never hidden.
    if (residual !== 0) adjustments.push({ code: 'other_recorded_difference', amountCents: residual });
  }
  if (helperPayoutCents == null && jobValueCents == null) adjustments.push({ code: 'not_priced', amountCents: 0 });

  return {
    job: { id: job.id, title: job.title, status: job.status, payoutStatus: job.payout_status || 'not_ready', completedAt: job.completed_at },
    currencyCode: String(job.currency_code || payments[0]?.currency || 'USD').toUpperCase(),
    breakdown: { jobValueCents, platformFeeCents, brokerFeeCents, helperPayoutCents },
    adjustments,
    payments: payments.map((p) => ({
      id: String(p.id),
      amountCents: fromMajor(p.amount),
      platformFeeCents: fromMajor(p.platform_fee),
      helperPayoutCents: fromMajor(p.helper_payout),
      refundedCents: fromMajor(p.refunded),
      status: p.status,
      escrowStatus: p.escrow_status,
      capturedAt: p.captured_at,
      releasedAt: p.released_at,
    })),
  };
}

module.exports = { jobEarnings };
