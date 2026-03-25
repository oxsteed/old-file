const db = require('../db');

const BidModel = {
  async create({ jobId, helperId, amount, message, estimatedDuration }) {
    // Prevent duplicate bids: one bid per helper per job
    const existing = await db.query(
      'SELECT id FROM bids WHERE job_id = $1 AND helper_id = $2 AND status = $3',
      [jobId, helperId, 'pending']
    );
    if (existing.rows.length > 0) {
      throw new Error('You already have a pending bid on this job.');
    }

    const result = await db.query(
      'INSERT INTO bids (job_id, helper_id, amount, message, estimated_duration) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [jobId, helperId, amount, message, estimatedDuration]
    );

    // Increment bid_count on the job
    await db.query(
      'UPDATE jobs SET bid_count = COALESCE(bid_count, 0) + 1, updated_at = NOW() WHERE id = $1',
      [jobId]
    );

    return result.rows[0];
  },

  async findByJobId(jobId) {
    const result = await db.query(
      `SELECT b.*, u.first_name, u.last_name, u.average_rating
       FROM bids b JOIN users u ON b.helper_id = u.id
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
