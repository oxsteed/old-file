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
const inventoryOperations = require('../controllers/restaurantInventoryOperationsController');
const runner = require('../controllers/restaurantRunnerController');
const crew = require('../controllers/restaurantCrewController');
const help = require('../controllers/restaurantHelpController');
const pos = require('../controllers/restaurantPosController');
const kiosk = require('../controllers/restaurantKioskController');
const appFlow = require('../controllers/restaurantAppFlowController');
const food = require('../controllers/foodController');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');

// A new appliance has no staff session yet. These routes authenticate with the
// one-time pairing code or the per-device credential issued after pairing.
router.post('/:restaurantId/devices/pair', appFlow.pairDevice);
router.get('/:restaurantId/devices/:deviceId/runtime-config', appFlow.getDeviceRuntimeConfig);
router.post('/:restaurantId/devices/:deviceId/heartbeat', appFlow.deviceHeartbeat);
router.get('/:restaurantId/devices/:deviceId/kitchen-feed', appFlow.getKitchenFeed);
router.post('/:restaurantId/devices/:deviceId/kitchen-feed/ack', appFlow.ackKitchenFeed);
router.get('/:restaurantId/devices/:deviceId/queue-board', appFlow.getDeviceQueueBoard);
router.get('/:restaurantId/devices/:deviceId/display-stats', appFlow.getDisplayStats);
router.get('/:restaurantId/devices/:deviceId/display-settings', appFlow.getDeviceDisplaySettings);
router.patch('/:restaurantId/devices/:deviceId/display-settings', appFlow.updateDeviceDisplaySettings);
router.post('/:restaurantId/devices/:deviceId/report-issue', appFlow.reportDeviceIssue);
router.get('/:restaurantId/display/queue-board', appFlow.getPublicDisplayQueueBoard);
router.get('/:restaurantId/display/menu', food.getRestaurant);
router.post('/:restaurantId/display/orders/quote', food.quoteOrder);
router.get('/:restaurantId/display/devices/:deviceId/runtime-config', appFlow.getDeviceRuntimeConfig);
router.post('/:restaurantId/display/devices/:deviceId/heartbeat', appFlow.deviceHeartbeat);
router.get('/:restaurantId/display/devices/:deviceId/queue-board', appFlow.getDeviceQueueBoard);
router.get('/:restaurantId/display/devices/:deviceId/stats', appFlow.getDisplayStats);
router.get('/:restaurantId/display/devices/:deviceId/settings', appFlow.getDeviceDisplaySettings);
router.patch('/:restaurantId/display/devices/:deviceId/settings', appFlow.updateDeviceDisplaySettings);
router.post('/:restaurantId/display/devices/:deviceId/report-issue', appFlow.reportDeviceIssue);
router.get('/:restaurantId/menu', food.getRestaurant);
router.post('/:restaurantId/orders/quote', food.quoteOrder);
router.post('/:restaurantId/kiosk/orders/quote', food.quoteOrder);

// All routes require a signed-in user; the controller verifies the user belongs
// to the restaurant (and that nested rows belong to it) on every call.
router.use(authenticate);

// Cross-app bootstrap / Manager operations
router.get('/app/bootstrap', appFlow.discoverBootstrap);
router.get('/:restaurantId/app/bootstrap', appFlow.getBootstrap);
router.get('/:restaurantId/manager/dashboard', appFlow.getManagerDashboard);
router.get('/:restaurantId/display/stats', appFlow.getDisplayStats);
router.get('/:restaurantId/manager/reports', appFlow.getManagerReports);
router.get('/:restaurantId/publishing', appFlow.getPublishing);
router.patch('/:restaurantId/publishing', appFlow.updatePublishing);
router.get('/:restaurantId/kitchen/prep-device-config', appFlow.getPrepDeviceConfig);
router.patch('/:restaurantId/kitchen/prep-device-config', appFlow.updatePrepDeviceConfig);
router.post('/:restaurantId/locations', appFlow.createRestaurantLocation);
router.patch('/:restaurantId/locations/:locationId', appFlow.updateRestaurantLocation);

