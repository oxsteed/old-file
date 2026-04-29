const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

async function createSurvey(req, res) {
  try {
    const { conversationId } = req.params;
    const { rating, npsScore, categories, comment } = req.body;

    if (!rating || !npsScore) {
      return sendValidationError(res, { rating: 'Required', npsScore: 'Required' });
    }

    const conv = await query(
      'SELECT * FROM support_conversations WHERE id = $1',
      [conversationId]
    );

    if (!conv.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = conv.rows[0];

    const result = await query(
      `INSERT INTO satisfaction_surveys
       (conversation_id, business_id, customer_id, agent_id, rating, nps_score, categories, comment, responded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       RETURNING *`,
      [conversationId, conversation.business_id, conversation.customer_id, conversation.agent_id,
       parseInt(rating), parseInt(npsScore), categories ? JSON.stringify(categories) : null, comment || null]
    );

    await query(
      `UPDATE conversation_metrics
       SET customer_satisfaction_score = $1
       WHERE conversation_id = $2`,
      [parseInt(rating), conversationId]
    );

    logger.info('Survey submitted', { conversationId, rating });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('createSurvey error', { error: err.message });
    sendError(res, 500, 'Failed to submit survey');
  }
}

async function getSurveys(req, res) {
  try {
    const { businessId } = req.params;
    const { agentId, days = 30, limit = 50 } = req.query;

    let sql = `
      SELECT ss.*, u.name as agent_name
      FROM satisfaction_surveys ss
      LEFT JOIN support_agents sa ON ss.agent_id = sa.id
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE ss.business_id = $1 AND ss.responded_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2
    `;
    const params = [businessId, parseInt(days)];

    if (agentId) {
      sql += ` AND ss.agent_id = $${params.length + 1}`;
      params.push(agentId);
    }

    sql += ` ORDER BY ss.responded_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getSurveys error', { error: err.message });
    sendError(res, 500, 'Failed to get surveys');
  }
}

async function getSurveySummary(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    const result = await query(
      `SELECT
        COUNT(*) as total_responses,
        ROUND(AVG(rating), 2) as avg_rating,
        SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) as promoters,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as passives,
        SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) as detractors,
        ROUND(AVG(nps_score), 1) as avg_nps,
        ROUND(100.0 * (SUM(CASE WHEN nps_score >= 9 THEN 1 ELSE 0 END) - SUM(CASE WHEN nps_score <= 6 THEN 1 ELSE 0 END)) / NULLIF(COUNT(*), 0), 2) as nps_percentage
      FROM satisfaction_surveys
      WHERE business_id = $1 AND responded_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2`,
      [businessId, parseInt(days)]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('getSurveySummary error', { error: err.message });
    sendError(res, 500, 'Failed to get survey summary');
  }
}

async function getAgentRatings(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    const result = await query(
      `SELECT
        sa.id, sa.user_id, u.name,
        COUNT(ss.id) as total_surveys,
        ROUND(AVG(ss.rating), 2) as avg_rating,
        ROUND(AVG(ss.nps_score), 1) as avg_nps,
        SUM(CASE WHEN ss.rating >= 4 THEN 1 ELSE 0 END) as positive_reviews,
        SUM(CASE WHEN ss.rating <= 2 THEN 1 ELSE 0 END) as negative_reviews
      FROM support_agents sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN satisfaction_surveys ss ON sa.id = ss.agent_id AND ss.responded_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2
      WHERE sa.business_id = $1
      GROUP BY sa.id, sa.user_id, u.name
      HAVING COUNT(ss.id) > 0
      ORDER BY ROUND(AVG(ss.rating), 2) DESC`,
      [businessId, parseInt(days)]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getAgentRatings error', { error: err.message });
    sendError(res, 500, 'Failed to get agent ratings');
  }
}

async function getNegativeFeedback(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30, limit = 20 } = req.query;

    const result = await query(
      `SELECT
        ss.id, ss.conversation_id, ss.rating, ss.nps_score, ss.comment,
        sa.user_id, u.name as agent_name,
        c.name as customer_name,
        sc.subject, sc.created_at
      FROM satisfaction_surveys ss
      JOIN support_conversations sc ON ss.conversation_id = sc.id
      LEFT JOIN support_agents sa ON ss.agent_id = sa.id
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN users c ON ss.customer_id = c.id
      WHERE ss.business_id = $1 AND ss.rating <= 2 AND ss.responded_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2
      ORDER BY ss.responded_at DESC
      LIMIT $3`,
      [businessId, parseInt(days), parseInt(limit)]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getNegativeFeedback error', { error: err.message });
    sendError(res, 500, 'Failed to get negative feedback');
  }
}

async function getSurveyTrends(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    const result = await query(
      `SELECT
        DATE(ss.responded_at) as date,
        COUNT(*) as responses,
        ROUND(AVG(ss.rating), 2) as avg_rating,
        ROUND(AVG(ss.nps_score), 1) as avg_nps,
        SUM(CASE WHEN ss.rating >= 4 THEN 1 ELSE 0 END) as promoters,
        SUM(CASE WHEN ss.rating <= 2 THEN 1 ELSE 0 END) as detractors
      FROM satisfaction_surveys ss
      WHERE ss.business_id = $1 AND ss.responded_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2
      GROUP BY DATE(ss.responded_at)
      ORDER BY DATE(ss.responded_at) DESC`,
      [businessId, parseInt(days)]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getSurveyTrends error', { error: err.message });
    sendError(res, 500, 'Failed to get survey trends');
  }
}

async function sendFollowUp(req, res) {
  try {
    const { surveyId } = req.params;

    const result = await query(
      `UPDATE satisfaction_surveys
       SET follow_up_email_sent = true
       WHERE id = $1 RETURNING *`,
      [surveyId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Survey not found');

    logger.info('Follow-up email sent', { surveyId });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('sendFollowUp error', { error: err.message });
    sendError(res, 500, 'Failed to send follow-up');
  }
}

module.exports = {
  createSurvey, getSurveys, getSurveySummary, getAgentRatings,
  getNegativeFeedback, getSurveyTrends, sendFollowUp
};
