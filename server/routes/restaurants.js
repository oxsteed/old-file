'use strict';

// OxSteed Restaurants — canonical API surface (mounted at /api/restaurants).
// Phase 2 adds Operations: checklists (templates + runs + history) and the SOP
// library. The existing ordering surface stays at /api/food; this router is
// purely additive and every route is authenticated + restaurant-scoped.

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
// Tenant scope gates (scope report Area 4): every :restaurantId route runs the
// canonical restaurant gate or carries a reviewed scopeExempt reason.
const { requireRestaurantAccess, scopeExempt } = require('../middleware/scopeGates');
const ops = require('../controllers/restaurantOpsController');
const training = require('../controllers/restaurantTrainingController');
const staffDocuments = require('../controllers/restaurantStaffDocumentsController');
const teamComms = require('../controllers/restaurantTeamCommsController');
const audits = require('../controllers/restaurantAuditsController');
const franchiseReports = require('../controllers/restaurantReportsController');
const payrollReports = require('../controllers/restaurantPayrollController');
const inventory = require('../controllers/restaurantInventoryController');
const inventoryOperations = require('../controllers/restaurantInventoryOperationsController');
const runner = require('../controllers/restaurantRunnerController');
const crew = require('../controllers/restaurantCrewController');
const help = require('../controllers/restaurantHelpController');
const pos = require('../controllers/restaurantPosController');
const kiosk = require('../controllers/restaurantKioskController');
const appFlow = require('../controllers/restaurantAppFlowController');
const printer = require('../controllers/restaurantPrinterController');
const screens = require('../controllers/restaurantScreensController');
const food = require('../controllers/foodController');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const enforceUploadQuota = require('../middleware/uploadQuota');
const { authenticatedLimiter, strictLimiter, generalLimiter } = require('../middleware/rateLimiter');
const media = require('../controllers/restaurantMediaController');
const { requireKitchenDeviceOrStaff } = require('../controllers/restaurantDisplayController');
const hosting = require('../controllers/restaurantHostingController');

// Managed appliances authenticate with their scoped device credential.
router.post('/:restaurantId/devices/:deviceId/screen-orders', strictLimiter, scopeExempt('device-credential'), screens.createOrder);
router.get('/:restaurantId/devices/:deviceId/screen-snapshot', scopeExempt('device-credential'), screens.snapshot);
router.get('/:restaurantId/devices/:deviceId/screen-changes', scopeExempt('device-credential'), screens.changes);
router.post('/:restaurantId/devices/:deviceId/offline-tickets', strictLimiter, scopeExempt('device-credential'), screens.importTicket);
router.post('/:restaurantId/devices/:deviceId/screen-orders/:orderId/action', screens.authenticateKitchen, scopeExempt('device-credential'), screens.orderAction);
router.post('/:restaurantId/devices/:deviceId/screen-items/:orderItemId/action', screens.authenticateKitchen, scopeExempt('device-credential'), appFlow.performKitchenItemAction);
// A new appliance has no staff session yet. These routes authenticate with the
// one-time pairing code or the per-device credential issued after pairing.
router.post('/:restaurantId/devices/pair', strictLimiter, scopeExempt('device-credential'), appFlow.pairDevice);
router.get('/:restaurantId/devices/:deviceId/runtime-config', scopeExempt('device-credential'), appFlow.getDeviceRuntimeConfig);
router.post('/:restaurantId/devices/:deviceId/heartbeat', scopeExempt('device-credential'), appFlow.deviceHeartbeat);
router.get('/:restaurantId/devices/:deviceId/kitchen-feed', scopeExempt('device-credential'), appFlow.getKitchenFeed);
router.post('/:restaurantId/devices/:deviceId/kitchen-feed/ack', scopeExempt('device-credential'), appFlow.ackKitchenFeed);
router.get('/:restaurantId/devices/:deviceId/printer-jobs', appFlow.authenticateKitchenPrinterDevice, scopeExempt('device-credential'), appFlow.listPrinterJobs);
router.post('/:restaurantId/devices/:deviceId/printer-jobs/:jobId/claim', appFlow.authenticateKitchenPrinterDevice, scopeExempt('device-credential'), appFlow.claimPrinterJob);
router.patch('/:restaurantId/devices/:deviceId/printer-jobs/:jobId', appFlow.authenticateKitchenPrinterDevice, scopeExempt('device-credential'), appFlow.updatePrinterJob);
router.get('/:restaurantId/devices/:deviceId/queue-board', scopeExempt('device-credential'), appFlow.getDeviceQueueBoard);
router.get('/:restaurantId/devices/:deviceId/display-stats', scopeExempt('device-credential'), appFlow.getDisplayStats);
router.get('/:restaurantId/devices/:deviceId/display-settings', scopeExempt('device-credential'), appFlow.getDeviceDisplaySettings);
router.patch('/:restaurantId/devices/:deviceId/display-settings', scopeExempt('device-credential'), appFlow.updateDeviceDisplaySettings);
router.post('/:restaurantId/devices/:deviceId/report-issue', scopeExempt('device-credential'), appFlow.reportDeviceIssue);
router.post('/:restaurantId/devices/:deviceId/staff-session', strictLimiter, scopeExempt('device-credential'), appFlow.authenticatePosDevice, appFlow.createDeviceStaffSession);
router.post('/:restaurantId/devices/:deviceId/orders', appFlow.authenticateDisplayDevice, scopeExempt('device-credential'), food.createOrder);
router.get('/:restaurantId/display/queue-board', scopeExempt('public-storefront'), appFlow.getPublicDisplayQueueBoard);
router.get('/:restaurantId/display/menu', scopeExempt('public-storefront'), food.getRestaurant);
router.post('/:restaurantId/display/orders/quote', scopeExempt('public-storefront'), food.quoteOrder);
router.get('/:restaurantId/display/devices/:deviceId/runtime-config', scopeExempt('device-credential'), appFlow.getDeviceRuntimeConfig);
router.post('/:restaurantId/display/devices/:deviceId/heartbeat', scopeExempt('device-credential'), appFlow.deviceHeartbeat);
router.get('/:restaurantId/display/devices/:deviceId/queue-board', scopeExempt('device-credential'), appFlow.getDeviceQueueBoard);
router.get('/:restaurantId/display/devices/:deviceId/stats', scopeExempt('device-credential'), appFlow.getDisplayStats);
router.get('/:restaurantId/display/devices/:deviceId/settings', scopeExempt('device-credential'), appFlow.getDeviceDisplaySettings);
router.patch('/:restaurantId/display/devices/:deviceId/settings', scopeExempt('device-credential'), appFlow.updateDeviceDisplaySettings);
router.post('/:restaurantId/display/devices/:deviceId/report-issue', scopeExempt('device-credential'), appFlow.reportDeviceIssue);
router.post('/:restaurantId/display/devices/:deviceId/orders', appFlow.authenticateDisplayDevice, scopeExempt('device-credential'), food.createOrder);
router.get('/:restaurantId/menu', scopeExempt('public-storefront'), food.getRestaurant);
router.post('/:restaurantId/orders/quote', scopeExempt('public-storefront'), food.quoteOrder);
router.post('/:restaurantId/kiosk/orders/quote', scopeExempt('public-storefront'), food.quoteOrder);
// Restaurant Media tab (TikTok-style video feed) — public feed; the write
// surface below needs a signed-in user.
router.get('/:restaurantId/media', optionalAuth, scopeExempt('public-storefront'), media.listRestaurantMedia);

