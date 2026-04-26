const db = require('../db');
const logger = require('../utils/logger');

// Get consultant performance metrics
exports.getConsultantPerformance = async (req, res) => {
  try {
    const { consultantId } = req.params;
    const { days = 30 } = req.query;

    // Overall performance
    const { rows: performance } = await db.query(
      `SELECT
        consultant_id,
        first_name,
        last_name,
        total_sessions,
        completed_sessions,
        no_show_sessions,
        avg_rating,
        feedback_count,
        positive_feedback_count,
        first_session_date,
        last_completed_date,
        completion_rate
       FROM consultant_performance
       WHERE consultant_id = $1`,
      [consultantId]
    );

    if (performance.length === 0) {
      return res.json({
        consultant_id: consultantId,
        total_sessions: 0,
        completed_sessions: 0,
        no_show_sessions: 0,
        avg_rating: null,
        feedback_count: 0,
        completion_rate: 0,
        monthly_stats: []
      });
    }

    // Monthly breakdown for the last N months
    const { rows: monthlyStats } = await db.query(
      `SELECT
        DATE_TRUNC('month', css.created_at)::DATE as month,
        COUNT(*) as sessions,
        COUNT(CASE WHEN css.status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN css.status = 'no_show' THEN 1 END) as no_shows,
        ROUND(AVG(csf.feedback_rating)::numeric, 2) as avg_rating
       FROM consulting_sessions_scheduled css
       LEFT JOIN consulting_session_followups csf ON css.id = csf.session_scheduled_id
       WHERE css.consultant_assigned_id = $1
         AND css.created_at >= NOW() - INTERVAL '1 year'
       GROUP BY DATE_TRUNC('month', css.created_at)::DATE
       ORDER BY month DESC`,
      [consultantId]
    );

    res.json({
      ...performance[0],
      monthly_stats: monthlyStats
    });
  } catch (err) {
    logger.error('Failed to get consultant performance', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch performance metrics' });
  }
};

// Get service tier analytics
exports.getServiceTierAnalytics = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
        service_tier,
        total_requests,
        scheduled_count,
        completed_count,
        no_show_count,
        completion_rate,
        avg_rating,
        earliest_request,
        latest_completion
       FROM service_tier_analytics
       ORDER BY total_requests DESC`
    );

    res.json(rows);
  } catch (err) {
    logger.error('Failed to get service tier analytics', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch service tier analytics' });
  }
};

// Get conversion funnel data
exports.getConversionFunnel = async (req, res) => {
  try {
    const { days = 90 } = req.query;

    const { rows } = await db.query(
      `SELECT
        date,
        intake_forms,
        scheduled_sessions,
        completed_sessions,
        scheduling_rate,
        completion_rate
       FROM conversion_funnel
       WHERE date >= NOW()::DATE - INTERVAL '1 day' * $1
       ORDER BY date DESC`,
      [parseInt(days)]
    );

    res.json(rows);
  } catch (err) {
    logger.error('Failed to get conversion funnel', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch conversion funnel' });
  }
};

// Get feedback trends
exports.getFeedbackTrends = async (req, res) => {
  try {
    const { weeks = 12 } = req.query;

    const { rows } = await db.query(
      `SELECT
        week_start,
        total_feedback,
        avg_rating,
        positive_count,
        negative_count
       FROM feedback_trends
       WHERE week_start >= NOW()::DATE - INTERVAL '1 week' * $1
       ORDER BY week_start DESC`,
      [parseInt(weeks)]
    );

    res.json(rows);
  } catch (err) {
    logger.error('Failed to get feedback trends', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch feedback trends' });
  }
};

// Get top performing consultants
exports.getTopConsultants = async (req, res) => {
  try {
    const { limit = 10, minSessions = 5 } = req.query;

    const { rows } = await db.query(
      `SELECT
        consultant_id,
        first_name,
        last_name,
        total_sessions,
        completed_sessions,
        avg_rating,
        feedback_count,
        completion_rate
       FROM consultant_performance
       WHERE total_sessions >= $1 AND avg_rating IS NOT NULL
       ORDER BY avg_rating DESC, feedback_count DESC
       LIMIT $2`,
      [parseInt(minSessions), parseInt(limit)]
    );

    res.json(rows);
  } catch (err) {
    logger.error('Failed to get top consultants', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch top consultants' });
  }
};

// Get consulting platform summary stats
exports.getPlatformStats = async (req, res) => {
  try {
    // Get all time stats
    const { rows: allTimeStats } = await db.query(
      `SELECT
        COUNT(DISTINCT id) as total_intake_forms,
        COUNT(DISTINCT CASE WHEN (SELECT COUNT(*) FROM consulting_sessions_scheduled WHERE session_id = cs.id) > 0 THEN cs.id END) as scheduled_forms,
        COUNT(DISTINCT CASE WHEN (SELECT COUNT(*) FROM consulting_sessions_scheduled css WHERE css.session_id = cs.id AND css.status = 'completed') > 0 THEN cs.id END) as completed_forms
       FROM consulting_sessions cs`
    );

    // Get this month stats
    const { rows: thisMonthStats } = await db.query(
      `SELECT
        COUNT(DISTINCT cs.id) as intake_forms,
        COUNT(DISTINCT css.id) as scheduled_sessions,
        COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN css.id END) as completed_sessions
       FROM consulting_sessions cs
       LEFT JOIN consulting_sessions_scheduled css ON cs.id = css.session_id
       WHERE DATE_TRUNC('month', cs.created_at) = DATE_TRUNC('month', NOW())`
    );

    // Get average rating
    const { rows: ratingStats } = await db.query(
      `SELECT
        ROUND(AVG(feedback_rating)::numeric, 2) as platform_avg_rating,
        COUNT(*) as total_feedback,
        COUNT(CASE WHEN feedback_rating >= 4 THEN 1 END) as positive_count
       FROM consulting_session_followups
       WHERE feedback_rating IS NOT NULL`
    );

    res.json({
      allTime: allTimeStats[0],
      thisMonth: thisMonthStats[0],
      ratings: ratingStats[0]
    });
  } catch (err) {
    logger.error('Failed to get platform stats', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch platform stats' });
  }
};

// Get consultant list with performance metrics
exports.getConsultantsList = async (req, res) => {
  try {
    const { limit = 50, offset = 0, sortBy = 'avg_rating' } = req.query;

    const validSortFields = ['avg_rating', 'total_sessions', 'completion_rate'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'avg_rating';

    const { rows } = await db.query(
      `SELECT
        consultant_id,
        first_name,
        last_name,
        total_sessions,
        completed_sessions,
        no_show_sessions,
        avg_rating,
        feedback_count,
        completion_rate
       FROM consultant_performance
       WHERE total_sessions > 0
       ORDER BY ${sortField} DESC NULLS LAST
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), parseInt(offset)]
    );

    // Get total count
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) as total FROM consultant_performance WHERE total_sessions > 0`
    );

    res.json({
      consultants: rows,
      total: parseInt(countRows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    logger.error('Failed to get consultants list', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch consultants list' });
  }
};

// Get revenue and stats for a consultant
exports.getConsultantRevenue = async (req, res) => {
  try {
    const { consultantId } = req.params;

    // Count sessions by tier
    const { rows: tierBreakdown } = await db.query(
      `SELECT
        cs.service_tier,
        COUNT(*) as count
       FROM consulting_sessions cs
       JOIN consulting_sessions_scheduled css ON cs.id = css.session_id
       WHERE css.consultant_assigned_id = $1 AND css.status = 'completed'
       GROUP BY cs.service_tier`,
      [consultantId]
    );

    // Get historical revenue (if payments table exists)
    const { rows: monthlyRevenue } = await db.query(
      `SELECT
        DATE_TRUNC('month', css.completed_at)::DATE as month,
        COUNT(*) as sessions_count,
        cs.service_tier
       FROM consulting_sessions_scheduled css
       JOIN consulting_sessions cs ON css.session_id = cs.id
       WHERE css.consultant_assigned_id = $1 AND css.status = 'completed'
       GROUP BY DATE_TRUNC('month', css.completed_at)::DATE, cs.service_tier
       ORDER BY month DESC`,
      [consultantId]
    );

    res.json({
      consultant_id: consultantId,
      tier_breakdown: tierBreakdown,
      monthly_revenue: monthlyRevenue
    });
  } catch (err) {
    logger.error('Failed to get consultant revenue', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch revenue data' });
  }
};
