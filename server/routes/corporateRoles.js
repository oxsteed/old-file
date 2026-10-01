'use strict';

/**
 * /api/admin/corporate/*  — OxSteed corporate hierarchy.
 *
 * All routes require an authenticated admin (admin or super_admin via
 * adminAuth.requireAdmin). Super-admin-only mutations are enforced inside
 * the controller so admins can still read the catalog / org chart.
 *
 * See server/migrations/246_corporate_hierarchy.sql for the schema and
 * server/services/corporateRolesService.js for the permission resolver.
 */

const express = require('express');
const router = express.Router();

const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const ctrl = require('../controllers/corporateRolesController');

// Catalog + caller introspection
router.get('/catalog',     requireAdmin, requirePermission('manage_admin_accounts'), ctrl.getCatalog);
router.get('/me',          requireAdmin, requirePermission('manage_admin_accounts'), ctrl.getMe);

// Departments (super-admin only for write)
router.get('/departments',         requireAdmin, requirePermission('manage_admin_accounts'), ctrl.listDepartments);
router.post('/departments',        requireAdmin, requirePermission('manage_admin_accounts'), ctrl.upsertDepartment);
router.put('/departments/:id',     requireAdmin, requirePermission('manage_admin_accounts'), ctrl.upsertDepartment);
router.put('/departments/:id/permissions', requireAdmin, requirePermission('manage_admin_accounts'), ctrl.setDepartmentDefaults);

// Titles (super-admin only for write)
router.get('/titles',         requireAdmin, requirePermission('manage_admin_accounts'), ctrl.listTitles);
router.post('/titles',        requireAdmin, requirePermission('manage_admin_accounts'), ctrl.upsertTitle);
router.put('/titles/:id',     requireAdmin, requirePermission('manage_admin_accounts'), ctrl.upsertTitle);

// Assignments
router.get('/assignments',          requireAdmin, requirePermission('manage_admin_accounts'), ctrl.listAssignments);
router.get('/assignments/:id',      requireAdmin, requirePermission('manage_admin_accounts'), ctrl.getAssignment);
router.post('/assignments',         requireAdmin, requirePermission('manage_admin_accounts'), ctrl.createAssignment);
router.patch('/assignments/:id',    requireAdmin, requirePermission('manage_admin_accounts'), ctrl.updateAssignment);
router.delete('/assignments/:id',   requireAdmin, requirePermission('manage_admin_accounts'), ctrl.endAssignment);
router.put('/assignments/:id/overrides', requireAdmin, requirePermission('manage_admin_accounts'), ctrl.setOverrides);

// Org chart
router.get('/org-chart', requireAdmin, requirePermission('manage_admin_accounts'), ctrl.getOrgChart);

// Audit log (super-admin only)
router.get('/audit', requireAdmin, requirePermission('manage_admin_accounts'), ctrl.listAudit);

module.exports = router;
