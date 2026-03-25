const db = require('../db');

const ReviewModel = {
  async create({ jobId, reviewerId, revieweeId, rating, comment }) {
    // Prevent duplicate reviews: one review per reviewer per job
    const existing = await db.query(
      'SELECT id FROM reviews WHERE job_id = $1 AND reviewer_id = $2',
      [jobId, reviewerId]
    );
    if (existing.rows.length > 0) {
      throw new Error('You have already submitted a review for this job.');
    }

    const result = await db.query(
      'INSERT INTO reviews (job_id, reviewer_id, reviewee_id, rating, comment) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [jobId, reviewerId, revieweeId, rating, comment]
    );

    // Update the reviewee's average rating in helper_profiles
    await db.query(
      `UPDATE helper_profiles
       SET avg_rating = (
         SELECT ROUND(AVG(rating)::numeric, 2)
         FROM reviews WHERE reviewee_id = $1
       ),
       updated_at = NOW()
       WHERE user_id = $1`,
      [revieweeId]
    );

    return result.rows[0];
  },

  async findByRevieweeId(revieweeId) {
    const result = await db.query(
      `SELECT r.*, u.first_name, u.last_name FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       WHERE r.reviewee_id = $1 ORDER BY r.created_at DESC`,
      [revieweeId]
    );
    return result.rows;
  },

  async getAverageRating(userId) {
    const result = await db.query(
      'SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews FROM reviews WHERE reviewee_id = $1',
      [userId]
    );
    return result.rows[0];
  },

  async findByJobId(jobId) {
    const result = await db.query('SELECT * FROM reviews WHERE job_id = $1', [jobId]);
    return result.rows;
  }
};

module.exports = ReviewModel;
