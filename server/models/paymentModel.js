const pool = require('../db');

const PaymentModel = {
  async create({ jobId, payerId, payeeId, amount, platformFee, stripePaymentId, status }) {
    const result = await pool.query(
      'INSERT INTO payments (job_id, payer_id, payee_id, amount, platform_fee, stripe_payment_id, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [jobId, payerId, payeeId, amount, platformFee, stripePaymentId, status || 'pending']
    );
    return result.rows[0];
  },

  async findById(id) {
    const result = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);
    return result.rows[0];
  },

  async findByJobId(jobId) {
    const result = await pool.query('SELECT * FROM payments WHERE job_id = $1 ORDER BY created_at DESC', [jobId]);
    return result.rows;
  },

  async findByUserId(userId) {
    const result = await pool.query(
      'SELECT * FROM payments WHERE payer_id = $1 OR payee_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  },

  async updateStatus(id, status) {
    const result = await pool.query(
      'UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    return result.rows[0];
  }
};

module.exports = PaymentModel;
