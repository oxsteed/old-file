const { query } = require('../utils/db');
const { sendError } = require('../utils/apiError');
const logger = require('../utils/logger');

async function getAgentLeaderboard(req, res) {
  try {
    const { businessId } = req.params;
    const { orderBy = 'csat', days = 30 } = req.query;

    let orderClause = 'adp.avg_csat_score DESC';
    if (orderBy === 'response_time') orderClause = 'adp.avg_first_response_seconds ASC';
    if (orderBy === 'resolution_time') orderClause = 'adp.avg_resolution_seconds ASC';
    if (orderBy === 'volume') orderClause = 'adp.conversations_handled DESC';

    const result = await query(
      `SELECT
        sa.id, sa.user_id, u.name, u.avatar_url,
        SUM(adp.conversations_handled) as total_conversations,
        SUM(adp.conversations_resolved) as total_resolved,
        ROUND(AVG(adp.avg_csat_score), 2) as avg_csat,
        ROUND(AVG(adp.avg_first_response_seconds)/60, 1) as avg_first_response_minutes,
        ROUND(AVG(adp.avg_resolution_seconds)/3600, 1) as avg_resolution_hours,
        ROUND(100.0 * SUM(adp.sla_first_response_met_count) / NULLIF(SUM(adp.sla_first_response_met_count + adp.sla_first_response_violated_count), 0), 2) as sla_compliance
      FROM support_agents sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN agent_daily_performance adp ON sa.id = adp.agent_id
      WHERE sa.business_id = $1
      AND adp.performance_date > CURRENT_DATE - INTERVAL '1 day' * $2
      GROUP BY sa.id, sa.user_id, u.name, u.avatar_url
      ORDER BY ${orderClause}`,
      [businessId, parseInt(days)]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getAgentLeaderboard error', { error: err.message });
    sendError(res, 500, 'Failed to get leaderboard');
  }
}

async function getAgentMetrics(req, res) {
  try {
    const { agentId } = req.params;
    const { days = 30 } = req.query;

    const result = await query(
      `SELECT
        adp.performance_date,
        adp.conversations_handled,
        adp.conversations_resolved,
        ROUND(adp.avg_csat_score, 2) as avg_csat,
        ROUND(adp.avg_first_response_seconds/60, 1) as avg_first_response_minutes,
        ROUND(adp.avg_resolution_seconds/3600, 1) as avg_resolution_hours,
        ROUND(100.0 * adp.sla_first_response_met_count / NULLIF(adp.sla_first_response_met_count + adp.sla_first_response_violated_count, 0), 2) as sla_compliance,
        adp.total_worked_minutes,
        adp.conversations_escalated
      FROM agent_daily_performance adp
      WHERE adp.agent_id = $1 AND adp.performance_date > CURRENT_DATE - INTERVAL '1 day' * $2
      ORDER BY adp.performance_date DESC`,
      [agentId, parseInt(days)]
    );

    const summary = await query(
      `SELECT
        SUM(conversations_handled) as total_handled,
        SUM(conversations_resolved) as total_resolved,
        ROUND(AVG(avg_csat_score), 2) as avg_csat,
        ROUND(AVG(avg_first_response_seconds)/60, 1) as avg_first_response_minutes,
        ROUND(AVG(avg_resolution_seconds)/3600, 1) as avg_resolution_hours,
        SUM(conversations_escalated) as total_escalations
      FROM agent_daily_performance
      WHERE agent_id = $1 AND performance_date > CURRENT_DATE - INTERVAL '1 day' * $2`,
      [agentId, parseInt(days)]
    );

    res.json({
      success: true,
      data: {
        dailyMetrics: result.rows,
        summary: summary.rows[0]
      }
    });
  } catch (err) {
    logger.error('getAgentMetrics error', { error: err.message });
    sendError(res, 500, 'Failed to get agent metrics');
  }
}

async function getTeamPerformance(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    const result = await query(
      `SELECT
        st.id, st.team_name,
        SUM(tdp.conversations_handled) as total_conversations,
        SUM(tdp.conversations_resolved) as total_resolved,
        ROUND(AVG(tdp.avg_csat_score), 2) as avg_csat,
        ROUND(AVG(tdp.avg_resolution_time_seconds)/3600, 1) as avg_resolution_hours,
        ROUND(AVG(tdp.sla_compliance_percent), 2) as sla_compliance,
        SUM(tdp.escalations_received) as escalations_received,
        SUM(tdp.escalations_sent_to_next_level) as escalations_sent
      FROM support_teams st
      LEFT JOIN team_daily_performance tdp ON st.id = tdp.team_id
      WHERE st.business_id = $1 AND tdp.performance_date > CURRENT_DATE - INTERVAL '1 day' * $2
      GROUP BY st.id, st.team_name
      ORDER BY ROUND(AVG(tdp.avg_csat_score), 2) DESC`,
      [businessId, parseInt(days)]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getTeamPerformance error', { error: err.message });
    sendError(res, 500, 'Failed to get team performance');
  }
}

async function getBusinessMetrics(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    const result = await query(
      `SELECT
        SUM(total_conversations_created) as total_created,
        SUM(total_conversations_resolved) as total_resolved,
        ROUND(AVG(avg_first_response_seconds)/60, 1) as avg_first_response_minutes,
        ROUND(AVG(avg_resolution_seconds)/3600, 1) as avg_resolution_hours,
        ROUND(AVG(avg_csat_score), 2) as avg_csat,
        ROUND(AVG(sla_first_response_compliance), 2) as sla_first_response_compliance,
        ROUND(AVG(sla_resolution_compliance), 2) as sla_resolution_compliance,
        AVG(queue_length_avg) as avg_queue_length,
        AVG(avg_wait_time_seconds) as avg_wait_time_seconds
      FROM business_daily_metrics
      WHERE business_id = $1 AND metric_date > CURRENT_DATE - INTERVAL '1 day' * $2`,
      [businessId, parseInt(days)]
    );

    const trends = await query(
      `SELECT
        metric_date,
        total_conversations_created,
        total_conversations_resolved,
        avg_csat_score,
        sla_first_response_compliance,
        sla_resolution_compliance,
        queue_length_peak
      FROM business_daily_metrics
      WHERE business_id = $1 AND metric_date > CURRENT_DATE - INTERVAL '1 day' * $2
      ORDER BY metric_date DESC`,
      [businessId, parseInt(days)]
    );

    res.json({
      success: true,
      data: {
        summary: result.rows[0],
        trends: trends.rows
      }
    });
  } catch (err) {
    logger.error('getBusinessMetrics error', { error: err.message });
    sendError(res, 500, 'Failed to get business metrics');
  }
}

