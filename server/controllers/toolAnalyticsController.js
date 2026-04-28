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

const getOwnerDashboard = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch owner's tools
    const toolsResult = await db.query(
      `SELECT id, name, daily_rate FROM tool_rentals WHERE user_id = $1`,
      [userId]
    );
    const tools = toolsResult.rows;
    const toolIds = tools.map(t => t.id);

    if (toolIds.length === 0) {
      return res.json({
        tools: [],
        totalViews: 0,
        totalFavorites: 0,
        totalBookings: 0,
        completedBookings: 0,
        totalRevenue: 0,
        averageRating: 0,
        monthlyRevenue: [],
        toolMetrics: []
      });
    }

    // Get analytics events (views, favorites, inquiries)
    const analyticsResult = await db.query(
      `SELECT event_type, COUNT(*) as count
       FROM tool_rentals_analytics
       WHERE tool_id = ANY($1)
       GROUP BY event_type`,
      [toolIds]
    );

    const eventCounts = {};
    analyticsResult.rows.forEach(row => {
      eventCounts[row.event_type] = row.count;
    });

    // Get booking statistics
    const bookingsResult = await db.query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
         SUM(CASE WHEN status = 'confirmed' OR status = 'completed' THEN total_price ELSE 0 END) as revenue
       FROM tool_rentals_bookings
       WHERE tool_id = ANY($1)`,
      [toolIds]
    );

    const bookingStats = bookingsResult.rows[0] || {};

    // Get monthly revenue
    const monthlyResult = await db.query(
      `SELECT
         DATE_TRUNC('month', created_at)::date as month,
         SUM(total_price) as revenue,
         COUNT(*) as bookings
       FROM tool_rentals_bookings
       WHERE tool_id = ANY($1) AND (status = 'confirmed' OR status = 'completed')
       GROUP BY DATE_TRUNC('month', created_at)
       ORDER BY month DESC
       LIMIT 12`,
      [toolIds]
    );

    // Get per-tool metrics
    const toolMetricsResult = await db.query(
      `SELECT
         tr.id,
         tr.name,
         COUNT(DISTINCT CASE WHEN ta.event_type = 'view' THEN ta.id END) as views,
         COUNT(DISTINCT CASE WHEN ta.event_type = 'favorite' THEN ta.id END) as favorites,
         COUNT(DISTINCT CASE WHEN ta.event_type = 'book' THEN ta.id END) as inquiries,
         COUNT(CASE WHEN trb.status = 'completed' THEN 1 END) as completed_bookings,
         COALESCE(SUM(CASE WHEN trb.status = 'confirmed' OR trb.status = 'completed' THEN trb.total_price ELSE 0 END), 0) as total_revenue,
         COALESCE(AVG(rev.rating), 0) as avg_rating
       FROM tool_rentals tr
       LEFT JOIN tool_rentals_analytics ta ON tr.id = ta.tool_id
       LEFT JOIN tool_rentals_bookings trb ON tr.id = trb.tool_id
       LEFT JOIN tool_reviews rev ON tr.id = rev.tool_id
       WHERE tr.id = ANY($1)
       GROUP BY tr.id, tr.name
       ORDER BY total_revenue DESC`,
      [toolIds]
    );

    res.json({
      tools,
      totalViews: eventCounts.view || 0,
      totalFavorites: eventCounts.favorite || 0,
      totalBookings: parseInt(bookingStats.total) || 0,
      completedBookings: parseInt(bookingStats.completed) || 0,
      totalRevenue: parseFloat(bookingStats.revenue) || 0,
      monthlyRevenue: monthlyResult.rows,
      toolMetrics: toolMetricsResult.rows
    });
  } catch (err) {
    logger.error('getOwnerDashboard error', { err });
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
};

module.exports = { trackEvent, getAnalytics, getTopTools, getOwnerDashboard };