// Display / kiosk / device pairing
router.post('/:restaurantId/devices/pairing-codes', appFlow.createDevicePairingCode);
router.get('/:restaurantId/devices/:deviceId/config', appFlow.getDeviceConfig);
router.patch('/:restaurantId/devices/:deviceId', appFlow.updateDeviceConfig);

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
router.get('/:restaurantId/inventory/dashboard', inventoryOperations.getDashboard);
router.get('/:restaurantId/inventory/reports', inventoryOperations.getReports);
router.get('/:restaurantId/inventory/audit-events', inventoryOperations.listAuditEvents);
router.get('/:restaurantId/inventory/hooks/status', appFlow.getInventoryHookStatus);
router.post('/:restaurantId/inventory/hooks/sync', appFlow.syncMenuAvailability);
router.get('/:restaurantId/inventory/items', inventory.listItems);
router.post('/:restaurantId/inventory/items', inventory.createItem);
router.patch('/:restaurantId/inventory/items/:itemId', inventory.updateItem);
router.delete('/:restaurantId/inventory/items/:itemId', inventory.deleteItem);
router.post('/:restaurantId/inventory/items/:itemId/adjust', inventory.adjustItem);
router.post('/:restaurantId/inventory/sync-menu-availability', appFlow.syncMenuAvailability);
router.post('/:restaurantId/menu-items/:itemId/availability', appFlow.setMenuItemAvailability);
router.patch('/:restaurantId/menu-items/:itemId/availability', appFlow.setMenuItemAvailability);
router.post('/:restaurantId/pos/menu-items/:itemId/availability', appFlow.setMenuItemAvailability);
router.post('/:restaurantId/pos/menu-items/:itemId/sold-out', (req, _res, next) => {
  req.body.isAvailable = false;
  next();
}, appFlow.setMenuItemAvailability);
router.get('/:restaurantId/inventory/adjustments', inventory.listAdjustments);
router.get('/:restaurantId/inventory/mappings', inventory.listMappings);
router.post('/:restaurantId/inventory/mappings', inventory.upsertMapping);
router.delete('/:restaurantId/inventory/mappings/:mappingId', inventory.deleteMapping);
router.post('/:restaurantId/inventory/mappings/bootstrap-defaults', inventory.bootstrapMappings);
router.get('/:restaurantId/inventory/purchase-requests', inventory.listPurchaseRequests);
router.post('/:restaurantId/inventory/purchase-requests', inventory.createPurchaseRequest);
router.patch('/:restaurantId/inventory/purchase-requests/:requestId', inventory.updatePurchaseRequest);
router.get('/:restaurantId/inventory/supplier-issues', inventory.listSupplierIssues);
router.post('/:restaurantId/inventory/supplier-issues', inventory.createSupplierIssue);
router.patch('/:restaurantId/inventory/supplier-issues/:issueId', inventory.updateSupplierIssue);
router.get('/:restaurantId/inventory/areas', inventoryOperations.listAreas);
router.post('/:restaurantId/inventory/areas', inventoryOperations.createArea);
router.get('/:restaurantId/inventory/suppliers', inventoryOperations.listSuppliers);
router.post('/:restaurantId/inventory/suppliers', inventoryOperations.createSupplier);
router.get('/:restaurantId/inventory/transfers', inventoryOperations.listTransfers);
router.post('/:restaurantId/inventory/transfers', inventoryOperations.createTransfer);
router.patch('/:restaurantId/inventory/transfers/:transferId', inventoryOperations.updateTransfer);
router.get('/:restaurantId/inventory/receipts', inventoryOperations.listReceipts);
router.post('/:restaurantId/inventory/receipts', inventoryOperations.createReceipt);

