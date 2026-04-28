const db = require('../db');

const BidModel = {
  async create({ jobId, helperId, amount, message, etaHours }) {
    // Prevent duplicate bids: one bid per helper per job (matches DB UNIQUE constraint)
    const existing = await db.query(
      'SELECT id FROM bids WHERE job_id = $1 AND helper_id = $2',
      [jobId, helperId]
    );
    if (existing.rows.length > 0) {
      throw new Error('You already placed a bid on this job.');
    }

    const result = await db.query(
      'INSERT INTO bids (job_id, helper_id, amount, message, eta_hours) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [jobId, helperId, amount, message, etaHours]
    );

    // NOTE: bid_count is auto-incremented by DB trigger trg_bid_count — no manual update needed

    return result.rows[0];
  },

  async findByJobId(jobId) {
    const result = await db.query(
      `SELECT b.*, u.first_name, u.last_name, hp.avg_rating
       FROM bids b
       JOIN users u ON b.helper_id = u.id
       LEFT JOIN helper_profiles hp ON hp.user_id = b.helper_id
       WHERE b.job_id = $1 ORDER BY b.created_at DESC`,
      [jobId]
    );
    return result.rows;
  },

  async findById(id) {
    const result = await db.query('SELECT * FROM bids WHERE id = $1', [id]);
    return result.rows[0];
  },

  async updateStatus(id, status) {
    const result = await db.query(
      'UPDATE bids SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    return result.rows[0];
  },

  async findByHelperId(helperId) {
    const result = await db.query(
      `SELECT b.*, j.title, j.status as job_status
       FROM bids b JOIN jobs j ON b.job_id = j.id
       WHERE b.helper_id = $1 ORDER BY b.created_at DESC`,
      [helperId]
    );
    return result.rows;
  }
};

module.exports = BidModel;