// Restaurant Media device video uploads (quarantine-first pipeline; the
// parallel photo workstream mounts nearby on its own anchor).
const videoMedia = require('../controllers/restaurantMediaVideoController');
router.post(
  '/:restaurantId/media/video-uploads',
  authenticate,
  videoMedia.videoUploadLimiter,
  videoMedia.videoUploadHandler,
  enforceUploadQuota,
  scopeExempt('customer-media'), videoMedia.postVideoUpload
);
router.post(
  '/:restaurantId/media/:mediaId/retry',
  authenticate,
  scopeExempt('customer-media'), videoMedia.retryVideoProcessing
);

// Kitchen ticket surface (Track B): a paired display's token authorizes the
// ticket feed + ticket actions for its own restaurant, so a kitchen tablet
// needs no staff login; staff requests fall through to the standard
// session + restaurant tenancy chain. The global device limiter counts per
// pairing id (multiple TVs share one NAT IP) so devices never consume the
// anonymous IP budget. Stations, audit, printer jobs, events and every other
// kitchen route below stay staff-only.
router.get('/:restaurantId/kitchen/feed', requireKitchenDeviceOrStaff, scopeExempt('device-credential'), appFlow.getKitchenFeed);
router.post('/:restaurantId/kitchen/orders/:orderId/ack', requireKitchenDeviceOrStaff, scopeExempt('device-credential'), appFlow.ackKitchenTicket);
router.post('/:restaurantId/kitchen/orders/:orderId/action', requireKitchenDeviceOrStaff, scopeExempt('device-credential'), appFlow.performKitchenOrderAction);
router.post('/:restaurantId/kitchen/items/:orderItemId/action', requireKitchenDeviceOrStaff, scopeExempt('device-credential'), appFlow.performKitchenItemAction);

// All routes require a signed-in user; the controller verifies the user belongs
// to the restaurant (and that nested rows belong to it) on every call.
router.use(authenticate);

// ── Restaurant Media tab (TikTok-style video feed) ────────────────────
// POST /media is bucketed at 10/day per account; the like toggle rides the
// general limiter; flags mirror Learn's videoFlagLimiter (30/hour).
router.post('/:restaurantId/media', media.mediaSubmitLimiter, scopeExempt('customer-media'), media.postRestaurantMedia);
router.post('/:restaurantId/media/photo-uploads', media.mediaSubmitLimiter, media.photoUpload, enforceUploadQuota, scopeExempt('customer-media'), media.postRestaurantMediaPhoto);
router.get('/:restaurantId/media/mine', scopeExempt('customer-media'), media.listMyRestaurantMedia);
router.post('/:restaurantId/media/:mediaId/like', generalLimiter, scopeExempt('customer-media'), media.toggleMediaLike);
router.delete('/:restaurantId/media/:mediaId', scopeExempt('customer-media'), media.deleteRestaurantMedia);
router.post('/:restaurantId/media/:mediaId/flags', media.mediaFlagLimiter, scopeExempt('customer-media'), media.flagMedia);

