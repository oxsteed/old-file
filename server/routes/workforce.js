'use strict';

/**
 * M1 — Workforce Identity, Delegation, Access Lifecycle routes.
 *
 * Mounted by server/index.js at /api/admin/super/workforce.
 * Every route requires an authenticated admin holding the
 * 'manage_admin_accounts' grant (same gate as /admin/super/admin-accounts
 * and /admin/super/permissions).
 */

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const controller = require('../controllers/workforceController');

const gate = [requireAdmin, requirePermission('manage_admin_accounts')];

router.get('/staff', ...gate, controller.getStaff);
router.get('/delegations', ...gate, controller.listDelegations);
router.post('/delegations', ...gate, controller.createDelegation);
router.post('/delegations/:id/revoke', ...gate, controller.revokeDelegation);
router.get('/lifecycle', ...gate, controller.getLifecycle);

module.exports = router;
