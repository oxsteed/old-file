const db = require('../db');
const logger = require('../utils/logger');

const trackEvent = async (req, res) => {
  try {
    const { toolId, eventType, metadata } = req.body;
    const userId = req.user?.id || null;

    await db.query(
      `INSERT INTO tool_rentals_analytics (user_id, tool_id, event_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [userId, toolId, eventType, metadata ? JSON.stringify(metadata) : null]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error('trackEvent error', { err });
    res.status(500).json({ error: 'Failed to track event' });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const { toolId } = req.params;
    const result = await db.query(
      `SELECT event_type, COUNT(*) as count
       FROM tool_rentals_analytics
       WHERE tool_id = $1
       GROUP BY event_type`,
      [toolId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('getAnalytics error', { err });
    res.status(500).json({ error: 'Failed to load analytics' });
  }
};

const getTopTools = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT tool_id, COUNT(*) as event_count
       FROM tool_rentals_analytics
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY tool_id
       ORDER BY event_count DESC
       LIMIT 10`
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('getTopTools error', { err });
    res.status(500).json({ error: 'Failed to load top tools' });
  }
};

module.exports = { trackEvent, getAnalytics, getTopTools };
