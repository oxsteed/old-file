const db = require('../db');

const PaymentModel = {
  async create({ jobId, payerId, payeeId, amount, platformFee, protectionFee, brokerFee, helperPayout, stripePaymentId, status }) {
    const result = await db.query(
      `INSERT INTO payments
        (job_id, payer_id, payee_id, amount, platform_fee, protection_fee,
         broker_fee, helper_payout, stripe_payment_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [jobId, payerId, payeeId, amount, platformFee, protectionFee || 0,
       brokerFee || 0, helperPayout, stripePaymentId, status || 'pending']
    );
    return result.rows[0];
  },

  async findById(id) {
    const result = await db.query('SELECT * FROM payments WHERE id = $1', [id]);
    return result.rows[0];
  },

  async findByJobId(jobId) {
    const result = await db.query('SELECT * FROM payments WHERE job_id = $1 ORDER BY created_at DESC', [jobId]);
    return result.rows;
  },

  // Returns only user-facing payment fields — excludes internal fee breakdowns
  // and raw Stripe IDs that should not be surfaced to clients (M-45)
  async findByUserId(userId) {
    const result = await db.query(
      `SELECT id, job_id, payer_id, payee_id, amount, status,
              helper_payout, created_at, updated_at
       FROM payments
       WHERE payer_id = $1 OR payee_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  },

  async updateStatus(id, status) {
    const result = await db.query(
      'UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    return result.rows[0];
  }
};

module.exports = PaymentModel;