router.get('/:restaurantId/screens/control', requireRestaurantAccess(), screens.control);
router.put('/:restaurantId/screens/enabled', requireRestaurantAccess(), screens.enable);
router.get('/:restaurantId/screens/snapshot', requireRestaurantAccess(), screens.snapshot);
router.get('/:restaurantId/screens/changes', requireRestaurantAccess(), screens.changes);
router.post('/:restaurantId/screens/offline-tickets', requireRestaurantAccess(), screens.importTicket);
router.post('/:restaurantId/screens/offline-tickets/:ticketId/accept', requireRestaurantAccess(), screens.acceptTicket);
router.post('/:restaurantId/screens/offline-tickets/:ticketId/dismiss', requireRestaurantAccess(), screens.dismissTicket);
// Cross-app bootstrap / Manager operations
router.get('/app/bootstrap', appFlow.discoverBootstrap);
router.get('/:restaurantId/app/bootstrap', requireRestaurantAccess(), appFlow.getBootstrap);
router.get('/:restaurantId/manager/dashboard', requireRestaurantAccess(), appFlow.getManagerDashboard);
router.get('/:restaurantId/display/stats', requireRestaurantAccess(), appFlow.getDisplayStats);
router.get('/:restaurantId/manager/reports', requireRestaurantAccess(), appFlow.getManagerReports);
router.get('/:restaurantId/publishing', requireRestaurantAccess(), appFlow.getPublishing);
router.patch('/:restaurantId/publishing', requireRestaurantAccess(), appFlow.updatePublishing);
router.get('/:restaurantId/kitchen/prep-device-config', requireRestaurantAccess(), appFlow.getPrepDeviceConfig);
router.patch('/:restaurantId/kitchen/prep-device-config', requireRestaurantAccess(), appFlow.updatePrepDeviceConfig);
router.post('/:restaurantId/locations', requireRestaurantAccess(), appFlow.createRestaurantLocation);
router.patch('/:restaurantId/locations/:locationId', requireRestaurantAccess(), appFlow.updateRestaurantLocation);
const storeMenu = require('../controllers/restaurantStoreMenuController');
router.get('/:restaurantId/locations/:locationId/menu', requireRestaurantAccess(), storeMenu.list);
router.patch('/:restaurantId/locations/:locationId/menu-items/:itemId', requireRestaurantAccess(), storeMenu.update);

// Host stand: location-scoped floor plan, reservations, and walk-in queue.
// Every handler still resolves the effective restaurant permission in the
// controller; the route gate provides the canonical tenant boundary.
router.get('/:restaurantId/tables', requireRestaurantAccess(), hosting.listTables);
router.post('/:restaurantId/tables', requireRestaurantAccess(), hosting.createTable);
router.patch('/:restaurantId/tables/:tableId', requireRestaurantAccess(), hosting.updateTable);
router.get('/:restaurantId/reservations', requireRestaurantAccess(), hosting.listReservations);
router.post('/:restaurantId/reservations', requireRestaurantAccess(), hosting.createReservation);
router.patch('/:restaurantId/reservations/:reservationId', requireRestaurantAccess(), hosting.updateReservation);
router.get('/:restaurantId/waitlist', requireRestaurantAccess(), hosting.listWaitlist);
router.post('/:restaurantId/waitlist', requireRestaurantAccess(), hosting.createWaitlistEntry);
router.patch('/:restaurantId/waitlist/:entryId', requireRestaurantAccess(), hosting.updateWaitlistEntry);
router.post('/:restaurantId/waitlist/:entryId/notify', requireRestaurantAccess(), hosting.notifyWaitlistEntry);

// Display / kiosk / device pairing
router.post('/:restaurantId/devices/pairing-codes', authenticatedLimiter, requireRestaurantAccess(), appFlow.createDevicePairingCode);
router.post('/:restaurantId/devices/:deviceId/rotate-token', strictLimiter, requireRestaurantAccess(), appFlow.rotateDeviceToken);
router.get('/:restaurantId/devices/:deviceId/config', requireRestaurantAccess(), appFlow.getDeviceConfig);
router.patch('/:restaurantId/devices/:deviceId', requireRestaurantAccess(), appFlow.updateDeviceConfig);

// Checklists (templates)
router.get('/:restaurantId/checklists', requireRestaurantAccess(), ops.listChecklists);
router.post('/:restaurantId/checklists', requireRestaurantAccess(), ops.createChecklist);
router.patch('/:restaurantId/checklists/:checklistId', requireRestaurantAccess(), ops.updateChecklist);
router.delete('/:restaurantId/checklists/:checklistId', requireRestaurantAccess(), ops.deleteChecklist);

// Checklist tasks
router.post('/:restaurantId/checklists/:checklistId/tasks', requireRestaurantAccess(), ops.addTask);
router.patch('/:restaurantId/checklists/:checklistId/tasks/:taskId', requireRestaurantAccess(), ops.updateTask);
router.delete('/:restaurantId/checklists/:checklistId/tasks/:taskId', requireRestaurantAccess(), ops.deleteTask);

// Checklist runs (execution + history)
router.post('/:restaurantId/checklists/:checklistId/runs', requireRestaurantAccess(), ops.startRun);
router.get('/:restaurantId/checklist-runs', requireRestaurantAccess(), ops.listRuns);
router.get('/:restaurantId/runs/:runId', requireRestaurantAccess(), ops.getRun);
router.patch('/:restaurantId/runs/:runId/items/:itemId', requireRestaurantAccess(), ops.toggleRunItem);
router.post('/:restaurantId/runs/:runId/complete', requireRestaurantAccess(), ops.completeRun);