// Crew training / certifications (App 6)
router.get('/:restaurantId/crew/dashboard', crew.getDashboard);
router.post('/:restaurantId/crew/bootstrap-defaults', crew.bootstrapDefaults);
router.post('/:restaurantId/crew/modules', crew.createModule);
router.patch('/:restaurantId/crew/modules/:moduleId', crew.updateModule);
router.post('/:restaurantId/crew/quizzes', crew.createQuizResult);
router.post('/:restaurantId/crew/badges', crew.upsertBadge);
router.patch('/:restaurantId/crew/badges/:badgeId', crew.upsertBadge);
router.get('/:restaurantId/crew/shifts', appFlow.listCrewShifts);
router.post('/:restaurantId/crew/shifts', appFlow.createCrewShift);
router.patch('/:restaurantId/crew/shifts/:shiftId', appFlow.updateCrewShift);
router.get('/:restaurantId/crew/shifts/:shiftId/history', appFlow.getCrewShiftHistory);
router.get('/:restaurantId/crew/tasks', appFlow.listCrewTasks);
router.post('/:restaurantId/crew/tasks', appFlow.createCrewTask);
router.patch('/:restaurantId/crew/tasks/:taskId', appFlow.updateCrewTask);
router.post('/:restaurantId/crew/tasks/:taskId/review', appFlow.reviewCrewTask);
router.get('/:restaurantId/crew/tasks/:taskId/proofs', appFlow.listCrewTaskProofs);
router.post(
  '/:restaurantId/crew/tasks/:taskId/proofs/upload',
  upload.single('file'),
  validateFileUpload,
  appFlow.uploadCrewTaskProof
);
router.post('/:restaurantId/crew/tasks/:taskId/proofs', appFlow.addCrewTaskProof);
router.get('/:restaurantId/crew/tasks/:taskId/comments', appFlow.listCrewTaskComments);
router.post('/:restaurantId/crew/tasks/:taskId/comments', appFlow.addCrewTaskComment);
router.get('/:restaurantId/crew/tasks/:taskId/events', appFlow.listCrewTaskEvents);

// Marketplace Help requests (App 2)
router.get('/:restaurantId/help-requests', help.listHelpRequests);
router.post('/:restaurantId/help-requests', help.createHelpRequest);
router.patch('/:restaurantId/help-requests/:helpRequestId', help.updateHelpRequest);

// Kiosk configuration (App 5)
router.get('/:restaurantId/kiosk-config', kiosk.getKioskConfig);
router.patch('/:restaurantId/kiosk-config', kiosk.upsertKioskConfig);
router.post('/:restaurantId/orders', food.createOrder);
router.get('/:restaurantId/orders', food.listRestaurantOrders);

// POS operations (App 3)
router.get('/:restaurantId/pos/discounts', pos.listDiscounts);
router.post('/:restaurantId/pos/sync/ack', appFlow.ackPendingOperations);
router.post('/:restaurantId/pos/pending-operations/ack', appFlow.ackPendingOperations);
router.get('/:restaurantId/pos/sync/status', appFlow.getPosSyncStatus);
router.get('/:restaurantId/pos/sync/health', appFlow.getPosSyncStatus);
router.get('/:restaurantId/pos/customer-wallet', appFlow.lookupPosCustomerWallet);
router.get('/:restaurantId/pos/orders', appFlow.listPosOrders);
router.post('/:restaurantId/pos/orders', appFlow.createPosOrder);
router.post('/:restaurantId/pos/orders/create', appFlow.createPosOrder);
router.post('/:restaurantId/pos/tickets', appFlow.createPosOrder);
router.get('/:restaurantId/pos/held-tickets', appFlow.listHeldTickets);
router.get('/:restaurantId/pos/tickets/held', appFlow.listHeldTickets);
router.patch('/:restaurantId/pos/orders/:orderId/ticket', appFlow.updatePosTicket);
router.post('/:restaurantId/pos/orders/:orderId/hold', appFlow.holdPosOrder);
router.post('/:restaurantId/pos/orders/:orderId/reopen', appFlow.reopenPosOrder);
router.post('/:restaurantId/pos/orders/:orderId/void', appFlow.voidPosOrder);
router.post('/:restaurantId/pos/orders/:orderId/split', appFlow.splitPosOrder);
router.post('/:restaurantId/pos/orders/:orderId/merge', appFlow.mergePosOrders);
router.post('/:restaurantId/pos/orders/:orderId/payments', appFlow.recordPosPayment);
router.post('/:restaurantId/pos/orders/:orderId/payment', appFlow.recordPosPayment);
router.post('/:restaurantId/pos/orders/:orderId/refund', appFlow.refundPosOrder);
router.post('/:restaurantId/pos/orders/:orderId/refunds', appFlow.refundPosOrder);
router.post('/:restaurantId/pos/terminal/connection-token', appFlow.createPosTerminalConnectionToken);
router.post('/:restaurantId/pos/orders/:orderId/card-intents', appFlow.createPosCardIntent);
router.get('/:restaurantId/pos/payments/:paymentId', appFlow.getPosPaymentStatus);
router.post('/:restaurantId/pos/payments/:paymentId/capture', appFlow.capturePosCardPayment);
router.post('/:restaurantId/pos/payments/:paymentId/refund', appFlow.refundPosCardPayment);
router.post('/:restaurantId/pos/orders/:orderId/reprint-receipt', appFlow.reprintReceipt);
router.get('/:restaurantId/pos/shifts', appFlow.listShifts);
router.post('/:restaurantId/pos/shifts', appFlow.openShift);
router.post('/:restaurantId/pos/shifts/:shiftId/close', appFlow.closeShift);
router.get('/:restaurantId/pos/shifts/:shiftId/drawer-events', appFlow.listDrawerEvents);
router.post('/:restaurantId/pos/shifts/:shiftId/drawer-events', appFlow.recordDrawerEvent);
router.post('/:restaurantId/pos/staff-pins', appFlow.setStaffPin);
router.post('/:restaurantId/pos/staff-pins/validate', appFlow.validateStaffPin);
router.get('/:restaurantId/pos/receipt-events', pos.listReceiptEvents);
router.post('/:restaurantId/pos/receipt-events', pos.createReceiptEvent);

