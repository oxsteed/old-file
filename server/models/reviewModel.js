const pool = require('../db');

const ReviewModel = {
  async create({ jobId, reviewerId, revieweeId, rating, comment }) {
    const result = await pool.query(
      'INSERT INTO reviews (job_id, reviewer_id, reviewee_id, rating, comment) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [jobId, reviewerId, revieweeId, rating, comment]
    );
    return result.rows[0];
  },

  async findByRevieweeId(revieweeId) {
    const result = await pool.query(
      `SELECT r.*, u.first_name, u.last_name FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       WHERE r.reviewee_id = $1 ORDER BY r.created_at DESC`,
      [revieweeId]
    );
    return result.rows;
  },

  async getAverageRating(userId) {
    const result = await pool.query(
      'SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews FROM reviews WHERE reviewee_id = $1',
      [userId]
    );
    return result.rows[0];
  },

  async findByJobId(jobId) {
    const result = await pool.query('SELECT * FROM reviews WHERE job_id = $1', [jobId]);
    return result.rows;
  }
};

module.exports = ReviewModel;
