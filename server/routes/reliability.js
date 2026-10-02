'use strict';

/**
 * M4 — Reliability workspace routes.
 *
 * Mounted at /api/admin/super/reliability (see server/index.js).
 * Every route requires an authenticated admin with the manage_operations
 * grant. Dead-letter queues and webhook retries live in
 * server/routes/opsActions.js and are intentionally not duplicated here.
 */

const express = require('express');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const reliabilityController = require('../controllers/reliabilityController');

const router = express.Router();

router.use(requireAdmin, requirePermission('manage_operations'));

router.get('/releases', reliabilityController.listReleases);
router.post('/releases', reliabilityController.createRelease);
router.get('/migrations', reliabilityController.listMigrations);
router.get('/budgets', reliabilityController.getBudgets);

module.exports = router;