// SOP library
router.get('/:restaurantId/sops', requireRestaurantAccess(), ops.listSops);
router.post('/:restaurantId/sops', requireRestaurantAccess(), ops.createSop);
router.patch('/:restaurantId/sops/:sopId', requireRestaurantAccess(), ops.updateSop);
router.delete('/:restaurantId/sops/:sopId', requireRestaurantAccess(), ops.deleteSop);

// Inventory (Phase 3, App 7): items + stock-adjustment ledger
router.get('/:restaurantId/inventory/dashboard', requireRestaurantAccess(), inventoryOperations.getDashboard);
router.get('/:restaurantId/inventory/reports', requireRestaurantAccess(), inventoryOperations.getReports);
router.get('/:restaurantId/inventory/audit-events', requireRestaurantAccess(), inventoryOperations.listAuditEvents);
router.get('/:restaurantId/inventory/hooks/status', requireRestaurantAccess(), appFlow.getInventoryHookStatus);
router.post('/:restaurantId/inventory/hooks/sync', requireRestaurantAccess(), appFlow.syncMenuAvailability);
router.get('/:restaurantId/inventory/items', requireRestaurantAccess(), inventory.listItems);
router.post('/:restaurantId/inventory/items', requireRestaurantAccess(), inventory.createItem);
router.patch('/:restaurantId/inventory/items/:itemId', requireRestaurantAccess(), inventory.updateItem);
router.delete('/:restaurantId/inventory/items/:itemId', requireRestaurantAccess(), inventory.deleteItem);
router.post('/:restaurantId/inventory/items/:itemId/adjust', requireRestaurantAccess(), inventory.adjustItem);
router.post('/:restaurantId/inventory/sync-menu-availability', requireRestaurantAccess(), appFlow.syncMenuAvailability);
router.post('/:restaurantId/menu-items/:itemId/availability', requireRestaurantAccess(), appFlow.setMenuItemAvailability);
router.patch('/:restaurantId/menu-items/:itemId/availability', requireRestaurantAccess(), appFlow.setMenuItemAvailability);
router.post('/:restaurantId/pos/menu-items/:itemId/availability', requireRestaurantAccess(), appFlow.setMenuItemAvailability);
router.post('/:restaurantId/pos/menu-items/:itemId/sold-out', (req, _res, next) => {
  req.body.isAvailable = false;
  next();
}, requireRestaurantAccess(), appFlow.setMenuItemAvailability);
router.get('/:restaurantId/inventory/adjustments', requireRestaurantAccess(), inventory.listAdjustments);
router.get('/:restaurantId/inventory/mappings', requireRestaurantAccess(), inventory.listMappings);
router.post('/:restaurantId/inventory/mappings', requireRestaurantAccess(), inventory.upsertMapping);

// Staff training (franchise system)
router.get('/:restaurantId/training/modules', requireRestaurantAccess(), training.listModules);
router.post('/:restaurantId/training/modules', requireRestaurantAccess(), training.createModule);
router.patch('/:restaurantId/training/modules/:moduleId', requireRestaurantAccess(), training.updateModule);
router.delete('/:restaurantId/training/modules/:moduleId', requireRestaurantAccess(), training.deleteModule);
router.get('/:restaurantId/training/staff', requireRestaurantAccess(), training.listStaff);
router.post('/:restaurantId/training/modules/:moduleId/assign', requireRestaurantAccess(), training.assignModule);
router.get('/:restaurantId/training/assignments', requireRestaurantAccess(), training.listAssignments);
router.post('/:restaurantId/training/assignments/:assignmentId/start', requireRestaurantAccess(), training.startAssignment);
router.post('/:restaurantId/training/assignments/:assignmentId/submit', requireRestaurantAccess(), training.submitQuiz);
router.get('/:restaurantId/training/completions', requireRestaurantAccess(), training.listCompletions);
// Auto-assignment rules (S-12)
router.get('/:restaurantId/training/auto-assign-rules', requireRestaurantAccess(), training.listAutoAssignRules);
router.post('/:restaurantId/training/modules/:moduleId/auto-assign-rules', requireRestaurantAccess(), training.createAutoAssignRule);
router.patch('/:restaurantId/training/auto-assign-rules/:ruleId', requireRestaurantAccess(), training.updateAutoAssignRule);
router.delete('/:restaurantId/training/auto-assign-rules/:ruleId', requireRestaurantAccess(), training.deleteAutoAssignRule);
router.post('/:restaurantId/training/auto-assign-rules/run', requireRestaurantAccess(), training.runAutoAssign);
// Staff compliance document vault (S-14). Signed-URL storage only; no
// public file paths and no tax-form/SSN data by design.
router.get('/:restaurantId/staff-documents', requireRestaurantAccess(), staffDocuments.listDocuments);
router.post(
  '/:restaurantId/staff-documents',
  authenticate,
  upload.single('file'),
  validateFileUpload,
  requireRestaurantAccess(), staffDocuments.uploadDocument
);
router.patch('/:restaurantId/staff-documents/:documentId', requireRestaurantAccess(), staffDocuments.verifyDocument);
router.delete('/:restaurantId/staff-documents/:documentId', requireRestaurantAccess(), staffDocuments.deleteDocument);
// SOP read-and-sign acknowledgements (S-14)
router.post('/:restaurantId/sops/:sopId/acknowledge', requireRestaurantAccess(), staffDocuments.acknowledgeSop);
router.get('/:restaurantId/sop-acknowledgements', requireRestaurantAccess(), staffDocuments.listSopAcknowledgements);

