const pool = require('../db');

const BidModel = {
  async create({ jobId, helperId, amount, message, estimatedDuration }) {
    const result = await pool.query(
      'INSERT INTO bids (job_id, helper_id, amount, message, estimated_duration) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [jobId, helperId, amount, message, estimatedDuration]
    );
    return result.rows[0];
  },

  async findByJobId(jobId) {
    const result = await pool.query(
      `SELECT b.*, u.first_name, u.last_name, u.average_rating
       FROM bids b JOIN users u ON b.helper_id = u.id
       WHERE b.job_id = $1 ORDER BY b.created_at DESC`,
      [jobId]
    );
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query('SELECT * FROM bids WHERE id = $1', [id]);
    return result.rows[0];
  },

  async updateStatus(id, status) {
    const result = await pool.query(
      'UPDATE bids SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    return result.rows[0];
  },

  async findByHelperId(helperId) {
    const result = await pool.query(
      'SELECT b.*, j.title as job_title FROM bids b JOIN jobs j ON b.job_id = j.id WHERE b.helper_id = $1 ORDER BY b.created_at DESC',
      [helperId]
    );
    return result.rows;
  }
};

module.exports = BidModel;
