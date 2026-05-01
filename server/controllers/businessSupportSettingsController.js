// Business Support Settings Controller
// Manages business-level support configuration: SLA targets, queue settings, integrations

const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');

// Get support settings for a business
async function getSupportSettings(req, res) {
  try {
    const { businessId } = req.params;

    // Verify access
    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    // Get SLA targets
    const slaTargets = await query(
      'SELECT * FROM support_sla_targets WHERE business_id = $1 ORDER BY priority',
      [businessId]
    );

    // Get break types
    const breakTypes = await query(
      'SELECT * FROM break_types WHERE business_id = $1 ORDER BY break_name',
      [businessId]
    );

    // Get routing rules
    const routingRules = await query(
      'SELECT * FROM routing_rules WHERE business_id = $1 ORDER BY priority DESC',
      [businessId]
    );

    res.json({
      success: true,
      data: {
        slaTargets: slaTargets.rows,
        breakTypes: breakTypes.rows,
        routingRules: routingRules.rows
      }
    });
  } catch (err) {
    logger.error('getSupportSettings error', { error: err.message });
    sendError(res, 500, 'Failed to get settings');
  }
}

// Set SLA target for a priority level
async function setSLATarget(req, res) {
  try {
    const { businessId } = req.params;
    const { priority, firstResponseTargetMinutes, resolutionTargetHours } = req.body;

    if (!priority || !firstResponseTargetMinutes || !resolutionTargetHours) {
      return sendValidationError(res, {
        priority: 'Required',
        firstResponseTargetMinutes: 'Required',
        resolutionTargetHours: 'Required'
      });
    }

    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
      return sendValidationError(res, { priority: 'Invalid priority' });
    }

    // Verify access
    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    const result = await query(
      `INSERT INTO support_sla_targets
       (business_id, priority, first_response_target_minutes, resolution_target_hours, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (business_id, priority) DO UPDATE SET
        first_response_target_minutes = $3,
        resolution_target_hours = $4,
        updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [businessId, priority, parseInt(firstResponseTargetMinutes), parseInt(resolutionTargetHours)]
    );

    logger.info('SLA target updated', { businessId, priority });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('setSLATarget error', { error: err.message });
    sendError(res, 500, 'Failed to set SLA target');
  }
}

// Create break type
async function createBreakType(req, res) {
  try {
    const { businessId } = req.params;
    const { breakName, durationMinutes, maxPerShift } = req.body;

    if (!breakName || !durationMinutes) {
      return sendValidationError(res, {
        breakName: 'Required',
        durationMinutes: 'Required'
      });
    }

    // Verify access
    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    const result = await query(
      `INSERT INTO break_types
       (business_id, break_name, duration_minutes, max_per_shift, active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [businessId, breakName, parseInt(durationMinutes), parseInt(maxPerShift) || 1]
    );

    logger.info('Break type created', { businessId, breakName });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('createBreakType error', { error: err.message });
    sendError(res, 500, 'Failed to create break type');
  }
}

// Create routing rule
async function createRoutingRule(req, res) {
  try {
    const { businessId } = req.params;
    const { ruleName, ruleType, condition, action, priority } = req.body;

    if (!ruleName || !ruleType) {
      return sendValidationError(res, {
        ruleName: 'Required',
        ruleType: 'Required'
      });
    }

    const validRuleTypes = ['skill_based', 'availability', 'language', 'team', 'manual'];
    if (!validRuleTypes.includes(ruleType)) {
      return sendValidationError(res, { ruleType: 'Invalid type' });
    }

    // Verify access
    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    const result = await query(
      `INSERT INTO routing_rules
       (business_id, rule_name, rule_type, condition, action, priority, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       RETURNING *`,
      [
        businessId,
        ruleName,
        ruleType,
        condition ? JSON.stringify(condition) : null,
        action ? JSON.stringify(action) : null,
        parseInt(priority) || 0,
        req.user.id
      ]
    );

    logger.info('Routing rule created', { businessId, ruleName });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('createRoutingRule error', { error: err.message });
    sendError(res, 500, 'Failed to create routing rule');
  }
}

// Update routing rule
async function updateRoutingRule(req, res) {
  try {
    const { ruleId } = req.params;
    const { ruleName, isActive, priority } = req.body;

    const result = await query(
      `UPDATE routing_rules
       SET rule_name = COALESCE($1, rule_name),
           is_active = COALESCE($2, is_active),
           priority = COALESCE($3, priority),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [ruleName || null, isActive !== undefined ? isActive : null, priority !== undefined ? priority : null, ruleId]
    );

    if (!result.rows.length) {
      return sendError(res, 404, 'Rule not found');
    }

    logger.info('Routing rule updated', { ruleId });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('updateRoutingRule error', { error: err.message });
    sendError(res, 500, 'Failed to update routing rule');
  }
}

// Delete routing rule
async function deleteRoutingRule(req, res) {
  try {
    const { ruleId } = req.params;

    const result = await query(
      'DELETE FROM routing_rules WHERE id = $1 RETURNING *',
      [ruleId]
    );

    if (!result.rows.length) {
      return sendError(res, 404, 'Rule not found');
    }

    logger.info('Routing rule deleted', { ruleId });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('deleteRoutingRule error', { error: err.message });
    sendError(res, 500, 'Failed to delete routing rule');
  }
}

// Get support statistics
async function getSupportStatistics(req, res) {
  try {
    const { businessId } = req.params;
    const { days = 30 } = req.query;

    // Verify access
    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    // Get aggregate stats
    const stats = await query(
      `SELECT
        COUNT(*) as total_conversations,
        SUM(CASE WHEN status = 'resolved' OR status = 'closed' THEN 1 ELSE 0 END) as resolved_conversations,
        SUM(CASE WHEN status = 'open' OR status = 'in_progress' THEN 1 ELSE 0 END) as active_conversations,
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_resolution_hours,
        COUNT(DISTINCT agent_id) as total_agents_used
      FROM support_conversations
      WHERE business_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2`,
      [businessId, parseInt(days)]
    );

    // Get SLA compliance
    const slaCompliance = await query(
      `SELECT
        ROUND(100.0 * SUM(CASE WHEN sla_first_response_breached = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as first_response_compliance_percent,
        ROUND(100.0 * SUM(CASE WHEN sla_resolution_breached = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as resolution_compliance_percent
      FROM support_conversations
      WHERE business_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2`,
      [businessId, parseInt(days)]
    );

    res.json({
      success: true,
      data: {
        ...stats.rows[0],
        ...slaCompliance.rows[0]
      }
    });
  } catch (err) {
    logger.error('getSupportStatistics error', { error: err.message });
    sendError(res, 500, 'Failed to get statistics');
  }
}

module.exports = {
  getSupportSettings,
  setSLATarget,
  createBreakType,
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
  getSupportStatistics
};
