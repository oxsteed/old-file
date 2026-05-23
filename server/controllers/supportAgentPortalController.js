/**
 * Support agent self-service portal (authenticated agent - not admin shell).
 * Aggregates employments from support_agents + support_employers (OxSteed multi-employer model).
 */

const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

/** True when DB is missing migration 149 (support_employers / employer_id). Avoid 500 on every page load. */
function isSupportEmployersSchemaMissing(err) {
  if (!err) return false;
  if (err.code === '42P01') return true; // PostgreSQL undefined_table
  const msg = String(err.message || '');
  return msg.includes('support_employers') && msg.includes('does not exist');
}

function employerLabel(row) {
  if (row.employer_kind === 'platform') {
    return row.employer_display_name || 'OxSteed Platform';
  }
  if (row.employer_kind === 'helper') {
    return row.employer_display_name || 'Personal support';
  }
  return row.employer_business_name || row.employer_display_name || 'Business';
}

function formatBusinessType(value) {
  if (!value) return null;
  return String(value)
    .split('_')
    .join(' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** GET /api/support/agent/me - all support employments for the current user */
async function getMyEmployments(req, res) {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT
         sa.id AS agent_id,
         sa.employer_id,
         e.kind AS employer_kind,
         e.display_name AS employer_display_name,
         e.business_id AS employer_business_id,
         e.helper_user_id,
         sa.business_id AS service_business_id,
         b_service.business_name AS service_business_name,
         b_emp.business_name AS employer_business_name,
         sa.status,
         sa.is_available,
         sa.role,
         sa.hire_date,
         sa.max_concurrent_chats
       FROM support_agents sa
       JOIN support_employers e ON e.id = sa.employer_id
       LEFT JOIN businesses b_service ON b_service.id = sa.business_id
       LEFT JOIN businesses b_emp ON b_emp.id = e.business_id AND e.kind = 'business'
       WHERE sa.user_id = $1
       ORDER BY e.kind, b_emp.business_name NULLS LAST, e.display_name NULLS LAST`,
      [userId]
    );

    const employments = result.rows.map((row) => ({
      agent_id: row.agent_id,
      employer_id: row.employer_id,
      employer_kind: row.employer_kind,
      employer_label: employerLabel(row),
      service_business_id: row.service_business_id,
      service_business_name: row.service_business_name,
      status: row.status,
      is_available: row.is_available,
      role: row.role,
      hire_date: row.hire_date,
      max_concurrent_chats: row.max_concurrent_chats,
    }));

    res.json({ success: true, data: employments });
  } catch (err) {
    if (isSupportEmployersSchemaMissing(err)) {
      logger.warn('getMyEmployments: support employers schema not migrated; returning empty list', {
        code: err.code,
        message: err.message,
      });
      return res.json({
        success: true,
        data: [],
        degraded: true,
        degradedReason: 'support_employers_migration_pending',
      });
    }
    logger.error('getMyEmployments error', { error: err.message });
    sendError(res, 500, 'Failed to load support agent profile');
  }
}

/**
 * PATCH /api/support/agent/me/availability
 * Body: { is_available: boolean, agent_id?: uuid } - if agent_id set, only that row (must belong to user); else all employments.
 */
async function patchMyAvailability(req, res) {
  try {
    const { is_available: isAvailable, agent_id: agentId } = req.body;

    if (typeof isAvailable !== 'boolean') {
      return sendValidationError(res, { is_available: 'Must be a boolean' });
    }

    if (agentId) {
      const upd = await query(
        `UPDATE support_agents
         SET is_available = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND user_id = $3
         RETURNING id, is_available`,
        [isAvailable, agentId, req.user.id]
      );
      if (!upd.rows.length) {
        return sendError(res, 404, 'Agent record not found');
      }
      return res.json({ success: true, data: upd.rows[0] });
    }

    const upd = await query(
      `UPDATE support_agents
       SET is_available = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND status = 'active'
       RETURNING id, is_available`,
      [isAvailable, req.user.id]
    );

    res.json({
      success: true,
      data: { updated: upd.rows.length, rows: upd.rows },
    });
  } catch (err) {
    if (isSupportEmployersSchemaMissing(err)) {
      logger.warn('patchMyAvailability: support employers schema not migrated; no-op', {
        code: err.code,
        message: err.message,
      });
      return res.json({
        success: true,
        data: { updated: 0, rows: [] },
        degraded: true,
        degradedReason: 'support_employers_migration_pending',
      });
    }
    logger.error('patchMyAvailability error', { error: err.message });
    sendError(res, 500, 'Failed to update availability');
  }
}

/** GET /api/support/agent/applications - current user's support-agent applications across businesses */
async function getMyApplications(req, res) {
  try {
    const result = await query(
      `SELECT
         aa.id,
         aa.business_id,
         aa.employer_id,
         aa.job_title,
         aa.experience_level,
         aa.languages,
         aa.availability,
         aa.resume_url,
         aa.cover_letter,
         aa.status,
         aa.review_notes,
         aa.reviewed_at,
         aa.created_at,
         b.business_name,
         b.business_type,
         b.description,
         b.address_city,
         b.address_state,
         b.website,
         b.phone,
         b.logo_url,
         COALESCE(b.is_business_verified, false) AS is_business_verified,
         h.hiring_title,
         h.hiring_description,
         h.desired_languages,
         h.desired_shift_coverage,
         h.remote_allowed,
         h.compensation_summary,
         h.response_time_expectation
       FROM agent_applications aa
       JOIN businesses b ON b.id = aa.business_id
       LEFT JOIN support_agent_hiring_profiles h ON h.business_id = b.id
       WHERE aa.user_id = $1
       ORDER BY aa.created_at DESC`,
      [req.user.id]
    );

    const applications = result.rows.map((row) => ({
      id: row.id,
      business_id: row.business_id,
      employer_id: row.employer_id,
      business_name: row.business_name,
      business_type: formatBusinessType(row.business_type),
      description: row.description,
      address_city: row.address_city,
      address_state: row.address_state,
      website: row.website,
      phone: row.phone,
      logo_url: row.logo_url,
      is_business_verified: row.is_business_verified,
      hiring_title: row.hiring_title,
      hiring_description: row.hiring_description,
      desired_languages: Array.isArray(row.desired_languages) ? row.desired_languages : [],
      desired_shift_coverage: row.desired_shift_coverage,
      remote_allowed: row.remote_allowed,
      compensation_summary: row.compensation_summary,
      response_time_expectation: row.response_time_expectation,
      job_title: row.job_title,
      experience_level: row.experience_level,
      languages: Array.isArray(row.languages) ? row.languages : [],
      availability: row.availability,
      resume_url: row.resume_url,
      cover_letter: row.cover_letter,
      status: row.status,
      review_notes: row.review_notes,
      reviewed_at: row.reviewed_at,
      created_at: row.created_at,
    }));

    res.json({ success: true, data: applications });
  } catch (err) {
    logger.error('getMyApplications error', { error: err.message });
    sendError(res, 500, 'Failed to load support-agent applications');
  }
}

/** GET /api/support/agent/opportunities - active OxSteed businesses with support signals the user can apply to */
async function getAgentOpportunities(req, res) {
  try {
    const result = await query(
      `SELECT
         b.id,
         b.business_name,
         b.business_type,
         b.description,
         b.website,
         b.phone,
         b.address_city,
         b.address_state,
         b.logo_url,
         COALESCE(b.is_business_verified, false) AS is_business_verified,
         COALESCE(conv.conversation_count_30d, 0) AS conversation_count_30d,
         COALESCE(agents.active_agents_count, 0) AS active_agents_count,
         h.hiring_title,
         h.hiring_description,
         h.desired_languages,
         h.desired_shift_coverage,
         h.remote_allowed,
         h.compensation_summary,
         h.response_time_expectation,
         my_agent.id AS existing_agent_id,
         app.id AS my_application_id,
         app.status AS my_application_status,
         app.created_at AS my_application_created_at
       FROM businesses b
       JOIN support_agent_hiring_profiles h
         ON h.business_id = b.id
        AND h.is_accepting_applications = true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS conversation_count_30d
         FROM support_conversations sc
         WHERE sc.business_id = b.id
           AND sc.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
       ) conv ON true
       LEFT JOIN LATERAL (
         SELECT e.id
         FROM support_employers e
         WHERE e.kind = 'business' AND e.business_id = b.id
         LIMIT 1
       ) employer ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS active_agents_count
         FROM support_agents sa
         WHERE sa.employer_id = employer.id
           AND sa.status = 'active'
       ) agents ON true
       LEFT JOIN LATERAL (
         SELECT sa.id
         FROM support_agents sa
         WHERE sa.user_id = $1
           AND (sa.business_id = b.id OR sa.employer_id = employer.id)
         LIMIT 1
       ) my_agent ON true
       LEFT JOIN LATERAL (
         SELECT aa.id, aa.status, aa.created_at
         FROM agent_applications aa
         WHERE aa.user_id = $1
           AND aa.business_id = b.id
         ORDER BY aa.created_at DESC
         LIMIT 1
       ) app ON true
       WHERE b.is_active = true
         AND COALESCE(b.deleted_at IS NULL, true)
         AND b.user_id <> $1
       ORDER BY
         CASE WHEN app.status = 'pending' THEN 0 ELSE 1 END,
         h.is_accepting_applications DESC,
         COALESCE(b.is_business_verified, false) DESC,
         b.business_name ASC`,
      [req.user.id]
    );

    const opportunities = result.rows.map((row) => ({
      business_id: row.id,
      business_name: row.business_name,
      business_type: formatBusinessType(row.business_type),
      description: row.description,
      website: row.website,
      phone: row.phone,
      address_city: row.address_city,
      address_state: row.address_state,
      logo_url: row.logo_url,
      is_business_verified: row.is_business_verified,
      conversation_count_30d: row.conversation_count_30d,
      active_agents_count: row.active_agents_count,
      hiring_title: row.hiring_title,
      hiring_description: row.hiring_description,
      desired_languages: Array.isArray(row.desired_languages) ? row.desired_languages : [],
      desired_shift_coverage: row.desired_shift_coverage,
      remote_allowed: row.remote_allowed,
      compensation_summary: row.compensation_summary,
      response_time_expectation: row.response_time_expectation,
      existing_agent_id: row.existing_agent_id,
      my_application_id: row.my_application_id,
      my_application_status: row.my_application_status,
      my_application_created_at: row.my_application_created_at,
      support_signal: 'published_hiring_profile',
    }));

    res.json({ success: true, data: opportunities });
  } catch (err) {
    if (isSupportEmployersSchemaMissing(err)) {
      logger.warn('getAgentOpportunities: support employers schema not migrated; returning empty list', {
        code: err.code,
        message: err.message,
      });
      return res.json({
        success: true,
        data: [],
        degraded: true,
        degradedReason: 'support_employers_migration_pending',
      });
    }
    logger.error('getAgentOpportunities error', { error: err.message });
    sendError(res, 500, 'Failed to load support-agent opportunities');
  }
}

module.exports = {
  getMyEmployments,
  patchMyAvailability,
  getMyApplications,
  getAgentOpportunities,
};
