/**
 * enforcementController.js
 * Manages enforcement actions: warnings, restrictions, suspensions
 *
 * Action ladder (escalating severity):
 *   warning     → Notify only; no platform restrictions
 *   restriction → Granular block (bidding / job_posting / checkout / all)
 *                 Writes to user_restrictions; checkRestrictions middleware enforces
 *   suspension  → Full account lock via users.is_suspended = true
 *                 Optionally timed (suspended_until)
 */

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { sendValidationError, sendError } = require('../utils/apiError');

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Apply a granular restriction to a user (called when actionType === 'restriction').
 * Writes to user_restrictions so checkRestrictions middleware can enforce it.
 */
async function applyUserRestriction(client, { userId, enforcementId, restrictions, expiresAt, issuedById, reason }) {
  // restrictions may be an object like { type: 'bidding' } or a string
  const restrictionType = (typeof restrictions === 'object' && restrictions?.type)
    ? restrictions.type
    : (typeof restrictions === 'string' ? restrictions : 'all');

  const validTypes = ['bidding', 'job_posting', 'checkout', 'all'];
  const safeType = validTypes.includes(restrictionType) ? restrictionType : 'all';

  await client.query(
    `INSERT INTO user_restrictions
       (user_id, enforcement_id, restriction_type, is_active, starts_at, expires_at,
        issued_by_id, reason, created_at, updated_at)
     VALUES ($1, $2, $3, true, NOW(), $4, $5, $6, NOW(), NOW())`,
    [userId, enforcementId || null, safeType, expiresAt || null, issuedById || null, reason]
  );

  return safeType;
}

/**
 * Apply a suspension to a user (called when actionType === 'suspension').
 * Sets users.is_suspended = true and optionally suspended_until.
 */
async function applyUserSuspension(client, { userId, expiresAt, reason }) {
  await client.query(
    `UPDATE users
       SET is_suspended     = true,
           suspended_until  = $2,
           suspended_reason = $3,
           updated_at       = NOW()
     WHERE id = $1`,
    [userId, expiresAt || null, reason || 'Account suspended by admin.']
  );
}

/**
 * Lift all active restrictions for a user (called on deactivation).
 */
async function liftUserRestrictions(client, userId) {
  await client.query(
    `UPDATE user_restrictions
       SET is_active = false, updated_at = NOW()
     WHERE user_id = $1 AND is_active = true`,
    [userId]
  );
}

/**
 * Lift suspension for a user (called on deactivation of a suspension action).
 */
async function liftUserSuspension(client, userId) {
  await client.query(
    `UPDATE users
       SET is_suspended     = false,
           suspended_until  = NULL,
           suspended_reason = NULL,
           updated_at       = NOW()
     WHERE id = $1`,
    [userId]
  );
}

// ─── Exported route handlers ───────────────────────────────────────────────────

/**
 * Issue enforcement action against a user
 * POST /api/admin/enforcement
 */
