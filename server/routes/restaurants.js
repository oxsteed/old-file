'use strict';

// OxSteed Restaurants — canonical API surface (mounted at /api/restaurants).
// Phase 2 adds Operations: checklists (templates + runs + history) and the SOP
// library. The existing ordering surface stays at /api/food; this router is
// purely additive and every route is authenticated + restaurant-scoped.

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ops = require('../controllers/restaurantOpsController');
const inventory = require('../controllers/restaurantInventoryController');
const runner = require('../controllers/restaurantRunnerController');
const crew = require('../controllers/restaurantCrewController');
const help = require('../controllers/restaurantHelpController');
const pos = require('../controllers/restaurantPosController');
const kiosk = require('../controllers/restaurantKioskController');

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

// Inventory (Phase 3, App 7): items + stock-adjustment ledger
router.get('/:restaurantId/inventory/items', inventory.listItems);
router.post('/:restaurantId/inventory/items', inventory.createItem);
router.patch('/:restaurantId/inventory/items/:itemId', inventory.updateItem);
router.delete('/:restaurantId/inventory/items/:itemId', inventory.deleteItem);
router.post('/:restaurantId/inventory/items/:itemId/adjust', inventory.adjustItem);
router.get('/:restaurantId/inventory/adjustments', inventory.listAdjustments);
router.get('/:restaurantId/inventory/mappings', inventory.listMappings);
router.post('/:restaurantId/inventory/mappings/bootstrap-defaults', inventory.bootstrapMappings);
router.get('/:restaurantId/inventory/purchase-requests', inventory.listPurchaseRequests);
router.post('/:restaurantId/inventory/purchase-requests', inventory.createPurchaseRequest);
router.patch('/:restaurantId/inventory/purchase-requests/:requestId', inventory.updatePurchaseRequest);
router.get('/:restaurantId/inventory/supplier-issues', inventory.listSupplierIssues);
router.post('/:restaurantId/inventory/supplier-issues', inventory.createSupplierIssue);
router.patch('/:restaurantId/inventory/supplier-issues/:issueId', inventory.updateSupplierIssue);

// Crew training / certifications (App 6)
router.get('/:restaurantId/crew/dashboard', crew.getDashboard);
router.post('/:restaurantId/crew/bootstrap-defaults', crew.bootstrapDefaults);
router.post('/:restaurantId/crew/modules', crew.createModule);
router.patch('/:restaurantId/crew/modules/:moduleId', crew.updateModule);
router.post('/:restaurantId/crew/quizzes', crew.createQuizResult);
router.post('/:restaurantId/crew/badges', crew.upsertBadge);
router.patch('/:restaurantId/crew/badges/:badgeId', crew.upsertBadge);

// Marketplace Help requests (App 2)
router.get('/:restaurantId/help-requests', help.listHelpRequests);
router.post('/:restaurantId/help-requests', help.createHelpRequest);
router.patch('/:restaurantId/help-requests/:helpRequestId', help.updateHelpRequest);

// Kiosk configuration (App 5)
router.get('/:restaurantId/kiosk-config', kiosk.getKioskConfig);
router.patch('/:restaurantId/kiosk-config', kiosk.upsertKioskConfig);

// POS operations (App 3)
router.get('/:restaurantId/pos/discounts', pos.listDiscounts);
router.get('/:restaurantId/pos/receipt-events', pos.listReceiptEvents);
router.post('/:restaurantId/pos/receipt-events', pos.createReceiptEvent);

// Runner / delivery operations (App 8)
router.get('/:restaurantId/runner/dashboard', runner.getDashboard);
router.post('/:restaurantId/runner/tasks', runner.createTask);
router.post('/:restaurantId/runner/contact-rules', runner.createContactRule);
router.patch('/:restaurantId/runner/tasks/:taskId/status', runner.updateTaskStatus);
router.post('/:restaurantId/runner/tasks/:taskId/proofs', runner.logProof);
router.post('/:restaurantId/runner/tasks/:taskId/issues', runner.reportIssue);
router.post('/:restaurantId/runner/tasks/:taskId/payment-notes', runner.logPaymentNote);

module.exports = router;