async function getConversationMetrics(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    const result = await query(
      `SELECT
        DATE(sc.resolved_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN cm.customer_satisfaction_score >= 4 THEN 1 ELSE 0 END) as high_satisfaction,
        ROUND(AVG(cm.first_response_time_seconds)/60, 1) as avg_first_response_minutes,
        ROUND(AVG(cm.resolution_time_seconds)/3600, 1) as avg_resolution_hours,
        SUM(CASE WHEN cm.reopened_count > 0 THEN 1 ELSE 0 END) as reopened
      FROM support_conversations sc
      LEFT JOIN conversation_metrics cm ON sc.id = cm.conversation_id
      WHERE sc.business_id = $1 AND sc.resolved_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2
      GROUP BY DATE(sc.resolved_at)
      ORDER BY DATE(sc.resolved_at) DESC`,
      [businessId, parseInt(days)]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getConversationMetrics error', { error: err.message });
    sendError(res, 500, 'Failed to get conversation metrics');
  }
}

async function getAgentUtilization(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    const result = await query(
      `SELECT
        sa.id, sa.user_id, u.name,
        ROUND(100.0 * SUM(adp.total_chat_minutes) / NULLIF(SUM(adp.total_worked_minutes), 0), 2) as utilization_percent,
        SUM(adp.conversations_handled) as conversations_handled,
        SUM(adp.total_worked_minutes) as total_worked_minutes,
        SUM(adp.total_chat_minutes) as total_chat_minutes
      FROM support_agents sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN agent_daily_performance adp ON sa.id = adp.agent_id
      WHERE sa.business_id = $1 AND adp.performance_date > CURRENT_DATE - INTERVAL '1 day' * $2
      GROUP BY sa.id, sa.user_id, u.name
      ORDER BY ROUND(100.0 * SUM(adp.total_chat_minutes) / NULLIF(SUM(adp.total_worked_minutes), 0), 2) DESC`,
      [businessId, parseInt(days)]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getAgentUtilization error', { error: err.message });
    sendError(res, 500, 'Failed to get agent utilization');
  }
}

module.exports = {
  getAgentLeaderboard, getAgentMetrics, getTeamPerformance,
  getBusinessMetrics, getConversationMetrics, getAgentUtilization
};