// Quality audits (franchise system)
router.get('/:restaurantId/audits/templates', requireRestaurantAccess(), audits.listTemplates);
router.post('/:restaurantId/audits/templates', requireRestaurantAccess(), audits.createTemplate);
router.patch('/:restaurantId/audits/templates/:templateId', requireRestaurantAccess(), audits.updateTemplate);
router.delete('/:restaurantId/audits/templates/:templateId', requireRestaurantAccess(), audits.deleteTemplate);
router.post('/:restaurantId/audits/templates/:templateId/runs', requireRestaurantAccess(), audits.startAudit);
router.get('/:restaurantId/audits/runs', requireRestaurantAccess(), audits.listAudits);
router.get('/:restaurantId/audits/runs/:auditId', requireRestaurantAccess(), audits.getAudit);
router.post('/:restaurantId/audits/runs/:auditId/score', requireRestaurantAccess(), audits.scoreItem);
router.post('/:restaurantId/audits/runs/:auditId/complete', requireRestaurantAccess(), audits.completeAudit);
router.post('/:restaurantId/audits/runs/:auditId/findings', requireRestaurantAccess(), audits.addFinding);
router.post('/:restaurantId/audits/findings/:findingId/actions', requireRestaurantAccess(), audits.createCorrectiveAction);
router.get('/:restaurantId/audits/corrective-actions', requireRestaurantAccess(), audits.listCorrectiveActions);
router.patch('/:restaurantId/audits/corrective-actions/:actionId', requireRestaurantAccess(), audits.updateCorrectiveAction);

// Franchise reports (manager-only)
router.get('/:restaurantId/reports/sales', requireRestaurantAccess(), franchiseReports.salesSummary);
router.get('/:restaurantId/reports/sales/export.csv', requireRestaurantAccess(), franchiseReports.salesExportCsv);
router.get('/:restaurantId/reports/sales/journal.csv', requireRestaurantAccess(), franchiseReports.salesJournalExportCsv);
router.get('/:restaurantId/reports/sales/locations', requireRestaurantAccess(), franchiseReports.salesLocationComparison);
router.get('/:restaurantId/reports/sales/locations.csv', requireRestaurantAccess(), franchiseReports.salesLocationComparisonCsv);
router.get('/:restaurantId/reports/sales/close', requireRestaurantAccess(), franchiseReports.salesClose);
router.get('/:restaurantId/reports/sales/close.csv', requireRestaurantAccess(), franchiseReports.salesCloseCsv);
router.get('/:restaurantId/reports/inventory', requireRestaurantAccess(), franchiseReports.inventorySummary);
router.get('/:restaurantId/reports/operations', requireRestaurantAccess(), franchiseReports.operationsSummary);
// Loyalty: repeat-order rate + top items (analytics platform, Phase 2 Item 10)
router.get('/:restaurantId/reports/loyalty', requireRestaurantAccess(), franchiseReports.loyaltySummary);
// Payroll, tips, labor + team activity (S-04/S-15/S-16). Wage-bearing
// endpoints additionally require payroll.view inside the controller
// (fail closed); team activity requires audit.view.
router.get('/:restaurantId/reports/labor', requireRestaurantAccess(), payrollReports.laborSummary);
router.get('/:restaurantId/reports/payroll/export.csv', requireRestaurantAccess(), payrollReports.payrollExportCsv);
router.get('/:restaurantId/reports/exceptions', requireRestaurantAccess(), payrollReports.exceptionsReport);
router.get('/:restaurantId/team/activity', requireRestaurantAccess(), payrollReports.teamActivity);
router.get('/:restaurantId/tip-pool', requireRestaurantAccess(), payrollReports.getTipPoolSettings);
router.put('/:restaurantId/tip-pool', requireRestaurantAccess(), payrollReports.updateTipPoolSettings);
router.post('/:restaurantId/tips/cash-declarations', requireRestaurantAccess(), payrollReports.declareCashTip);
router.delete('/:restaurantId/inventory/mappings/:mappingId', requireRestaurantAccess(), inventory.deleteMapping);
router.post('/:restaurantId/inventory/mappings/bootstrap-defaults', requireRestaurantAccess(), inventory.bootstrapMappings);
router.get('/:restaurantId/inventory/purchase-requests', requireRestaurantAccess(), inventory.listPurchaseRequests);
router.post('/:restaurantId/inventory/purchase-requests', requireRestaurantAccess(), inventory.createPurchaseRequest);
router.patch('/:restaurantId/inventory/purchase-requests/:requestId', requireRestaurantAccess(), inventory.updatePurchaseRequest);
router.get('/:restaurantId/inventory/supplier-issues', requireRestaurantAccess(), inventory.listSupplierIssues);
router.post('/:restaurantId/inventory/supplier-issues', requireRestaurantAccess(), inventory.createSupplierIssue);
router.patch('/:restaurantId/inventory/supplier-issues/:issueId', requireRestaurantAccess(), inventory.updateSupplierIssue);
router.get('/:restaurantId/inventory/areas', requireRestaurantAccess(), inventoryOperations.listAreas);
router.post('/:restaurantId/inventory/areas', requireRestaurantAccess(), inventoryOperations.createArea);
router.get('/:restaurantId/inventory/suppliers', requireRestaurantAccess(), inventoryOperations.listSuppliers);
router.post('/:restaurantId/inventory/suppliers', requireRestaurantAccess(), inventoryOperations.createSupplier);
router.get('/:restaurantId/inventory/transfers', requireRestaurantAccess(), inventoryOperations.listTransfers);
router.post('/:restaurantId/inventory/transfers', requireRestaurantAccess(), inventoryOperations.createTransfer);
router.patch('/:restaurantId/inventory/transfers/:transferId', requireRestaurantAccess(), inventoryOperations.updateTransfer);
router.get('/:restaurantId/inventory/receipts', requireRestaurantAccess(), inventoryOperations.listReceipts);
router.post('/:restaurantId/inventory/receipts', requireRestaurantAccess(), inventoryOperations.createReceipt);

