'use strict';

/**
 * Offline rail (decisions #8 #15): customer and helper settle directly.
 * OxSteed does not hold or guarantee the money, so both sides acknowledge
 * that the payment is not covered. Gating (subscription, verified helper,
 * first-job cap) lives in paymentRailPolicy.railOptions.
 */

const { AppError } = require('../../middleware/errorHandler');

async function recordAcceptanceAck(client, { job, amountMinor, currency }) {
  await client.query(
    `INSERT INTO offline_payment_confirmations (job_id, amount_minor, currency, customer_ack_not_covered_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (job_id) DO UPDATE
       SET amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
           customer_ack_not_covered_at = COALESCE(offline_payment_confirmations.customer_ack_not_covered_at, NOW()),
           updated_at = NOW()`,
    [job.id, amountMinor ?? null, currency || null]
  );
  await client.query('UPDATE jobs SET offline_ack_at = NOW() WHERE id = $1', [job.id]);
}

/** Either party confirms money changed hands (and acknowledges no cover). */
async function confirmOfflinePayment(client, { job, user }) {
  const isCustomer = String(job.client_id) === String(user.id);
  const isHelper = String(job.assigned_helper_id || '') === String(user.id);
  if (!isCustomer && !isHelper) throw new AppError('Job not found', 404, 'job_not_found');
  if (job.payment_rail !== 'offline') throw new AppError('This job is not paid offline', 409, 'payment_rail_mismatch');
  const column = isCustomer ? 'customer_confirmed_at' : 'helper_confirmed_at';
  const ackColumn = isCustomer ? 'customer_ack_not_covered_at' : 'helper_ack_not_covered_at';
  const { rows } = await client.query(
    `INSERT INTO offline_payment_confirmations (job_id, ${column}, ${ackColumn})
     VALUES ($1, NOW(), NOW())
     ON CONFLICT (job_id) DO UPDATE
       SET ${column} = COALESCE(offline_payment_confirmations.${column}, NOW()),
           ${ackColumn} = COALESCE(offline_payment_confirmations.${ackColumn}, NOW()),
           updated_at = NOW()
     RETURNING *`,
    [job.id]
  );
  return rows[0];
}

async function getConfirmation(client, jobId) {
  const { rows } = await client.query('SELECT * FROM offline_payment_confirmations WHERE job_id = $1', [jobId]);
  return rows[0] || null;
}

module.exports = { recordAcceptanceAck, confirmOfflinePayment, getConfirmation };
