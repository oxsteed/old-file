// M3 — Global Service Operations, Capacity, Safety.
// All endpoints require admin authentication + the manage_operations grant.
// Mounted at /api/service-ops (see server/index.js).

const express = require('express');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const serviceOpsController = require('../controllers/serviceOpsController');

const router = express.Router();

router.use(requireAdmin, requirePermission('manage_operations'));

// Capacity: booking/demand load by region (or status/day when region
// attribution is unavailable), bounded 1..90 day window.
router.get('/capacity', serviceOpsController.getCapacity);

// Ops runbook registry.
router.get('/runbooks', serviceOpsController.listRunbooks);
router.post('/runbooks', serviceOpsController.createRunbook);
router.put('/runbooks/:id', serviceOpsController.updateRunbook);
router.delete('/runbooks/:id', serviceOpsController.deleteRunbook);

module.exports = router;