// Kitchen audit / item-level state
router.get('/:restaurantId/kitchen/stations', appFlow.listKitchenStations);
router.post('/:restaurantId/kitchen/stations', appFlow.upsertKitchenStation);
router.post('/:restaurantId/kitchen/station-routes', appFlow.routeMenuItemToStation);
router.get('/:restaurantId/kitchen/feed', appFlow.getKitchenFeed);
router.post('/:restaurantId/kitchen/devices/:deviceId/feed-ack', appFlow.ackKitchenFeed);
router.post('/:restaurantId/kitchen/feed/ack', appFlow.ackKitchenFeed);
router.get('/:restaurantId/kitchen/events', appFlow.listKitchenEvents);
router.get('/:restaurantId/kitchen/audit-events', appFlow.listKitchenAuditEvents);
router.post('/:restaurantId/kitchen/events', appFlow.recordKitchenEvent);
router.post('/:restaurantId/kitchen/orders/:orderId/ack', appFlow.ackKitchenTicket);
router.post('/:restaurantId/kitchen/tickets/:orderId/ack', appFlow.ackKitchenTicket);
router.post('/:restaurantId/kitchen/items/:orderItemId/action', appFlow.performKitchenItemAction);
router.get('/:restaurantId/kitchen/printer-jobs', appFlow.listPrinterJobs);
router.post('/:restaurantId/kitchen/printer-jobs', appFlow.createPrinterJob);
router.post('/:restaurantId/kitchen/printer-jobs/:jobId/claim', appFlow.claimPrinterJob);
router.patch('/:restaurantId/kitchen/printer-jobs/:jobId', appFlow.updatePrinterJob);

// Runner / delivery operations (App 8)
router.get('/:restaurantId/runner/dashboard', runner.getDashboard);
router.get('/:restaurantId/runner/offers', appFlow.listRunnerOffers);
router.post('/:restaurantId/runner/tasks', runner.createTask);
router.post('/:restaurantId/runner/contact-rules', runner.createContactRule);
router.patch('/:restaurantId/runner/tasks/:taskId/dispatch', appFlow.updateRunnerDispatch);
router.post('/:restaurantId/runner/tasks/:taskId/assign', appFlow.updateRunnerDispatch);
router.post('/:restaurantId/runner/tasks/:taskId/claim', appFlow.claimRunnerTask);
router.post('/:restaurantId/runner/tasks/:taskId/decline', appFlow.declineRunnerTask);
router.post('/:restaurantId/runner/tasks/:taskId/handoff', appFlow.completeRunnerHandoff);
router.post('/:restaurantId/runner/tasks/:taskId/location', appFlow.logRunnerLocation);
router.post('/:restaurantId/runner/tasks/:taskId/settlements', appFlow.upsertRunnerSettlement);
router.post('/:restaurantId/runner/location', appFlow.logRunnerLocation);
router.get('/:restaurantId/runner/settlements', appFlow.listRunnerSettlements);
router.post('/:restaurantId/runner/settlements', appFlow.upsertRunnerSettlement);
router.patch('/:restaurantId/runner/tasks/:taskId/status', runner.updateTaskStatus);
router.post('/:restaurantId/runner/tasks/:taskId/proofs', runner.logProof);
router.post('/:restaurantId/runner/tasks/:taskId/issues', runner.reportIssue);
router.post('/:restaurantId/runner/tasks/:taskId/payment-notes', runner.logPaymentNote);

module.exports = router;
