'use strict';

const pool = require('../db');
const corporateRolesService = require('../services/corporateRolesService');
const {
  normalizeInternalAccessRoute,
  isCorporateWorkspaceRoute,
  canUseInternalAccessRoute,
} = require('../utils/internalWorkspaces');

function forbidden(res, message = 'Access denied.') {
  return res.status(403).json({ error: message, code: 'forbidden' });
}

function badRequest(res, message = 'Invalid workspace.') {
  return res.status(400).json({ error: message, code: 'bad_request' });
}

exports.getCatalog = async (_req, res, next) => {
  try {
    const catalog = await corporateRolesService.getCatalog();
    res.json({
      data: {
        workspaces: catalog.departments.map((department) => ({
          code: department.code,
          name: department.name,
          description: department.description,
          icon: department.icon,
          color: department.color,
          dashboard_path: `/internal/${String(department.code).replace(/_/g, '-')}`,
          login_path: `/internal/${String(department.code).replace(/_/g, '-')}/login`,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getWorkspaceDashboard = async (req, res, next) => {
  try {
    const workspace = normalizeInternalAccessRoute(req.params.workspace);
    if (!workspace || !isCorporateWorkspaceRoute(workspace)) {
      return badRequest(res, 'Valid internal workspace is required.');
    }

    const allowed = await canUseInternalAccessRoute(req.user, workspace);
    if (!allowed) {
      return forbidden(res, 'You are not assigned to this internal workspace.');
    }

    if (
      req.user.role === 'employee'
      && req.user.internal_access_route
      && req.user.internal_access_route !== workspace
    ) {
      return forbidden(res, 'Use the matching internal workspace login for this department.');
    }

    const catalog = await corporateRolesService.getCatalog();
    const department = catalog.departments.find((entry) => entry.code === workspace);
    if (!department) {
      return res.status(404).json({ error: 'Internal workspace not found.', code: 'not_found' });
    }

    const effective = await corporateRolesService.getEffectiveCorporatePermissions({
      userId: req.user.id,
      role: req.user.role,
      country: req.query.country || null,
    });

    const departmentAssignments = effective.assignments.filter(
      (assignment) => assignment.department_code === workspace
    );

    const { rows: roster } = await pool.query(
      `SELECT
         u.id AS user_id,
         u.first_name,
         u.last_name,
         u.email,
         u.role,
         t.code AS title_code,
         t.name AS title_name,
         t.seniority_level,
         t.is_csuite,
         ca.country_code,
         ca.started_at
       FROM corporate_assignments ca
       JOIN users u ON u.id = ca.user_id
       JOIN corporate_titles t ON t.id = ca.title_id
      WHERE ca.department_id = $1
        AND ca.is_active = TRUE
        AND u.is_active = TRUE
      ORDER BY t.seniority_level DESC, ca.started_at ASC, LOWER(u.first_name), LOWER(u.last_name)
      LIMIT 18`,
      [department.id]
    );

    const departmentTitles = catalog.titles.filter((title) => title.department_id === department.id);
    const departmentDefaultPermissions = Array.isArray(department.permissions)
      ? department.permissions
      : [];

    res.json({
      data: {
        workspace,
        department,
        assignments: departmentAssignments,
        permissions: Array.from(effective.permissions),
        department_default_permissions: departmentDefaultPermissions,
        department_titles: departmentTitles,
        roster,
      },
    });
  } catch (err) {
    next(err);
  }
};
