// Business Support Settings Controller
// Manages business-level support configuration: SLA targets, queue settings, integrations

const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');

function isSupportAgentHiringSchemaMissing(err) {
  if (!err) return false;
  if (err.code === '42P01') {
    const msg = String(err.message || '');
    return msg.includes('support_agent_hiring_profiles') || msg.includes('does not exist');
  }
  const msg = String(err.message || '');
  return msg.includes('support_agent_hiring_profiles') && msg.includes('does not exist');
}

function normalizeLanguages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

function boundedInteger(value, min, max) {
  if (value === undefined || value === null || value === '' || !/^-?\d+$/.test(String(value).trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function boundedText(value, max) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function boundedJson(value, max = 10000) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= max ? serialized : null;
  } catch {
    return null;
  }
}

async function canManageBusiness(req, businessId) {
  if (supportEmployerService.isPlatformAdmin(req.user.role)) return true;
  return supportEmployerService.userCanManageBusiness(businessId, req.user.id);
}

// Get support settings for a business
async function getSupportSettings(req, res) {
  try {
    const { businessId } = req.params;

    // Verify access
    const can = await canManageBusiness(req, businessId);
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
    const { priority, firstResponseTargetMinutes, resolutionTargetHours } = req.body || {};
    const normalizedPriority = typeof priority === 'string' ? priority.trim().toLowerCase() : '';
    const responseMinutes = boundedInteger(firstResponseTargetMinutes, 1, 10080);
    const resolutionHours = boundedInteger(resolutionTargetHours, 1, 8760);

    if (!normalizedPriority || responseMinutes === null || resolutionHours === null) {
      return sendValidationError(res, {
        priority: 'Required',
        firstResponseTargetMinutes: 'Must be an integer from 1 to 10080',
        resolutionTargetHours: 'Must be an integer from 1 to 8760'
      });
    }

    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    if (!validPriorities.includes(normalizedPriority)) {
      return sendValidationError(res, { priority: 'Invalid priority' });
    }

    // Verify access
    const can = await canManageBusiness(req, businessId);
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
      [businessId, normalizedPriority, responseMinutes, resolutionHours]
    );

    logger.info('SLA target updated', { businessId, priority: normalizedPriority });

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
    const { breakName, durationMinutes, maxPerShift } = req.body || {};
    const normalizedName = boundedText(breakName, 100);
    const duration = boundedInteger(durationMinutes, 1, 1440);
    const maximumPerShift = maxPerShift === undefined ? 1 : boundedInteger(maxPerShift, 1, 100);

    if (!normalizedName || duration === null || maximumPerShift === null) {
      return sendValidationError(res, {
        breakName: 'Required and must be 100 characters or fewer',
        durationMinutes: 'Must be an integer from 1 to 1440',
        maxPerShift: 'Must be an integer from 1 to 100'
      });
    }

    // Verify access
    const can = await canManageBusiness(req, businessId);
    if (!can) return sendError(res, 403, 'Access denied');

    const result = await query(
      `INSERT INTO break_types
       (business_id, break_name, duration_minutes, max_per_shift, active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [businessId, normalizedName, duration, maximumPerShift]
    );

    logger.info('Break type created', { businessId, breakName: normalizedName });

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
    const { ruleName, ruleType, condition, action, priority } = req.body || {};
    const normalizedName = boundedText(ruleName, 150);
    const normalizedType = typeof ruleType === 'string' ? ruleType.trim().toLowerCase() : '';
    const normalizedCondition = boundedJson(condition);
    const normalizedAction = boundedJson(action);
    const normalizedPriority = priority === undefined ? 0 : boundedInteger(priority, 0, 1000);

    if (!normalizedName || !normalizedType || normalizedPriority === null || (condition != null && normalizedCondition === null) || (action != null && normalizedAction === null)) {
      return sendValidationError(res, {
        ruleName: 'Required and must be 150 characters or fewer',
        ruleType: 'Required',
        priority: 'Must be an integer from 0 to 1000',
        condition: 'Must be a JSON object of 10000 characters or fewer',
        action: 'Must be a JSON object of 10000 characters or fewer'
      });
    }

    const validRuleTypes = ['skill_based', 'availability', 'language', 'team', 'manual'];
    if (!validRuleTypes.includes(normalizedType)) {
      return sendValidationError(res, { ruleType: 'Invalid type' });
    }

    // Verify access
    const can = await canManageBusiness(req, businessId);
    if (!can) return sendError(res, 403, 'Access denied');

    const result = await query(
      `INSERT INTO routing_rules
       (business_id, rule_name, rule_type, condition, action, priority, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       RETURNING *`,
      [
        businessId,
        normalizedName,
        normalizedType,
        normalizedCondition,
        normalizedAction,
        normalizedPriority,
        req.user.id
      ]
    );

    logger.info('Routing rule created', { businessId, ruleName: normalizedName });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('createRoutingRule error', { error: err.message });
    sendError(res, 500, 'Failed to create routing rule');
  }
}

// Update routing rule
async function updateRoutingRule(req, res) {
  try {
    const { businessId } = req.params;
    const { ruleId } = req.params;
    const { ruleName, isActive, priority } = req.body || {};
    const normalizedName = ruleName === undefined ? null : boundedText(ruleName, 150);
    const normalizedPriority = priority === undefined ? null : boundedInteger(priority, 0, 1000);

    if ((ruleName !== undefined && normalizedName === null) || (priority !== undefined && normalizedPriority === null) || (isActive !== undefined && typeof isActive !== 'boolean')) {
      return sendValidationError(res, {
        ruleName: 'Must be 150 characters or fewer',
        isActive: 'Must be a boolean',
        priority: 'Must be an integer from 0 to 1000'
      });
    }

    if (!(await canManageBusiness(req, businessId))) return sendError(res, 403, 'Access denied');

    const result = await query(
      `UPDATE routing_rules
       SET rule_name = COALESCE($1, rule_name),
           is_active = COALESCE($2, is_active),
           priority = COALESCE($3, priority),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND business_id = $5
       RETURNING *`,
      [normalizedName, isActive !== undefined ? isActive : null, normalizedPriority, ruleId, businessId]
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
    const { businessId } = req.params;
    const { ruleId } = req.params;

    if (!(await canManageBusiness(req, businessId))) return sendError(res, 403, 'Access denied');

    const result = await query(
      'DELETE FROM routing_rules WHERE id = $1 AND business_id = $2 RETURNING *',
      [ruleId, businessId]
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
    const boundedDays = boundedInteger(days, 1, 365);

    if (boundedDays === null) return sendValidationError(res, { days: 'Must be an integer from 1 to 365' });

    // Verify access
    const can = await canManageBusiness(req, businessId);
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
      [businessId, boundedDays]
    );

    // Get SLA compliance
    const slaCompliance = await query(
      `SELECT
        ROUND(100.0 * SUM(CASE WHEN sla_first_response_breached = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as first_response_compliance_percent,
        ROUND(100.0 * SUM(CASE WHEN sla_resolution_breached = false THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as resolution_compliance_percent
      FROM support_conversations
      WHERE business_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2`,
      [businessId, boundedDays]
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

async function getHiringProfile(req, res) {
  try {
    const { businessId } = req.params;
    const can = await canManageBusiness(req, businessId);
    if (!can) return sendError(res, 403, 'Access denied');

    const result = await query(
      `SELECT
         business_id,
         is_accepting_applications,
         hiring_title,
         hiring_description,
         desired_languages,
         desired_shift_coverage,
         remote_allowed,
         compensation_summary,
         response_time_expectation,
         created_at,
         updated_at
       FROM support_agent_hiring_profiles
       WHERE business_id = $1`,
      [businessId]
    );

    res.json({
      success: true,
      data: result.rows[0] || {
        business_id: Number(businessId),
        is_accepting_applications: false,
        hiring_title: null,
        hiring_description: null,
        desired_languages: [],
        desired_shift_coverage: null,
        remote_allowed: true,
        compensation_summary: null,
        response_time_expectation: null,
      }
    });
  } catch (err) {
    if (isSupportAgentHiringSchemaMissing(err)) {
      logger.warn('getHiringProfile: hiring profile schema not migrated; returning defaults', {
        code: err.code,
        message: err.message,
      });
      return res.json({
        success: true,
        data: {
          business_id: Number(req.params.businessId),
          is_accepting_applications: false,
          hiring_title: null,
          hiring_description: null,
          desired_languages: [],
          desired_shift_coverage: null,
          remote_allowed: true,
          compensation_summary: null,
          response_time_expectation: null,
        },
        degraded: true,
        degradedReason: 'support_agent_hiring_profiles_migration_pending',
      });
    }
    logger.error('getHiringProfile error', { error: err.message });
    sendError(res, 500, 'Failed to load support-agent hiring profile');
  }
}

async function upsertHiringProfile(req, res) {
  try {
    const { businessId } = req.params;
    const can = await canManageBusiness(req, businessId);
    if (!can) return sendError(res, 403, 'Access denied');

    const {
      is_accepting_applications: isAcceptingApplications,
      hiring_title: hiringTitle,
      hiring_description: hiringDescription,
      desired_languages: desiredLanguages,
      desired_shift_coverage: desiredShiftCoverage,
      remote_allowed: remoteAllowed,
      compensation_summary: compensationSummary,
      response_time_expectation: responseTimeExpectation,
    } = req.body || {};

    if (typeof isAcceptingApplications !== 'boolean') {
      return sendValidationError(res, { is_accepting_applications: 'Must be a boolean' });
    }

    const result = await query(
      `INSERT INTO support_agent_hiring_profiles (
         business_id,
         is_accepting_applications,
         hiring_title,
         hiring_description,
         desired_languages,
         desired_shift_coverage,
         remote_allowed,
         compensation_summary,
         response_time_expectation,
         created_by,
         updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (business_id) DO UPDATE SET
         is_accepting_applications = EXCLUDED.is_accepting_applications,
         hiring_title = EXCLUDED.hiring_title,
         hiring_description = EXCLUDED.hiring_description,
         desired_languages = EXCLUDED.desired_languages,
         desired_shift_coverage = EXCLUDED.desired_shift_coverage,
         remote_allowed = EXCLUDED.remote_allowed,
         compensation_summary = EXCLUDED.compensation_summary,
         response_time_expectation = EXCLUDED.response_time_expectation,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING
         business_id,
         is_accepting_applications,
         hiring_title,
         hiring_description,
         desired_languages,
         desired_shift_coverage,
         remote_allowed,
         compensation_summary,
         response_time_expectation,
         created_at,
         updated_at`,
      [
        businessId,
        isAcceptingApplications,
        hiringTitle ? String(hiringTitle).trim().slice(0, 200) : null,
        hiringDescription ? String(hiringDescription).trim().slice(0, 3000) : null,
        normalizeLanguages(desiredLanguages),
        desiredShiftCoverage ? String(desiredShiftCoverage).trim().slice(0, 500) : null,
        remoteAllowed !== false,
        compensationSummary ? String(compensationSummary).trim().slice(0, 800) : null,
        responseTimeExpectation ? String(responseTimeExpectation).trim().slice(0, 200) : null,
        req.user.id
      ]
    );

    logger.info('Support-agent hiring profile updated', {
      businessId,
      userId: req.user.id,
      isAcceptingApplications,
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (isSupportAgentHiringSchemaMissing(err)) {
      logger.warn('upsertHiringProfile: hiring profile schema not migrated; rejecting gracefully', {
        code: err.code,
        message: err.message,
      });
      return sendError(
        res,
        503,
        'Support-agent hiring profiles are not available yet on this environment. Please run migration 273 first.',
        'support_agent_hiring_profiles_migration_pending'
      );
    }
    logger.error('upsertHiringProfile error', { error: err.message });
    sendError(res, 500, 'Failed to update support-agent hiring profile');
  }
}

async function listMyHiringProfiles(req, res) {
  try {
    const result = await query(
      `SELECT
         b.id AS business_id,
         b.business_name,
         b.business_type,
         b.address_city,
         b.address_state,
         b.logo_url,
         COALESCE(h.is_accepting_applications, false) AS is_accepting_applications,
         h.hiring_title,
         h.hiring_description,
         h.desired_languages,
         h.desired_shift_coverage,
         COALESCE(h.remote_allowed, true) AS remote_allowed,
         h.compensation_summary,
         h.response_time_expectation,
         h.updated_at
       FROM businesses b
       LEFT JOIN support_agent_hiring_profiles h ON h.business_id = b.id
       WHERE b.deleted_at IS NULL
         AND b.is_active != FALSE
         AND (
           b.user_id = $1::uuid
           OR EXISTS (
             SELECT 1
             FROM business_members bm
             WHERE bm.business_id = b.id
               AND bm.member_id = $1::uuid
               AND bm.status = 'active'
               AND bm.role IN ('manager', 'representative')
           )
         )
       ORDER BY COALESCE(h.is_accepting_applications, false) DESC, b.business_name ASC`,
      [req.user.id]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    if (isSupportAgentHiringSchemaMissing(err)) {
      logger.warn('listMyHiringProfiles: hiring profile schema not migrated; returning empty list', {
        code: err.code,
        message: err.message,
      });
      return res.json({
        success: true,
        data: [],
        degraded: true,
        degradedReason: 'support_agent_hiring_profiles_migration_pending',
      });
    }
    logger.error('listMyHiringProfiles error', { error: err.message });
    sendError(res, 500, 'Failed to load business hiring profiles');
  }
}

module.exports = {
  getSupportSettings,
  setSLATarget,
  createBreakType,
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
  getSupportStatistics,
  getHiringProfile,
  upsertHiringProfile,
  listMyHiringProfiles
};
