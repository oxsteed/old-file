const pool = require('../db');

const DisputeModel = {
  async create({ jobId, filedBy, filedAgainst, reason, description }) {
    const result = await pool.query(
      'INSERT INTO disputes (job_id, filed_by, filed_against, reason, description) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [jobId, filedBy, filedAgainst, reason, description]
    );
    return result.rows[0];
  },

  async findById(id) {
    const result = await pool.query(
      `SELECT d.*, j.title as job_title,
        f.first_name as filed_by_name, f.last_name as filed_by_last,
        a.first_name as filed_against_name, a.last_name as filed_against_last
       FROM disputes d
       LEFT JOIN jobs j ON d.job_id = j.id
       LEFT JOIN users f ON d.filed_by = f.id
       LEFT JOIN users a ON d.filed_against = a.id
       WHERE d.id = $1`,
      [id]
    );
    return result.rows[0];
  },

  async findByUserId(userId) {
    const result = await pool.query(
      'SELECT * FROM disputes WHERE filed_by = $1 OR filed_against = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  },

  async updateStatus(id, status, resolvedBy) {
    const result = await pool.query(
      'UPDATE disputes SET status = $1, resolved_by = $2, resolved_at = NOW(), updated_at = NOW() WHERE id = $3 RETURNING *',
      [status, resolvedBy, id]
    );
    return result.rows[0];
  }
};

module.exports = DisputeModel;
