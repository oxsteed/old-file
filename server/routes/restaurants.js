'use strict';

// OxSteed Restaurants — canonical API surface (mounted at /api/restaurants).
// Phase 2 adds Operations: checklists (templates + runs + history) and the SOP
// library. The existing ordering surface stays at /api/food; this router is
// purely additive and every route is authenticated + restaurant-scoped.

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ops = require('../controllers/restaurantOpsController');

// All routes require a signed-in user; the controller verifies the user belongs
// to the restaurant (and that nested rows belong to it) on every call.
router.use(authenticate);

// Checklists (templates)
router.get('/:restaurantId/checklists', ops.listChecklists);
router.post('/:restaurantId/checklists', ops.createChecklist);
router.patch('/:restaurantId/checklists/:checklistId', ops.updateChecklist);
router.delete('/:restaurantId/checklists/:checklistId', ops.deleteChecklist);

// Checklist tasks
router.post('/:restaurantId/checklists/:checklistId/tasks', ops.addTask);
router.patch('/:restaurantId/checklists/:checklistId/tasks/:taskId', ops.updateTask);
router.delete('/:restaurantId/checklists/:checklistId/tasks/:taskId', ops.deleteTask);

// Checklist runs (execution + history)
router.post('/:restaurantId/checklists/:checklistId/runs', ops.startRun);
router.get('/:restaurantId/checklist-runs', ops.listRuns);
router.get('/:restaurantId/runs/:runId', ops.getRun);
router.patch('/:restaurantId/runs/:runId/items/:itemId', ops.toggleRunItem);
router.post('/:restaurantId/runs/:runId/complete', ops.completeRun);

// SOP library
router.get('/:restaurantId/sops', ops.listSops);
router.post('/:restaurantId/sops', ops.createSop);
router.patch('/:restaurantId/sops/:sopId', ops.updateSop);
router.delete('/:restaurantId/sops/:sopId', ops.deleteSop);

module.exports = router;
