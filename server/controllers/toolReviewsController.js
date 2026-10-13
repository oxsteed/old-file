const db = require('../db');
const logger = require('../utils/logger');
const { resolvePublicDisplayName } = require('../utils/publicDisplayName');

const getToolReviews = async (req, res) => {
  try {
    const { toolId } = req.params;
    const toolIdNum = parseInt(toolId, 10);
    if (!Number.isInteger(toolIdNum) || toolIdNum < 1) {
      return res.status(400).json({ error: 'Invalid tool id' });
    }
    const result = await db.query(
      `SELECT tr.*, u.first_name, u.last_name, u.display_name_preference,
              pb.business_name AS primary_business_name,
              u.profile_photo_url
       FROM tool_reviews tr
       JOIN users u ON tr.user_id = u.id
       LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
       WHERE tr.tool_id = $1
       ORDER BY tr.created_at DESC`,
      [toolIdNum]
    );
    res.json(result.rows.map((row) => {
      const displayName = resolvePublicDisplayName(row);
      return {
        ...row,
        reviewer_name: displayName,
        first_name: displayName,
        last_name: null,
        display_name_preference: undefined,
        primary_business_name: undefined,
      };
    }));
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

    const toolIdNum = parseInt(toolId, 10);
    if (!Number.isInteger(toolIdNum) || toolIdNum < 1) {
      return res.status(400).json({ error: 'Invalid tool id' });
    }

    // The tool must exist (bogus ids used to die on the FK as a 500)
    const toolRes = await db.query('SELECT id, user_id FROM tool_rentals WHERE id = $1', [toolIdNum]);
    const tool = toolRes.rows[0];
    if (!tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    // Owners cannot review their own tools
    if (tool.user_id === userId) {
      return res.status(403).json({ error: 'You cannot review your own tool' });
    }

    // Only customers with a completed rental of this tool may review it
    const bookingRes = await db.query(
      `SELECT 1 FROM tool_rentals_bookings
        WHERE tool_id = $1 AND customer_id = $2 AND status = 'completed'
        LIMIT 1`,
      [toolIdNum, userId]
    );
    if (!bookingRes.rows.length) {
      return res.status(403).json({ error: 'Only customers with a completed rental can review this tool' });
    }

    await client.query('BEGIN');

    // Insert review
    const review = await client.query(
      `INSERT INTO tool_reviews (tool_id, user_id, rating, review_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tool_id, user_id) DO UPDATE SET rating = $3, review_text = $4
       RETURNING *`,
      [toolIdNum, userId, rating, review_text || null]
    );

    // Update tool avg rating
    const avgResult = await client.query(
      'SELECT AVG(rating) as avg_rating, COUNT(*) as review_count FROM tool_reviews WHERE tool_id = $1',
      [toolIdNum]
    );
    const { avg_rating, review_count } = avgResult.rows[0];

    await client.query(
      'UPDATE tool_rentals SET avg_rating = $1, review_count = $2 WHERE id = $3',
      [parseFloat(avg_rating).toFixed(2), review_count, toolIdNum]
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
