'use strict';

const pool = require('../db');
const logger = require('../utils/logger');

const OPERATIONS_ROLES = new Set([
  'sourcing_operator',
  'logistics_coordinator',
  'warehouse_operator',
  'admin',
  'super_admin',
]);

const COMPLIANCE_ROLES = new Set([
  'compliance_reviewer',
  'admin',
  'super_admin',
]);

async function loadInternalAccessState(userId) {
  const { rows } = await pool.query(
    `SELECT user_id, operations_enabled, compliance_enabled, admin_portal_enabled, is_active
       FROM logistics_internal_access_credentials
      WHERE user_id = $1
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

function allowedRolesForWorkspace(workspace) {
  if (workspace === 'operations') return OPERATIONS_ROLES;
  if (workspace === 'compliance') return COMPLIANCE_ROLES;
  return new Set(['admin', 'super_admin']);
}

function enabledFlagForWorkspace(workspace) {
  if (workspace === 'operations') return 'operations_enabled';
  if (workspace === 'compliance') return 'compliance_enabled';
  return 'admin_portal_enabled';
}

function requireInternalLogisticsWorkspace(workspace) {
  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Unauthorized.' });
      }

      if (isAdminRole(req.user.role)) {
        return next();
      }

      const allowedRoles = allowedRolesForWorkspace(workspace);
      if (!allowedRoles.has(req.user.logistics_role)) {
        return res.status(403).json({ error: 'Internal workspace access required.' });
      }

      if (req.user.internal_access_route !== workspace) {
        return res.status(403).json({ error: 'Route-specific internal access session required.' });
      }

      const access = await loadInternalAccessState(req.user.id);
      const enabledFlag = enabledFlagForWorkspace(workspace);
      if (!access || !access.is_active || !access[enabledFlag]) {
        return res.status(403).json({ error: 'Internal workspace approval is no longer valid.' });
      }

      req.internalWorkspace = workspace;
      req.internalAccessRecord = access;
      return next();
    } catch (error) {
      logger.error('requireInternalLogisticsWorkspace failed', {
        workspace,
        userId: req.user?.id,
        error: error.message,
      });
      return res.status(500).json({ error: 'Failed to validate internal workspace access.' });
    }
  };
}

module.exports = {
  requireInternalLogisticsWorkspace,
};
