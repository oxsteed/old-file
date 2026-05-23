'use strict';
/**
 * OxSteed Logistics — admin router
 * Mounted at /api/admin/logistics in server/index.js
 * All routes require requireAdmin middleware (wired at mount point).
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

router.use((req, _res, next) => {
  req.isAdmin = true;
  req.isSuperAdmin = req.user?.role === 'super_admin';
  next();
});

// ─── Dashboard ───────────────────────────────────────────────

router.get('/stats', adminCtrl.getStats);

// ─── Lanes ───────────────────────────────────────────────────

router.post('/lanes',            lanesCtrl.createLane);
router.put('/lanes/:id',         lanesCtrl.updateLane);
router.post('/trade-rules',      lanesCtrl.createTradeRule);

// ─── Country Access Rules ─────────────────────────────────────

router.get('/restrictions',          adminCtrl.listCountryAccessRules);
router.put('/restrictions',          adminCtrl.upsertCountryAccessRule);

// ─── Suppliers ────────────────────────────────────────────────

router.get('/suppliers',             adminCtrl.listSuppliers);
router.get('/suppliers/:id',         adminCtrl.getSupplier);
router.post('/suppliers',            adminCtrl.createSupplier);
router.put('/suppliers/:id',         adminCtrl.updateSupplier);
router.post('/suppliers/:id/approve',adminCtrl.approveSupplier);
router.post('/suppliers/products',   adminCtrl.createSupplierProduct);
router.post('/suppliers/:id/products/:productId/approve', adminCtrl.approveProduct);

// ─── Quotes ───────────────────────────────────────────────────

router.get('/quotes',                               adminCtrl.listQuotes);
router.post('/requests/:requestId/quotes',          sourcingCtrl.createQuote);
router.patch('/quotes/:quoteId/review',             sourcingCtrl.reviewQuote);
router.patch('/requests/:id/assign-operator',       sourcingCtrl.assignOperator);
router.patch('/requests/:id/status',                sourcingCtrl.updateStatus);

// ─── Purchase Orders ─────────────────────────────────────────

router.get('/purchase-orders',               poCtrl.listPurchaseOrders);
router.get('/purchase-orders/:id',           poCtrl.getPurchaseOrder);
router.post('/purchase-orders',              poCtrl.createPurchaseOrder);
router.patch('/purchase-orders/:id/status',  poCtrl.transitionStatus);
router.post('/pricing/preview',              poCtrl.previewLandedCost);

// ─── Campaigns / Pooled Orders ────────────────────────────────

router.get('/campaigns',                     pooledCtrl.listPooledOrders);
router.get('/campaigns/:id',                 pooledCtrl.getPooledOrder);
router.post('/campaigns',                    pooledCtrl.createPooledOrder);
router.patch('/campaigns/:id/status',        pooledCtrl.updateStatus);
router.get('/pending-organizer-approvals',   adminCtrl.listPendingOrganizerApprovals);

// ─── Shipments ────────────────────────────────────────────────

router.get('/shipments',                     shipCtrl.listShipments);
router.get('/shipments/:id',                 shipCtrl.getShipment);
router.post('/shipments',                    shipCtrl.createShipment);
router.post('/shipments/:id/milestone',      shipCtrl.addMilestone);
router.patch('/shipments/:id/tracking',      shipCtrl.updateTracking);
router.post('/shipments/:id/documents', upload.single('file'), shipCtrl.uploadDocument);

// ─── Warehouses ───────────────────────────────────────────────

router.get('/warehouses',                    whCtrl.listWarehouses);
router.post('/warehouses',                   whCtrl.createWarehouse);
router.get('/inventory-receipts',            whCtrl.listReceipts);
router.post('/inventory-receipts',           whCtrl.createReceipt);
router.post('/inventory-receipts/:id/receive',   whCtrl.receiveInventory);
router.post('/inventory-receipts/:id/reconcile', whCtrl.reconcileReceipt);

// ─── Allocations & Delivery ────────────────────────────────────

router.get('/allocations',                   whCtrl.listAllocations);
router.post('/allocations',                  whCtrl.createAllocation);
router.post('/allocations/:id/release',      whCtrl.releaseAllocation);
router.get('/deliveries',                    whCtrl.listDeliveryOrders);
router.post('/deliveries',                   whCtrl.createDeliveryOrder);

// ─── Claims & Disputes ────────────────────────────────────────

router.get('/claims',                        adminCtrl.listClaims);
router.patch('/claims/:id',                  adminCtrl.updateClaim);
router.get('/refund-cases',                  adminCtrl.listRefundCases);
router.patch('/refund-cases/:id',            adminCtrl.updateRefundCase);

// ─── Markup / Fee Rules (super-admin) ────────────────────────

router.get('/markup-rules',                  adminCtrl.listMarkupRules);
router.post('/markup-rules',                 adminCtrl.createMarkupRule);
router.put('/markup-rules/:id',              adminCtrl.updateMarkupRule);
router.get('/fee-rules',                     adminCtrl.listFeeRules);
router.put('/fee-rules/:id',                 adminCtrl.updateFeeRule);

// ─── Compliance + Finance (admin) ─────────────────────────────

const complianceCtrl = require('../controllers/logisticsComplianceController');
const financeCtrl    = require('../controllers/logisticsFinanceController');
router.get('/compliance/review-queue',       complianceCtrl.listReviewQueue);
router.post('/compliance/approve-po/:id',    complianceCtrl.approveRestrictedPO);
router.get('/finance/profitability',         financeCtrl.getProfitabilitySummary);
router.get('/finance/po/:id/breakdown',      financeCtrl.getPoLandedCostBreakdown);

// ─── Audit ────────────────────────────────────────────────────

router.get('/audit',                         adminCtrl.getAudit);

module.exports = router;
