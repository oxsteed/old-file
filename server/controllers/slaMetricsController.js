const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');

async function canAccessBusiness(req, businessId, manage = false) {
  if (!businessId) return false;
  if (supportEmployerService.isPlatformAdmin(req.user?.role)) return true;
  return manage
    ? supportEmployerService.userCanAdministrateBusiness(businessId, req.user.id)
    : supportEmployerService.userCanAccessBusinessConversations(businessId, req.user.id, req.user.role);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function getSLADashboard(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    if (!(await canAccessBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    const boundedDays = boundedInteger(days, 30, 1, 365);
    const result = await query(
      `SELECT
        COUNT(*) as total_conversations,
        SUM(CASE WHEN sla_first_response_breached = false THEN 1 ELSE 0 END) as first_response_met,
        SUM(CASE WHEN sla_first_response_breached = true THEN 1 ELSE 0 END) as first_response_violated,
        SUM(CASE WHEN sla_resolution_breached = false THEN 1 ELSE 0 END) as resolution_met,
        SUM(CASE WHEN sla_resolution_breached = true THEN 1 ELSE 0 END) as resolution_violated,
        ROUND(100.0 * SUM(CASE WHEN sla_first_response_breached = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as first_response_compliance,
        ROUND(100.0 * SUM(CASE WHEN sla_resolution_breached = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as resolution_compliance
      FROM support_conversations
      WHERE business_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2`,
      [businessId, boundedDays]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('getSLADashboard error', { error: err.message });
    sendError(res, 500, 'Failed to get SLA dashboard');
  }
}

async function getSLABreaches(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    if (!(await canAccessBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    const boundedDays = boundedInteger(days, 30, 1, 365);
    const result = await query(
      `SELECT
        sc.id, sc.subject, sc.priority, sc.status,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - sc.sla_first_response_target))/3600 as hours_until_first_response_breach,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - sc.sla_resolution_target))/3600 as hours_until_resolution_breach,
        sc.sla_first_response_breached, sc.sla_resolution_breached,
        sa.user_id,
        COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS agent_name,
        sc.created_at
      FROM support_conversations sc
      LEFT JOIN support_agents sa ON sc.agent_id = sa.id
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sc.business_id = $1
      AND sc.created_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2
      AND (sc.sla_first_response_breached = true OR sc.sla_resolution_breached = true)
      ORDER BY sc.created_at DESC`,
      [businessId, boundedDays]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getSLABreaches error', { error: err.message });
    sendError(res, 500, 'Failed to get SLA breaches');
  }
}

async function getSLAByPriority(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    if (!(await canAccessBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    const boundedDays = boundedInteger(days, 30, 1, 365);
    const result = await query(
      `SELECT
        sc.priority,
        COUNT(*) as total,
        AVG(EXTRACT(EPOCH FROM (sc.first_response_at - sc.created_at))/60) as avg_first_response_minutes,
        AVG(EXTRACT(EPOCH FROM (sc.resolved_at - sc.created_at))/3600) as avg_resolution_hours,
        SUM(CASE WHEN sc.sla_first_response_breached = false THEN 1 ELSE 0 END) as first_response_met,
        SUM(CASE WHEN sc.sla_resolution_breached = false THEN 1 ELSE 0 END) as resolution_met
      FROM support_conversations sc
      WHERE sc.business_id = $1 AND sc.created_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2
      GROUP BY sc.priority
      ORDER BY CASE sc.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END`,
      [businessId, boundedDays]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getSLAByPriority error', { error: err.message });
    sendError(res, 500, 'Failed to get SLA by priority');
  }
}

async function getUpcomingBreaches(req, res) {
  try {
    const { businessId } = req.params;
    const { hours = 2 } = req.query;

    if (!(await canAccessBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    const boundedHours = boundedInteger(hours, 2, 1, 168);
    const result = await query(
      `SELECT
        sc.id, sc.subject, sc.priority,
        EXTRACT(EPOCH FROM (sc.sla_first_response_target - CURRENT_TIMESTAMP))/3600 as hours_to_first_response_breach,
        EXTRACT(EPOCH FROM (sc.sla_resolution_target - CURRENT_TIMESTAMP))/3600 as hours_to_resolution_breach,
        sa.user_id,
        COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS agent_name
      FROM support_conversations sc
      LEFT JOIN support_agents sa ON sc.agent_id = sa.id
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sc.business_id = $1
      AND sc.status NOT IN ('resolved', 'closed')
      AND (
        (sc.sla_first_response_target IS NOT NULL AND sc.sla_first_response_target < CURRENT_TIMESTAMP + INTERVAL '1 hour' * $2)
        OR (sc.sla_resolution_target IS NOT NULL AND sc.sla_resolution_target < CURRENT_TIMESTAMP + INTERVAL '1 hour' * $2)
      )
      ORDER BY LEAST(sc.sla_first_response_target, sc.sla_resolution_target) ASC`,
      [businessId, boundedHours]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getUpcomingBreaches error', { error: err.message });
    sendError(res, 500, 'Failed to get upcoming breaches');
  }
}

async function updateSLAStatus(req, res) {
  try {
    const { businessId, conversationId } = req.params;

    if (!(await canAccessBusiness(req, businessId, true))) return sendError(res, 403, 'Access denied');

    const conv = await query(
      'SELECT * FROM support_conversations WHERE id = $1 AND business_id = $2',
      [conversationId, businessId]
    );

    if (!conv.rows.length) return sendError(res, 404, 'Conversation not found');

    const conversation = conv.rows[0];

    let firstResponseBreached = false;
    let resolutionBreached = false;

    if (conversation.first_response_at && conversation.sla_first_response_target) {
      firstResponseBreached = new Date(conversation.first_response_at) > new Date(conversation.sla_first_response_target);
    }

    if (conversation.resolved_at && conversation.sla_resolution_target) {
      resolutionBreached = new Date(conversation.resolved_at) > new Date(conversation.sla_resolution_target);
    }

    const result = await query(
      `UPDATE support_conversations
       SET sla_first_response_breached = $1, sla_resolution_breached = $2
       WHERE id = $3 AND business_id = $4 RETURNING *`,
      [firstResponseBreached, resolutionBreached, conversationId, businessId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('updateSLAStatus error', { error: err.message });
    sendError(res, 500, 'Failed to update SLA status');
  }
}

async function getSLATrends(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    if (!(await canAccessBusiness(req, businessId))) return sendError(res, 403, 'Access denied');
    const boundedDays = boundedInteger(days, 30, 1, 365);
    const result = await query(
      `SELECT
        DATE(sc.created_at) as date,
        ROUND(100.0 * SUM(CASE WHEN sc.sla_first_response_breached = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as first_response_compliance,
        ROUND(100.0 * SUM(CASE WHEN sc.sla_resolution_breached = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as resolution_compliance,
        COUNT(*) as conversations
      FROM support_conversations sc
      WHERE sc.business_id = $1 AND sc.created_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2
      GROUP BY DATE(sc.created_at)
      ORDER BY DATE(sc.created_at) DESC`,
      [businessId, boundedDays]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getSLATrends error', { error: err.message });
    sendError(res, 500, 'Failed to get SLA trends');
  }
}

module.exports = {
  getSLADashboard, getSLABreaches, getSLAByPriority, getUpcomingBreaches,
  updateSLAStatus, getSLATrends
};
