'use strict';

const pool = require('../db');

const LOGISTICS_INTERNAL_ROUTE_COLUMNS = Object.freeze({
  operations: 'operations_enabled',
  compliance: 'compliance_enabled',
  admin_portal: 'admin_portal_enabled',
});

const EMPLOYEE_LOGISTICS_OPERATIONS_ROLES = new Set([
  'sourcing_operator',
  'logistics_coordinator',
  'warehouse_operator',
]);

const EMPLOYEE_LOGISTICS_COMPLIANCE_ROLES = new Set(['compliance_reviewer']);
const CORPORATE_WORKSPACE_ROUTE_ALIASES = Object.freeze({
  hr: 'hr',
  people: 'hr',
  human_resources: 'hr',
  'human-resources': 'hr',
  legal: 'legal',
  finance: 'finance',
  marketing: 'marketing',
  executive: 'executive',
  technology: 'technology',
  data: 'data',
  corporate_ops: 'corporate_ops',
  corporateops: 'corporate_ops',
  'corporate-ops': 'corporate_ops',
});

function normalizeInternalAccessRoute(rawRoute) {
  if (!rawRoute) return null;
  const route = String(rawRoute).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LOGISTICS_INTERNAL_ROUTE_COLUMNS, route)) {
    return route;
  }
  if (Object.prototype.hasOwnProperty.call(CORPORATE_WORKSPACE_ROUTE_ALIASES, route)) {
    return CORPORATE_WORKSPACE_ROUTE_ALIASES[route];
  }
  return /^[a-z0-9_-]+$/.test(route) ? route.replace(/-/g, '_') : null;
}

function isLogisticsInternalRoute(route) {
  return Boolean(route) && Object.prototype.hasOwnProperty.call(LOGISTICS_INTERNAL_ROUTE_COLUMNS, route);
}

function isCorporateWorkspaceRoute(route) {
  return Boolean(route) && !isLogisticsInternalRoute(route);
}

function canUseLogisticsWorkspaceRouteSync(user, route) {
  if (!user || !isLogisticsInternalRoute(route)) return false;
  if (user.role === 'admin' || user.role === 'super_admin') return true;
  if (user.role !== 'employee') return false;
  if (route === 'operations') return EMPLOYEE_LOGISTICS_OPERATIONS_ROLES.has(user.logistics_role);
  if (route === 'compliance') return EMPLOYEE_LOGISTICS_COMPLIANCE_ROLES.has(user.logistics_role);
  return false;
}

async function hasActiveDepartmentAssignment(userId, departmentCode) {
  if (!userId || !departmentCode) return false;
  const { rows } = await pool.query(
    `SELECT 1
       FROM corporate_assignments ca
       JOIN corporate_departments d ON d.id = ca.department_id
      WHERE ca.user_id = $1
        AND ca.is_active = TRUE
        AND d.is_active = TRUE
        AND d.code = $2
      LIMIT 1`,
    [userId, departmentCode]
  );
  return rows.length > 0;
}

async function hasAnyActiveCorporateAssignment(userId) {
  if (!userId) return false;
  const { rows } = await pool.query(
    `SELECT 1
       FROM corporate_assignments
      WHERE user_id = $1
        AND is_active = TRUE
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

async function canUseInternalAccessRoute(user, route) {
  if (!user) return false;
  const normalizedRoute = normalizeInternalAccessRoute(route);
  if (!normalizedRoute) return false;
  if (isLogisticsInternalRoute(normalizedRoute)) {
    return canUseLogisticsWorkspaceRouteSync(user, normalizedRoute);
  }
  if (user.role === 'admin' || user.role === 'super_admin') return true;
  if (user.role !== 'employee') return false;
  const userId = user.id || user.user_id || user.linked_user_id || null;
  return hasActiveDepartmentAssignment(userId, normalizedRoute);
}

async function canHoldAnyInternalAccess(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'super_admin') return true;
  if (user.role !== 'employee') return false;
  if (EMPLOYEE_LOGISTICS_OPERATIONS_ROLES.has(user.logistics_role)) return true;
  if (EMPLOYEE_LOGISTICS_COMPLIANCE_ROLES.has(user.logistics_role)) return true;
  const userId = user.id || user.user_id || user.linked_user_id || null;
  return hasAnyActiveCorporateAssignment(userId);
}

module.exports = {
  LOGISTICS_INTERNAL_ROUTE_COLUMNS,
  EMPLOYEE_LOGISTICS_OPERATIONS_ROLES,
  EMPLOYEE_LOGISTICS_COMPLIANCE_ROLES,
  CORPORATE_WORKSPACE_ROUTE_ALIASES,
  normalizeInternalAccessRoute,
  isLogisticsInternalRoute,
  isCorporateWorkspaceRoute,
  canUseLogisticsWorkspaceRouteSync,
  canUseInternalAccessRoute,
  canHoldAnyInternalAccess,
  hasActiveDepartmentAssignment,
  hasAnyActiveCorporateAssignment,
};
