const logger = require('../utils/logger');
const db = require('../db');
const crypto = require('crypto');

/**
 * Submit feedback for a consulting session
 * POST /api/consulting/feedback/:sessionId
 */
exports.submitFeedback = async (req, res) => {
  const { sessionId } = req.params;
  const { token } = req.params;
  const { rating, feedbackText, name, email } = req.body;

  if (!/^[a-f0-9]{64}$/i.test(String(token || ''))) {
    return res.status(404).json({ error: 'Feedback link is invalid or expired' });
  }

  const feedbackTokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  let client;

  try {
    client = await db.connect();
    await client.query('BEGIN');

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // The token is random, expires, and is consumed under a row lock to prevent
    // guessed session IDs and concurrent replay from changing feedback.
    const sessionCheck = await client.query(
      `SELECT css.id AS scheduled_id, cs.id, cs.email
         FROM consulting_sessions_scheduled css
         JOIN consulting_sessions cs ON cs.id = css.session_id
        WHERE css.session_id = $1
          AND css.feedback_token_hash = $2
          AND css.feedback_token_expires_at > NOW()
          AND css.feedback_token_used_at IS NULL
        FOR UPDATE OF css`,
      [sessionId, feedbackTokenHash]
    );

    if (sessionCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Feedback link is invalid or expired' });
    }

    const session = sessionCheck.rows[0];
    const feedbackEmail = email || session.email;
    const scheduledId = session.scheduled_id;

    // Check if feedback already submitted for this session
    const existingFeedback = await client.query(
      'SELECT id FROM consulting_session_followups WHERE session_scheduled_id = $1 AND feedback_rating IS NOT NULL',
      [scheduledId]
    );

    // Update or insert feedback
    let result;
    if (existingFeedback.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Feedback has already been submitted' });
    } else {
      // Insert new feedback record
      result = await client.query(
        `INSERT INTO consulting_session_followups (session_scheduled_id, followup_type, feedback_rating, feedback_text, sent_at, received_at)
         VALUES ($1, 'feedback', $2, $3, NOW(), NOW())
         RETURNING *`,
        [scheduledId, rating, feedbackText?.trim() || null]
      );
    }

    await client.query(
      `UPDATE consulting_sessions_scheduled
          SET feedback_token_used_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [scheduledId]
    );
    await client.query('COMMIT');

    logger.info('Consulting feedback submitted', {
      sessionId,
      rating,
      email: feedbackEmail,
    });

    return res.status(201).json({
      message: 'Thank you for your feedback!',
      feedback: result.rows[0],
    });
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {});
    logger.error('Error submitting consulting feedback', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to submit feedback' });
  } finally {
    client?.release();
  }
};

/**
 * Get feedback for a session
 * GET /api/consulting/sessions/:sessionId/feedback
 */
exports.getSessionFeedback = async (req, res) => {
  const { sessionId } = req.params;

  try {
    const { rows: sessionRows } = await db.query(
      'SELECT user_id FROM consulting_sessions WHERE id = $1',
      [sessionId]
    );
    if (sessionRows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
    if (!isAdmin && sessionRows[0].user_id !== req.user?.id) {
      return res.status(403).json({ error: 'Not authorized for this session' });
    }

    const result = await db.query(
      `SELECT csf.feedback_rating, csf.feedback_text, csf.received_at
       FROM consulting_session_followups csf
       JOIN consulting_sessions_scheduled css ON csf.session_scheduled_id = css.id
       WHERE css.session_id = $1 AND csf.feedback_rating IS NOT NULL`,
      [sessionId]
    );

    return res.json(result.rows[0] || null);
  } catch (err) {
    logger.error('Error fetching session feedback', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to fetch feedback' });
  }
};

/**
 * Get all feedback for a consultant
 * GET /api/consulting/feedback/consultant/:consultantId
 */
exports.getConsultantFeedback = async (req, res) => {
  const { consultantId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  try {
    const feedbackResult = await db.query(
      `SELECT
        csf.feedback_rating,
        csf.feedback_text,
        csf.received_at,
        cs.first_name,
        cs.last_name,
        css.scheduled_date,
        css.scheduled_time
       FROM consulting_session_followups csf
       JOIN consulting_sessions_scheduled css ON csf.session_scheduled_id = css.id
       JOIN consulting_sessions cs ON css.session_id = cs.id
       WHERE cs.consultant_assigned_id = $1 AND csf.feedback_rating IS NOT NULL
       ORDER BY csf.received_at DESC
       LIMIT $2 OFFSET $3`,
      [consultantId, parseInt(limit), parseInt(offset)]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) as total
       FROM consulting_session_followups csf
       JOIN consulting_sessions_scheduled css ON csf.session_scheduled_id = css.id
       JOIN consulting_sessions cs ON css.session_id = cs.id
       WHERE cs.consultant_assigned_id = $1 AND csf.feedback_rating IS NOT NULL`,
      [consultantId]
    );

    const avgResult = await db.query(
      `SELECT AVG(csf.feedback_rating) as avg_rating, COUNT(*) as total_ratings
       FROM consulting_session_followups csf
       JOIN consulting_sessions_scheduled css ON csf.session_scheduled_id = css.id
       JOIN consulting_sessions cs ON css.session_id = cs.id
       WHERE cs.consultant_assigned_id = $1 AND csf.feedback_rating IS NOT NULL`,
      [consultantId]
    );

    const total = parseInt(countResult.rows[0].total);
    const avgRating = avgResult.rows[0].avg_rating ? parseFloat(avgResult.rows[0].avg_rating).toFixed(1) : null;
    const totalRatings = parseInt(avgResult.rows[0].total_ratings);

    return res.json({
      consultant_id: consultantId,
      average_rating: avgRating,
      total_ratings: totalRatings,
      feedback: feedbackResult.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total,
      },
    });
  } catch (err) {
    logger.error('Error fetching consultant feedback', { consultantId, error: err.message });
    return res.status(500).json({ error: 'Failed to fetch feedback' });
  }
};