// Crew training / certifications (App 6)
router.get('/:restaurantId/crew/dashboard', requireRestaurantAccess(), crew.getDashboard);
router.post('/:restaurantId/crew/bootstrap-defaults', requireRestaurantAccess(), crew.bootstrapDefaults);
router.post('/:restaurantId/crew/modules', requireRestaurantAccess(), crew.createModule);
router.patch('/:restaurantId/crew/modules/:moduleId', requireRestaurantAccess(), crew.updateModule);
router.post('/:restaurantId/crew/quizzes', requireRestaurantAccess(), crew.createQuizResult);
router.post('/:restaurantId/crew/badges', requireRestaurantAccess(), crew.upsertBadge);
router.patch('/:restaurantId/crew/badges/:badgeId', requireRestaurantAccess(), crew.upsertBadge);
router.get('/:restaurantId/crew/shifts', requireRestaurantAccess(), appFlow.listCrewShifts);
router.post('/:restaurantId/crew/shifts', requireRestaurantAccess(), appFlow.createCrewShift);
router.patch('/:restaurantId/crew/shifts/:shiftId', requireRestaurantAccess(), appFlow.updateCrewShift);
router.get('/:restaurantId/crew/shifts/:shiftId/history', requireRestaurantAccess(), appFlow.getCrewShiftHistory);
router.get('/:restaurantId/crew/tasks', requireRestaurantAccess(), appFlow.listCrewTasks);
router.post('/:restaurantId/crew/tasks', requireRestaurantAccess(), appFlow.createCrewTask);
router.patch('/:restaurantId/crew/tasks/:taskId', requireRestaurantAccess(), appFlow.updateCrewTask);
router.post('/:restaurantId/crew/tasks/:taskId/review', requireRestaurantAccess(), appFlow.reviewCrewTask);
router.get('/:restaurantId/crew/tasks/:taskId/proofs', requireRestaurantAccess(), appFlow.listCrewTaskProofs);
router.post(
  '/:restaurantId/crew/tasks/:taskId/proofs/upload',
  authenticate,
  upload.single('file'),
  validateFileUpload,
  requireRestaurantAccess(), appFlow.uploadCrewTaskProof
);
router.post('/:restaurantId/crew/tasks/:taskId/proofs', requireRestaurantAccess(), appFlow.addCrewTaskProof);
router.get('/:restaurantId/crew/tasks/:taskId/comments', requireRestaurantAccess(), appFlow.listCrewTaskComments);
router.post('/:restaurantId/crew/tasks/:taskId/comments', requireRestaurantAccess(), appFlow.addCrewTaskComment);
router.get('/:restaurantId/crew/tasks/:taskId/events', requireRestaurantAccess(), appFlow.listCrewTaskEvents);

// Team communication (S-17): announcements with acknowledgement + log book.
router.get('/:restaurantId/announcements', requireRestaurantAccess(), teamComms.listAnnouncements);
router.post('/:restaurantId/announcements', requireRestaurantAccess(), teamComms.createAnnouncement);
router.post('/:restaurantId/announcements/:announcementId/acknowledge', requireRestaurantAccess(), teamComms.acknowledgeAnnouncement);
router.get('/:restaurantId/logbook', requireRestaurantAccess(), teamComms.listLogbook);
router.post('/:restaurantId/logbook', requireRestaurantAccess(), teamComms.createLogbookEntry);

// Marketplace Help requests (App 2)
router.get('/:restaurantId/help-requests', requireRestaurantAccess(), help.listHelpRequests);
router.post('/:restaurantId/help-requests', requireRestaurantAccess(), help.createHelpRequest);
router.patch('/:restaurantId/help-requests/:helpRequestId', requireRestaurantAccess(), help.updateHelpRequest);

// Kiosk configuration (App 5)
router.get('/:restaurantId/kiosk-config', requireRestaurantAccess(), kiosk.getKioskConfig);
router.patch('/:restaurantId/kiosk-config', requireRestaurantAccess(), kiosk.upsertKioskConfig);
router.post('/:restaurantId/orders', scopeExempt('public-storefront'), food.createOrder);
router.get('/:restaurantId/orders', requireRestaurantAccess(), food.listRestaurantOrders);