async function issueEnforcementAction(req, res) {
  try {
    const { userId, actionType, reason, description, restrictions, expiresAt, reportId } = req.body;
    const adminId = req.user.id;

    // Validation
    if (!userId) {
      return sendValidationError(res, { userId: 'Required' });
    }
    if (!actionType) {
      return sendValidationError(res, { actionType: 'Required' });
    }
    if (!reason) {
      return sendValidationError(res, { reason: 'Required' });
    }

    const validActionTypes = ['warning', 'restriction', 'suspension'];
    if (!validActionTypes.includes(actionType)) {
      return sendValidationError(res, { actionType: 'Invalid action type' });
    }

    // Verify user exists
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userResult.rows.length) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Create enforcement action + enforce it in a transaction
    const client = await pool.connect();
    let action;
    let appliedRestrictionType = null;

    try {
      await client.query('BEGIN');

      // Insert enforcement_actions row
      const result = await client.query(
        `INSERT INTO enforcement_actions (
          user_id, action_type, reason, description, restrictions,
          effective_at, expires_at, is_active, issued_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, true, $7, CURRENT_TIMESTAMP)
        RETURNING id, user_id, action_type, reason, effective_at, expires_at, is_active`,
        [userId, actionType, reason, description || null, restrictions ? JSON.stringify(restrictions) : null, expiresAt || null, adminId]
      );
      action = result.rows[0];

      // ── Action ladder enforcement ──────────────────────────────────────────
      if (actionType === 'restriction') {
        // Write to user_restrictions so checkRestrictions middleware can block
        appliedRestrictionType = await applyUserRestriction(client, {
          userId,
          enforcementId: action.id,
          restrictions,
          expiresAt,
          issuedById: adminId,
          reason
        });
      } else if (actionType === 'suspension') {
        // Full account lock
        await applyUserSuspension(client, { userId, expiresAt, reason });
        // Also lift any existing restrictions (suspension supersedes them)
        await liftUserRestrictions(client, userId);
      }
      // 'warning' → no DB side-effects, just the enforcement_actions row

      // If report is provided, update it
      if (reportId) {
        const resolutionMap = {
          'warning':     'warning',
          'restriction': 'restricted',
          'suspension':  'suspended'
        };
        await client.query(
          `UPDATE user_reports
             SET status = 'resolved', resolution = $1, reviewed_by = $2, resolved_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [resolutionMap[actionType], adminId, reportId]
        );
      }

      // Audit log
      await client.query(
        `INSERT INTO enforcement_audit_log (admin_id, action, target_user_id, enforcement_id, report_id, reason_for_action, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [adminId, `issued_${actionType}`, userId, action.id, reportId || null, description || reason]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    logger.info('Enforcement action issued and applied', {
      actionId: action.id,
      userId,
      actionType,
      appliedRestrictionType,
      adminId,
      expiresAt
    });

    res.status(201).json({
      success: true,
      data: {
        id: action.id,
        userId: action.user_id,
        actionType: action.action_type,
        reason,
        effectiveAt: action.effective_at,
        expiresAt: action.expires_at,
        isActive: action.is_active
      }
    });
  } catch (err) {
    logger.error('Error issuing enforcement action', { error: err.message });
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    sendError(res, 500, 'Failed to issue enforcement action');
  }
}

/**
 * Get enforcement actions for a user (admin/user self)
 * GET /api/admin/enforcement/:userId
 */
async function getUserEnforcementActions(req, res) {
  try {
    const { userId } = req.params;

    // Verify user exists
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userResult.rows.length) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const result = await pool.query(
      `SELECT
        id, user_id, action_type, reason, description, restrictions,
        effective_at, expires_at, is_active, issued_by, created_at
      FROM enforcement_actions
      WHERE user_id = $1
      ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        actionType: row.action_type,
        reason: row.reason,
        description: row.description,
        restrictions: row.restrictions ? JSON.parse(row.restrictions) : null,
        effectiveAt: row.effective_at,
        expiresAt: row.expires_at,
        isActive: row.is_active,
        issuedBy: row.issued_by,
        createdAt: row.created_at
      }))
    });
  } catch (err) {
    logger.error('Error fetching enforcement actions', { error: err.message, userId: req.params.userId });
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    sendError(res, 500, 'Failed to fetch enforcement actions');
  }
}

/**
 * Admin: List all enforcement actions with filtering
 * GET /api/admin/enforcement
 */
async function listEnforcementActions(req, res) {
  try {
    const { actionType, isActive, userId, sortBy = 'created_at' } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    let query = 'SELECT id, user_id, action_type, reason, effective_at, expires_at, is_active, created_at FROM enforcement_actions WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (actionType) {
      paramCount++;
      query += ` AND action_type = $${paramCount}`;
      params.push(actionType);
    }
    if (isActive !== undefined) {
      paramCount++;
      query += ` AND is_active = $${paramCount}`;
      params.push(isActive === 'true');
    }
    if (userId) {
      paramCount++;
      query += ` AND user_id = $${paramCount}`;
      params.push(userId);
    }

    const allowedSorts = ['created_at', 'action_type', 'expires_at'];
    const sort = allowedSorts.includes(sortBy) ? sortBy : 'created_at';
    query += ` ORDER BY ${sort} DESC`;

    query += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM enforcement_actions WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (actionType) {
      countParamCount++;
      countQuery += ` AND action_type = $${countParamCount}`;
      countParams.push(actionType);
    }
    if (isActive !== undefined) {
      countParamCount++;
      countQuery += ` AND is_active = $${countParamCount}`;
      countParams.push(isActive === 'true');
    }
    if (userId) {
      countParamCount++;
      countQuery += ` AND user_id = $${countParamCount}`;
      countParams.push(userId);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        actionType: row.action_type,
        reason: row.reason,
        effectiveAt: row.effective_at,
        expiresAt: row.expires_at,
        isActive: row.is_active,
        createdAt: row.created_at
      })),
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total
      }
    });
  } catch (err) {
    logger.error('Error listing enforcement actions', { error: err.message });
    sendError(res, 500, 'Failed to fetch enforcement actions');
  }
}

/**
 * Admin: Deactivate enforcement action
 * POST /api/admin/enforcement/:actionId/deactivate
 */
async function deactivateAction(req, res) {
  try {
    const { actionId } = req.params;
    const adminId = req.user.id;

    // Get action
    const actionResult = await pool.query(
      'SELECT id, user_id, action_type FROM enforcement_actions WHERE id = $1',
      [actionId]
    );

    if (!actionResult.rows.length) {
      throw new AppError('Enforcement action not found', 404, 'ACTION_NOT_FOUND');
    }

    const action = actionResult.rows[0];

    // Deactivate in a transaction, also lifting the enforcement effect
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mark enforcement action as inactive
      await client.query(
        'UPDATE enforcement_actions SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [actionId]
      );

      // ── Lift the effect ───────────────────────────────────────────────────
      if (action.action_type === 'restriction') {
        // Deactivate only the restriction rows tied to this enforcement action
        await client.query(
          `UPDATE user_restrictions
             SET is_active = false, updated_at = NOW()
           WHERE user_id = $1 AND enforcement_id = $2 AND is_active = true`,
          [action.user_id, actionId]
        );
      } else if (action.action_type === 'suspension') {
        // Check that no OTHER active suspension remains before lifting
        const otherSuspensions = await client.query(
          `SELECT id FROM enforcement_actions
            WHERE user_id = $1 AND action_type = 'suspension'
              AND is_active = true AND id != $2`,
          [action.user_id, actionId]
        );
        if (!otherSuspensions.rows.length) {
          await liftUserSuspension(client, action.user_id);
        }
      }

      // Audit log
      await client.query(
        `INSERT INTO enforcement_audit_log
           (admin_id, action, target_user_id, enforcement_id, reason_for_action, created_at)
         VALUES ($1, 'deactivated_enforcement', $2, $3, 'Action deactivated by admin', CURRENT_TIMESTAMP)`,
        [adminId, action.user_id, actionId]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    logger.info('Enforcement action deactivated and effect lifted', {
      actionId,
      actionType: action.action_type,
      userId: action.user_id,
      adminId
    });

    res.json({
      success: true,
      message: 'Enforcement action deactivated'
    });
  } catch (err) {
    logger.error('Error deactivating enforcement action', { error: err.message, actionId: req.params.actionId });
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    sendError(res, 500, 'Failed to deactivate enforcement action');
  }
}

/**
 * Admin: Get enforcement audit log
 * GET /api/admin/enforcement/audit-log
 */
async function getAuditLog(req, res) {
  try {
    const { adminId, targetUserId, action, sortBy = 'created_at' } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    let query = `SELECT id, admin_id, action, target_user_id, enforcement_id, report_id, reason_for_action, created_at
      FROM enforcement_audit_log WHERE 1=1`;
    const params = [];
    let paramCount = 0;

    if (adminId) {
      paramCount++;
      query += ` AND admin_id = $${paramCount}`;
      params.push(adminId);
    }
    if (targetUserId) {
      paramCount++;
      query += ` AND target_user_id = $${paramCount}`;
      params.push(targetUserId);
    }
    if (action) {
      paramCount++;
      query += ` AND action = $${paramCount}`;
      params.push(action);
    }

    const allowedSorts = ['created_at', 'action'];
    const sort = allowedSorts.includes(sortBy) ? sortBy : 'created_at';
    query += ` ORDER BY ${sort} DESC`;

    query += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        adminId: row.admin_id,
        action: row.action,
        targetUserId: row.target_user_id,
        enforcementId: row.enforcement_id,
        reportId: row.report_id,
        reasonForAction: row.reason_for_action,
        createdAt: row.created_at
      }))
    });
  } catch (err) {
    logger.error('Error fetching audit log', { error: err.message });
    sendError(res, 500, 'Failed to fetch audit log');
  }
}

/**
 * Programmatic helper: add a restriction directly (e.g. from automated systems)
 * @param {string} userId
 * @param {{ type: string, expiry?: Date|null, reason: string, issuedById?: string }} opts
 */
async function addUserRestriction(userId, opts) {
  const { type, expiry, reason, issuedById } = opts;
  await pool.query(
    `INSERT INTO user_restrictions
       (user_id, restriction_type, is_active, starts_at, expires_at, issued_by_id, reason, created_at, updated_at)
     VALUES ($1, $2, true, NOW(), $3, $4, $5, NOW(), NOW())`,
    [userId, type || 'all', expiry || null, issuedById || null, reason]
  );
}

/**
 * Programmatic helper: suspend a user directly (e.g. from automated systems)
 */
async function suspendUser(userId, opts = {}) {
  const { expiry, reason } = opts;
  await pool.query(
    `UPDATE users
       SET is_suspended = true, suspended_until = $2, suspended_reason = $3, updated_at = NOW()
     WHERE id = $1`,
    [userId, expiry || null, reason || 'Account suspended.']
  );
}

module.exports = {
  issueEnforcementAction,
  getUserEnforcementActions,
  listEnforcementActions,
  deactivateAction,
  getAuditLog,
  // Programmatic helpers for use by other controllers / automation
  addUserRestriction,
  suspendUser
};
