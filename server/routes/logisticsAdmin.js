'use strict';
/**
 * OxSteed Logistics — admin router
 * Mounted at /api/admin/logistics in server/index.js
 * Mounted behind authenticate. Per-route middleware decides whether a request
 * needs admin RBAC or an internal Operations / Compliance workspace session.
 */
const router = require('express').Router();
const adminCtrl  = require('../controllers/logisticsAdminController');
const lanesCtrl  = require('../controllers/logisticsLanesController');
const shipCtrl   = require('../controllers/logisticsShipmentsController');
const poCtrl     = require('../controllers/logisticsPurchaseOrdersController');
const pooledCtrl = require('../controllers/logisticsPooledOrdersController');
const whCtrl     = require('../controllers/logisticsWarehouseController');
const sourcingCtrl = require('../controllers/logisticsSourcingController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const { requireInternalLogisticsWorkspace } = require('../middleware/requireInternalLogisticsWorkspace');
const { requireRole } = require('../middleware/auth');

const requireOperationsWorkspace = requireInternalLogisticsWorkspace('operations');
const requireComplianceWorkspace = requireInternalLogisticsWorkspace('compliance');
const requireAdminRole = requireRole('admin', 'super_admin');

router.use((req, _res, next) => {
  req.isAdmin = true;
  req.isSuperAdmin = req.user?.role === 'super_admin';
  next();
});

// ─── Dashboard ───────────────────────────────────────────────

router.get('/stats', requireOperationsWorkspace, adminCtrl.getStats);

// ─── Lanes ───────────────────────────────────────────────────

router.post('/lanes',            requireAdminRole, lanesCtrl.createLane);
router.put('/lanes/:id',         requireAdminRole, lanesCtrl.updateLane);
router.post('/trade-rules',      requireAdminRole, lanesCtrl.createTradeRule);

// ─── Country Access Rules ─────────────────────────────────────

router.get('/restrictions',          requireComplianceWorkspace, adminCtrl.listCountryAccessRules);
router.put('/restrictions',          requireComplianceWorkspace, adminCtrl.upsertCountryAccessRule);

// ─── Suppliers ────────────────────────────────────────────────

router.get('/suppliers',             requireAdminRole, adminCtrl.listSuppliers);
router.get('/suppliers/:id',         requireAdminRole, adminCtrl.getSupplier);
router.post('/suppliers',            requireAdminRole, adminCtrl.createSupplier);
router.put('/suppliers/:id',         requireAdminRole, adminCtrl.updateSupplier);
router.post('/suppliers/:id/approve',requireAdminRole, adminCtrl.approveSupplier);
router.post('/suppliers/products',   requireAdminRole, adminCtrl.createSupplierProduct);
router.post('/suppliers/:id/products/:productId/approve', requireAdminRole, adminCtrl.approveProduct);

// ─── Quotes ───────────────────────────────────────────────────

router.get('/quotes',                               requireOperationsWorkspace, adminCtrl.listQuotes);
router.post('/requests/:requestId/quotes',          requireOperationsWorkspace, sourcingCtrl.createQuote);
router.patch('/quotes/:quoteId/review',             requireOperationsWorkspace, sourcingCtrl.reviewQuote);
router.patch('/requests/:id/assign-operator',       requireOperationsWorkspace, sourcingCtrl.assignOperator);
router.patch('/requests/:id/status',                requireOperationsWorkspace, sourcingCtrl.updateStatus);

// ─── Purchase Orders ─────────────────────────────────────────

router.get('/purchase-orders',               requireAdminRole, poCtrl.listPurchaseOrders);
router.get('/purchase-orders/:id',           requireAdminRole, poCtrl.getPurchaseOrder);
router.post('/purchase-orders',              requireAdminRole, poCtrl.createPurchaseOrder);
router.patch('/purchase-orders/:id/status',  requireAdminRole, poCtrl.transitionStatus);
router.post('/pricing/preview',              requireAdminRole, poCtrl.previewLandedCost);

// ─── Campaigns / Pooled Orders ────────────────────────────────

router.get('/campaigns',                     requireOperationsWorkspace, pooledCtrl.listPooledOrders);
router.get('/campaigns/:id',                 requireOperationsWorkspace, pooledCtrl.getPooledOrder);
router.post('/campaigns',                    requireOperationsWorkspace, pooledCtrl.createPooledOrder);
router.patch('/campaigns/:id/status',        requireOperationsWorkspace, pooledCtrl.updateStatus);
router.get('/pending-organizer-approvals',   requireOperationsWorkspace, adminCtrl.listPendingOrganizerApprovals);

// ─── Shipments ────────────────────────────────────────────────

router.get('/shipments',                     requireOperationsWorkspace, shipCtrl.listShipments);
router.get('/shipments/:id',                 requireOperationsWorkspace, shipCtrl.getShipment);
router.post('/shipments',                    requireOperationsWorkspace, shipCtrl.createShipment);
router.post('/shipments/:id/milestone',      requireOperationsWorkspace, shipCtrl.addMilestone);
router.patch('/shipments/:id/tracking',      requireOperationsWorkspace, shipCtrl.updateTracking);
router.post('/shipments/:id/documents', requireOperationsWorkspace, upload.single('file'), shipCtrl.uploadDocument);

// ─── Warehouses ───────────────────────────────────────────────

router.get('/warehouses',                    requireOperationsWorkspace, whCtrl.listWarehouses);
router.post('/warehouses',                   requireOperationsWorkspace, whCtrl.createWarehouse);
router.get('/inventory-receipts',            requireOperationsWorkspace, whCtrl.listReceipts);
router.post('/inventory-receipts',           requireOperationsWorkspace, whCtrl.createReceipt);
router.post('/inventory-receipts/:id/receive',   requireOperationsWorkspace, whCtrl.receiveInventory);
router.post('/inventory-receipts/:id/reconcile', requireOperationsWorkspace, whCtrl.reconcileReceipt);

// ─── Allocations & Delivery ────────────────────────────────────

router.get('/allocations',                   requireOperationsWorkspace, whCtrl.listAllocations);
router.post('/allocations',                  requireOperationsWorkspace, whCtrl.createAllocation);
router.post('/allocations/:id/release',      requireOperationsWorkspace, whCtrl.releaseAllocation);
router.get('/deliveries',                    requireOperationsWorkspace, whCtrl.listDeliveryOrders);
router.post('/deliveries',                   requireOperationsWorkspace, whCtrl.createDeliveryOrder);

// ─── Claims & Disputes ────────────────────────────────────────

router.get('/claims',                        requireOperationsWorkspace, adminCtrl.listClaims);
router.patch('/claims/:id',                  requireOperationsWorkspace, adminCtrl.updateClaim);
router.get('/refund-cases',                  requireOperationsWorkspace, adminCtrl.listRefundCases);
router.patch('/refund-cases/:id',            requireOperationsWorkspace, adminCtrl.updateRefundCase);

// ─── Markup / Fee Rules (super-admin) ────────────────────────

router.get('/markup-rules',                  requireAdminRole, adminCtrl.listMarkupRules);
router.post('/markup-rules',                 requireAdminRole, adminCtrl.createMarkupRule);
router.put('/markup-rules/:id',              requireAdminRole, adminCtrl.updateMarkupRule);
router.get('/fee-rules',                     requireAdminRole, adminCtrl.listFeeRules);
router.put('/fee-rules/:id',                 requireAdminRole, adminCtrl.updateFeeRule);

// ─── Compliance + Finance (admin) ─────────────────────────────

const complianceCtrl = require('../controllers/logisticsComplianceController');
const financeCtrl    = require('../controllers/logisticsFinanceController');
router.get('/compliance/review-queue',       requireComplianceWorkspace, complianceCtrl.listReviewQueue);
router.post('/compliance/approve-po/:id',    requireComplianceWorkspace, complianceCtrl.approveRestrictedPO);
router.get('/finance/profitability',         requireAdminRole, financeCtrl.getProfitabilitySummary);
router.get('/finance/po/:id/breakdown',      requireAdminRole, financeCtrl.getPoLandedCostBreakdown);

// ─── Audit ────────────────────────────────────────────────────

router.get('/audit',                         requireOperationsWorkspace, adminCtrl.getAudit);

module.exports = router;