// POS operations (App 3)
router.get('/:restaurantId/pos/discounts', requireRestaurantAccess(), pos.listDiscounts);
router.get('/:restaurantId/pos/discount-definitions', requireRestaurantAccess(), pos.listDiscountDefinitions);
router.post('/:restaurantId/pos/discount-definitions', requireRestaurantAccess(), pos.createDiscountDefinition);
router.patch('/:restaurantId/pos/discount-definitions/:definitionId', requireRestaurantAccess(), pos.updateDiscountDefinition);
router.delete('/:restaurantId/pos/discount-definitions/:definitionId', requireRestaurantAccess(), pos.deactivateDiscountDefinition);
router.post('/:restaurantId/pos/sync/ack', requireRestaurantAccess(), appFlow.ackPendingOperations);
router.post('/:restaurantId/pos/pending-operations/ack', requireRestaurantAccess(), appFlow.ackPendingOperations);
router.get('/:restaurantId/pos/sync/status', requireRestaurantAccess(), appFlow.getPosSyncStatus);
router.get('/:restaurantId/pos/sync/health', requireRestaurantAccess(), appFlow.getPosSyncStatus);
router.get('/:restaurantId/pos/customer-wallet', requireRestaurantAccess(), appFlow.lookupPosCustomerWallet);
router.get('/:restaurantId/pos/orders', requireRestaurantAccess(), appFlow.listPosOrders);
router.post('/:restaurantId/pos/orders', requireRestaurantAccess(), appFlow.createPosOrder);
router.post('/:restaurantId/pos/orders/create', requireRestaurantAccess(), appFlow.createPosOrder);
router.post('/:restaurantId/pos/tickets', requireRestaurantAccess(), appFlow.createPosOrder);
router.get('/:restaurantId/pos/held-tickets', requireRestaurantAccess(), appFlow.listHeldTickets);
router.get('/:restaurantId/pos/tickets/held', requireRestaurantAccess(), appFlow.listHeldTickets);
router.patch('/:restaurantId/pos/orders/:orderId/ticket', requireRestaurantAccess(), appFlow.updatePosTicket);
router.post('/:restaurantId/pos/orders/:orderId/hold', requireRestaurantAccess(), appFlow.holdPosOrder);
router.post('/:restaurantId/pos/orders/:orderId/reopen', requireRestaurantAccess(), appFlow.reopenPosOrder);
router.post('/:restaurantId/pos/orders/:orderId/void', requireRestaurantAccess(), appFlow.voidPosOrder);
router.post('/:restaurantId/pos/orders/:orderId/split', requireRestaurantAccess(), appFlow.splitPosOrder);
router.post('/:restaurantId/pos/orders/:orderId/merge', requireRestaurantAccess(), appFlow.mergePosOrders);
router.post('/:restaurantId/pos/orders/:orderId/payments', requireRestaurantAccess(), appFlow.recordPosPayment);
router.post('/:restaurantId/pos/orders/:orderId/payment', requireRestaurantAccess(), appFlow.recordPosPayment);
router.post('/:restaurantId/pos/orders/:orderId/refund', requireRestaurantAccess(), appFlow.refundPosOrder);
router.post('/:restaurantId/pos/orders/:orderId/refunds', requireRestaurantAccess(), appFlow.refundPosOrder);
router.post('/:restaurantId/pos/terminal/connection-token', requireRestaurantAccess(), appFlow.createPosTerminalConnectionToken);
router.post('/:restaurantId/pos/orders/:orderId/card-intents', requireRestaurantAccess(), appFlow.createPosCardIntent);
router.get('/:restaurantId/pos/payments/:paymentId', requireRestaurantAccess(), appFlow.getPosPaymentStatus);
router.post('/:restaurantId/pos/payments/:paymentId/capture', requireRestaurantAccess(), appFlow.capturePosCardPayment);
router.post('/:restaurantId/pos/payments/:paymentId/refund', requireRestaurantAccess(), appFlow.refundPosCardPayment);
router.post('/:restaurantId/pos/orders/:orderId/reprint-receipt', requireRestaurantAccess(), appFlow.reprintReceipt);
// Network receipt printer (ESC/POS) + cash drawer. F-05: prints are queued
// as restaurant_printer_jobs for paired in-store devices; the API server
// does not dial the printer (direct dial only behind
// RESTAURANT_SERVER_PRINTING_ENABLED=true). Printing never writes to
// order/payment tables, so it cannot alter order or payment state.
router.get('/:restaurantId/printer-settings', requireRestaurantAccess(), printer.getPrinterSettings);
router.put('/:restaurantId/printer-settings', requireRestaurantAccess(), printer.updatePrinterSettings);
router.post('/:restaurantId/printer-test', requireRestaurantAccess(), printer.printTestPage);
router.post('/:restaurantId/print-receipt', requireRestaurantAccess(), printer.printReceipt);
router.get('/:restaurantId/pos/shifts', requireRestaurantAccess(), appFlow.listShifts);
router.post('/:restaurantId/pos/shifts', requireRestaurantAccess(), appFlow.openShift);
router.post('/:restaurantId/pos/shifts/:shiftId/close', requireRestaurantAccess(), appFlow.closeShift);
router.get('/:restaurantId/pos/shifts/:shiftId/drawer-events', requireRestaurantAccess(), appFlow.listDrawerEvents);
router.post('/:restaurantId/pos/shifts/:shiftId/drawer-events', requireRestaurantAccess(), appFlow.recordDrawerEvent);
router.post('/:restaurantId/pos/staff-pins', requireRestaurantAccess(), appFlow.setStaffPin);
router.post('/:restaurantId/pos/staff-pins/validate', requireRestaurantAccess(), appFlow.validateStaffPin);
router.post('/:restaurantId/pos/staff-session', requireRestaurantAccess(), appFlow.createStaffSession);
router.get('/:restaurantId/pos/staff-session', requireRestaurantAccess(), appFlow.getStaffSession);
router.delete('/:restaurantId/pos/staff-session', requireRestaurantAccess(), appFlow.endStaffSession);
router.get('/:restaurantId/pos/receipt-events', requireRestaurantAccess(), pos.listReceiptEvents);
router.post('/:restaurantId/pos/receipt-events', requireRestaurantAccess(), pos.createReceiptEvent);

