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

const { requireAdmin } = require('../middleware/adminAuth');
const ctrl = require('../controllers/corporateRolesController');

// Catalog + caller introspection
router.get('/catalog',     requireAdmin, ctrl.getCatalog);
router.get('/me',          requireAdmin, ctrl.getMe);

// Departments (super-admin only for write)
router.get('/departments',         requireAdmin, ctrl.listDepartments);
router.post('/departments',        requireAdmin, ctrl.upsertDepartment);
router.put('/departments/:id',     requireAdmin, ctrl.upsertDepartment);
router.put('/departments/:id/permissions', requireAdmin, ctrl.setDepartmentDefaults);

// Titles (super-admin only for write)
router.get('/titles',         requireAdmin, ctrl.listTitles);
router.post('/titles',        requireAdmin, ctrl.upsertTitle);
router.put('/titles/:id',     requireAdmin, ctrl.upsertTitle);

// Assignments
router.get('/assignments',          requireAdmin, ctrl.listAssignments);
router.get('/assignments/:id',      requireAdmin, ctrl.getAssignment);
router.post('/assignments',         requireAdmin, ctrl.createAssignment);
router.patch('/assignments/:id',    requireAdmin, ctrl.updateAssignment);
router.delete('/assignments/:id',   requireAdmin, ctrl.endAssignment);
router.put('/assignments/:id/overrides', requireAdmin, ctrl.setOverrides);

// Org chart
router.get('/org-chart', requireAdmin, ctrl.getOrgChart);

// Audit log (super-admin only)
router.get('/audit', requireAdmin, ctrl.listAudit);

module.exports = router;
