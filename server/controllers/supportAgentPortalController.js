/**
 * Support agent self-service portal (authenticated agent — not admin shell).
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

/** GET /api/support/agent/me — all support employments for the current user */
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
 * Body: { is_available: boolean, agent_id?: uuid } — if agent_id set, only that row (must belong to user); else all employments.
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

module.exports = {
  getMyEmployments,
  patchMyAvailability,
};
