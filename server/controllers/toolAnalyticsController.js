const db = require('../db');
const logger = require('../utils/logger');

const trackEvent = async (req, res) => {
  try {
    const { toolId, eventType, metadata } = req.body;
    const userId = req.user?.id || null;
    if (!toolId || !eventType) {
      return res.status(400).json({ error: 'toolId and eventType are required' });
    }

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
       WHERE tool_id = $1 AND event_type <> 'book'
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
         AND event_type <> 'book'
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
         AND event_type <> 'book'
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
         SUM(CASE WHEN status IN ('invoice_sent', 'payment_confirmed', 'completed') THEN total_price ELSE 0 END) as revenue
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
       WHERE tool_id = ANY($1) AND status IN ('invoice_sent', 'payment_confirmed', 'completed')
       GROUP BY DATE_TRUNC('month', created_at)
       ORDER BY month DESC
       LIMIT 12`,
      [toolIds]
    );

    // Get per-tool metrics
    const toolMetricsResult = await db.query(
      `WITH analytics AS (
         SELECT tool_id,
                COUNT(*) FILTER (WHERE event_type = 'view') AS views,
                COUNT(*) FILTER (WHERE event_type = 'favorite') AS favorites
           FROM tool_rentals_analytics
          WHERE tool_id = ANY($1)
            AND event_type <> 'book'
          GROUP BY tool_id
       ),
       bookings AS (
         SELECT tool_id,
                COUNT(*) AS inquiries,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed_bookings,
                COALESCE(SUM(total_price) FILTER (WHERE status IN ('invoice_sent', 'payment_confirmed', 'completed')), 0) AS total_revenue
           FROM tool_rentals_bookings
          WHERE tool_id = ANY($1)
          GROUP BY tool_id
       ),
       reviews AS (
         SELECT tool_id, COALESCE(AVG(rating), 0) AS avg_rating
           FROM tool_reviews
          WHERE tool_id = ANY($1)
          GROUP BY tool_id
       )
       SELECT tr.id,
              tr.name,
              COALESCE(a.views, 0) AS views,
              COALESCE(a.favorites, 0) AS favorites,
              COALESCE(b.inquiries, 0) AS inquiries,
              COALESCE(b.completed_bookings, 0) AS completed_bookings,
              COALESCE(b.total_revenue, 0) AS total_revenue,
              COALESCE(r.avg_rating, 0) AS avg_rating
         FROM tool_rentals tr
         LEFT JOIN analytics a ON tr.id = a.tool_id
         LEFT JOIN bookings b ON tr.id = b.tool_id
         LEFT JOIN reviews r ON tr.id = r.tool_id
        WHERE tr.id = ANY($1)
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