// Kitchen audit / item-level state
router.get('/:restaurantId/kitchen/stations', requireRestaurantAccess(), appFlow.listKitchenStations);
router.post('/:restaurantId/kitchen/stations', requireRestaurantAccess(), appFlow.upsertKitchenStation);
router.post('/:restaurantId/kitchen/station-routes', requireRestaurantAccess(), appFlow.routeMenuItemToStation);
router.post('/:restaurantId/kitchen/devices/:deviceId/feed-ack', requireRestaurantAccess(), appFlow.ackKitchenFeed);
router.post('/:restaurantId/kitchen/feed/ack', requireRestaurantAccess(), appFlow.ackKitchenFeed);
router.get('/:restaurantId/kitchen/events', requireRestaurantAccess(), appFlow.listKitchenEvents);
router.get('/:restaurantId/kitchen/audit-events', requireRestaurantAccess(), appFlow.listKitchenAuditEvents);
router.post('/:restaurantId/kitchen/events', requireRestaurantAccess(), appFlow.recordKitchenEvent);
router.post('/:restaurantId/kitchen/tickets/:orderId/ack', requireRestaurantAccess(), appFlow.ackKitchenTicket);
router.get('/:restaurantId/kitchen/printer-jobs', requireRestaurantAccess(), appFlow.listPrinterJobs);
router.post('/:restaurantId/kitchen/printer-jobs', requireRestaurantAccess(), appFlow.createPrinterJob);
router.post('/:restaurantId/kitchen/printer-jobs/:jobId/claim', requireRestaurantAccess(), appFlow.claimPrinterJob);
router.patch('/:restaurantId/kitchen/printer-jobs/:jobId', requireRestaurantAccess(), appFlow.updatePrinterJob);

// Runner / delivery operations (App 8)
router.get('/:restaurantId/runner/dashboard', requireRestaurantAccess(), runner.getDashboard);
router.get('/:restaurantId/runner/offers', requireRestaurantAccess(), appFlow.listRunnerOffers);
router.post('/:restaurantId/runner/tasks', requireRestaurantAccess(), runner.createTask);
router.post('/:restaurantId/runner/contact-rules', requireRestaurantAccess(), runner.createContactRule);
router.patch('/:restaurantId/runner/tasks/:taskId/dispatch', requireRestaurantAccess(), appFlow.updateRunnerDispatch);
router.post('/:restaurantId/runner/tasks/:taskId/assign', requireRestaurantAccess(), appFlow.updateRunnerDispatch);
router.post('/:restaurantId/runner/tasks/:taskId/claim', requireRestaurantAccess(), appFlow.claimRunnerTask);
router.post('/:restaurantId/runner/tasks/:taskId/decline', requireRestaurantAccess(), appFlow.declineRunnerTask);
router.post('/:restaurantId/runner/tasks/:taskId/handoff', rejectImpersonated, requireRestaurantAccess(), appFlow.completeRunnerHandoff);
// P2-4-F05: the handoff endpoint is intentionally API-only. The web runner
// page completes tasks via PATCH .../tasks/:taskId/status + POST .../proofs
// (same transition map, same proof allowlist, same order-completion
// side effects). This one-shot variant is retained for native and
// integration clients that need task completion, proof capture, and linked
// order completion in a single call.
router.post('/:restaurantId/runner/tasks/:taskId/location', requireRestaurantAccess(), appFlow.logRunnerLocation);
router.post('/:restaurantId/runner/tasks/:taskId/settlements', rejectImpersonated, requireRestaurantAccess(), appFlow.upsertRunnerSettlement);
router.post('/:restaurantId/runner/location', requireRestaurantAccess(), appFlow.logRunnerLocation);
router.get('/:restaurantId/runner/settlements', requireRestaurantAccess(), appFlow.listRunnerSettlements);
// P2-4-F05: the non-task-scoped settlement POST is intentionally API-only.
// The web runner page creates and mutates settlements through the
// task-scoped POST .../tasks/:taskId/settlements (TaskCard + SettlementsSection
// in RestaurantRunnerPage.jsx); this variant serves API/integration clients.
router.post('/:restaurantId/runner/settlements', rejectImpersonated, requireRestaurantAccess(), appFlow.upsertRunnerSettlement);
router.patch('/:restaurantId/runner/tasks/:taskId/status', requireRestaurantAccess(), runner.updateTaskStatus);
router.post('/:restaurantId/runner/tasks/:taskId/proofs', requireRestaurantAccess(), runner.logProof);
router.post('/:restaurantId/runner/tasks/:taskId/issues', requireRestaurantAccess(), runner.reportIssue);
router.post('/:restaurantId/runner/tasks/:taskId/payment-notes', rejectImpersonated, requireRestaurantAccess(), runner.logPaymentNote);

module.exports = router;
