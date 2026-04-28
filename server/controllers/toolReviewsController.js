const db = require('../db');
const logger = require('../utils/logger');

const getToolReviews = async (req, res) => {
  try {
    const { toolId } = req.params;
    const result = await db.query(
      `SELECT tr.*, u.first_name, u.last_name, u.profile_photo_url
       FROM tool_reviews tr
       JOIN users u ON tr.user_id = u.id
       WHERE tr.tool_id = $1
       ORDER BY tr.created_at DESC`,
      [toolId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('getToolReviews error', { err });
    res.status(500).json({ error: 'Failed to load reviews' });
  }
};

const submitReview = async (req, res) => {
  const client = await db.connect();
  try {
    const { toolId } = req.params;
    const { rating, review_text } = req.body;
    const userId = req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Invalid rating' });
    }

    await client.query('BEGIN');

    // Insert review
    const review = await client.query(
      `INSERT INTO tool_reviews (tool_id, user_id, rating, review_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tool_id, user_id) DO UPDATE SET rating = $3, review_text = $4
       RETURNING *`,
      [toolId, userId, rating, review_text || null]
    );

    // Update tool avg rating
    const avgResult = await client.query(
      'SELECT AVG(rating) as avg_rating, COUNT(*) as review_count FROM tool_reviews WHERE tool_id = $1',
      [toolId]
    );
    const { avg_rating, review_count } = avgResult.rows[0];

    await client.query(
      'UPDATE tool_rentals SET avg_rating = $1, review_count = $2 WHERE id = $3',
      [parseFloat(avg_rating).toFixed(2), review_count, toolId]
    );

    await client.query('COMMIT');
    res.json(review.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('submitReview error', { err });
    res.status(500).json({ error: 'Failed to submit review' });
  } finally {
    client.release();
  }
};

module.exports = { getToolReviews, submitReview };
