const logger = require('../utils/logger');
const db = require('../db');

/**
 * Submit feedback for a consulting session
 * POST /api/consulting/feedback/:sessionId
 */
exports.submitFeedback = async (req, res) => {
  const { sessionId } = req.params;
  const { rating, feedbackText, name, email } = req.body;

  try {
    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // Validate session exists
    const sessionCheck = await db.query(
      'SELECT id, email FROM consulting_sessions WHERE id = $1',
      [sessionId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionCheck.rows[0];
    const feedbackEmail = email || session.email;

    // Find the scheduled session record
    const scheduledResult = await db.query(
      'SELECT id FROM consulting_sessions_scheduled WHERE session_id = $1',
      [sessionId]
    );

    if (scheduledResult.rows.length === 0) {
      return res.status(400).json({ error: 'No scheduled session found' });
    }

    const scheduledId = scheduledResult.rows[0].id;

    // Check if feedback already submitted for this session
    const existingFeedback = await db.query(
      'SELECT id FROM consulting_session_followups WHERE session_scheduled_id = $1 AND feedback_rating IS NOT NULL',
      [scheduledId]
    );

    // Update or insert feedback
    let result;
    if (existingFeedback.rows.length > 0) {
      result = await db.query(
        `UPDATE consulting_session_followups
         SET feedback_rating = $1, feedback_text = $2, received_at = NOW(), updated_at = NOW()
         WHERE session_scheduled_id = $3
         RETURNING *`,
        [rating, feedbackText?.trim() || null, scheduledId]
      );
    } else {
      // Insert new feedback record
      result = await db.query(
        `INSERT INTO consulting_session_followups (session_scheduled_id, followup_type, feedback_rating, feedback_text, sent_at, received_at)
         VALUES ($1, 'feedback', $2, $3, NOW(), NOW())
         RETURNING *`,
        [scheduledId, rating, feedbackText?.trim() || null]
      );
    }

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
    logger.error('Error submitting consulting feedback', { sessionId, error: err.message });
    return res.status(500).json({ error: 'Failed to submit feedback' });
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
