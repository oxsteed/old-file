'use strict';
/**
 * OxSteed Logistics — main router
 * Mounted at /api/logistics in server/index.js
 */
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const lanesCtrl     = require('../controllers/logisticsLanesController');
const sourcingCtrl  = require('../controllers/logisticsSourcingController');
const pooledCtrl    = require('../controllers/logisticsPooledOrdersController');
const poCtrl        = require('../controllers/logisticsPurchaseOrdersController');
const shipCtrl      = require('../controllers/logisticsShipmentsController');
const whCtrl        = require('../controllers/logisticsWarehouseController');
const recurringCtrl = require('../controllers/logisticsRecurringProcurementController');
const complianceCtrl= require('../controllers/logisticsComplianceController');
const financeCtrl   = require('../controllers/logisticsFinanceController');
const { requireLogisticsRole, requireLaneAccess } = require('../middleware/requireLogisticsAccess');

// ─── Lanes (public read, admin write) ────────────────────────

router.get('/lanes',                   lanesCtrl.listLanes);
router.get('/lanes/:id',               lanesCtrl.getLane);
router.get('/lanes/:id/access-check',  lanesCtrl.checkAccess);
router.get('/trade-rules',             lanesCtrl.listTradeRules);

// ─── Supplier Products (public catalog) ──────────────────────

router.get('/suppliers',               sourcingCtrl.listSuppliers);
router.get('/products/:id',            sourcingCtrl.getSupplierProduct);

// ─── Sourcing Requests ────────────────────────────────────────

router.post('/requests',               requireAuth, sourcingCtrl.createRequest);
router.get('/requests',                requireAuth, sourcingCtrl.listRequests);
router.get('/requests/:id',            requireAuth, sourcingCtrl.getRequest);
router.patch('/requests/:id/status',   requireAuth, sourcingCtrl.updateStatus);

// Quotes (operator / admin posts quotes against a request)
router.post('/requests/:requestId/quotes', requireAuth, sourcingCtrl.createQuote);

// ─── Pooled Orders (campaigns) ───────────────────────────────

router.get('/campaigns',               pooledCtrl.listPooledOrders);
router.get('/campaigns/:id',           pooledCtrl.getPooledOrder);
router.post('/campaigns',              requireAuth, pooledCtrl.createPooledOrder);
router.post('/campaigns/:id/join',     requireAuth, pooledCtrl.joinPooledOrder);
router.get('/my-participation',        requireAuth, pooledCtrl.getMyParticipation);

// ─── Recurring Procurement Programs ──────────────────────────

router.get('/recurring-programs',               requireAuth, recurringCtrl.listPrograms);
router.get('/recurring-programs/:id',           requireAuth, recurringCtrl.getProgram);
router.post('/recurring-programs',              requireAuth, recurringCtrl.createProgram);
router.patch('/recurring-programs/:id',         requireAuth, recurringCtrl.updateProgram);
router.patch('/recurring-programs/:id/status',  requireAuth, recurringCtrl.updateProgramStatus);

// ─── Purchase Orders ──────────────────────────────────────────

router.get('/orders',                  requireAuth, poCtrl.listPurchaseOrders);
router.get('/orders/:id',              requireAuth, poCtrl.getPurchaseOrder);
router.post('/orders',                 requireAuth, poCtrl.createPurchaseOrder);
router.patch('/orders/:id/status',     requireAuth, poCtrl.transitionStatus);
router.post('/pricing/preview',        requireAuth, poCtrl.previewLandedCost);

// ─── Shipments ────────────────────────────────────────────────

router.get('/shipments',                requireAuth, shipCtrl.listShipments);
router.get('/shipments/:id',            requireAuth, shipCtrl.getShipment);
router.post('/shipments',               requireAuth, shipCtrl.createShipment);
router.post('/shipments/:id/milestone', requireAuth, shipCtrl.addMilestone);
router.patch('/shipments/:id/tracking', requireAuth, shipCtrl.updateTracking);
router.post('/shipments/:id/documents', requireAuth, upload.single('file'), shipCtrl.uploadDocument);

// ─── Warehouses / Receiving / Allocations / Delivery ─────────

router.get('/warehouses',                     requireAuth, whCtrl.listWarehouses);
router.get('/inventory-receipts',             requireAuth, whCtrl.listReceipts);
router.post('/inventory-receipts',            requireAuth, whCtrl.createReceipt);
router.post('/inventory-receipts/:id/receive',requireAuth, whCtrl.receiveInventory);
router.post('/inventory-receipts/:id/reconcile', requireAuth, whCtrl.reconcileReceipt);
router.get('/allocations',                    requireAuth, whCtrl.listAllocations);
router.post('/allocations',                   requireAuth, whCtrl.createAllocation);
router.post('/allocations/:id/release',       requireAuth, whCtrl.releaseAllocation);
router.get('/deliveries',                     requireAuth, whCtrl.listDeliveryOrders);
router.post('/deliveries',                    requireAuth, whCtrl.createDeliveryOrder);

// ─── Claims ───────────────────────────────────────────────────

router.post('/claims', requireAuth, async (req, res, next) => {
  try {
    const pool = require('../db');
    const { claim_type, description, purchase_order_id, shipment_id, pooled_order_id, claimed_amount_usd } = req.body;
    if (!claim_type || !description) {
      return next(require('../utils/AppError')('claim_type and description required', 400, 'validation_failed'));
    }
    const year = new Date().getFullYear();
    const countRes = await pool.query('SELECT COUNT(*) FROM logistics_claims');
    const seq = String(parseInt(countRes.rows[0].count) + 1).padStart(5, '0');
    const reference = `CLM-${year}-${seq}`;
    const result = await pool.query(
      `INSERT INTO logistics_claims (reference,claim_type,purchase_order_id,shipment_id,pooled_order_id,claimant_user_id,description,claimed_amount_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [reference,claim_type,purchase_order_id,shipment_id,pooled_order_id,req.user.id,description,claimed_amount_usd]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

router.get('/claims', requireAuth, async (req, res, next) => {
  try {
    const pool = require('../db');
    const result = await pool.query(
      `SELECT * FROM logistics_claims WHERE claimant_user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

router.post('/refund-cases', requireAuth, async (req, res, next) => {
  try {
    const pool = require('../db');
    const { claim_id, purchase_order_id, pooled_order_id, participant_id, refund_reason, requested_amount_usd, notes } = req.body;
    if (!refund_reason || !requested_amount_usd) {
      return next(new (require('../utils/AppError'))('refund_reason and requested_amount_usd required', 400, 'validation_failed'));
    }
    const year = new Date().getFullYear();
    const countRes = await pool.query('SELECT COUNT(*) FROM logistics_refund_cases');
    const seq = String(parseInt(countRes.rows[0].count, 10) + 1).padStart(5, '0');
    const reference = `RFC-${year}-${seq}`;
    const result = await pool.query(
      `INSERT INTO logistics_refund_cases
         (reference,claim_id,purchase_order_id,pooled_order_id,participant_id,user_id,refund_reason,requested_amount_usd,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [reference, claim_id, purchase_order_id, pooled_order_id, participant_id, req.user.id, refund_reason, requested_amount_usd, notes]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// ─── Compliance / Restrictions ───────────────────────────────

router.get('/compliance/access',        requireAuth, complianceCtrl.evaluateAccess);
router.get('/compliance/restrictions',  requireAuth, complianceCtrl.getRestrictionsForUser);
router.get('/compliance/review-queue',  requireAuth, complianceCtrl.listReviewQueue);
router.post('/compliance/approve-po/:id', requireAuth, complianceCtrl.approveRestrictedPO);
router.get('/compliance/shipments/:id/docs', requireAuth, complianceCtrl.getShipmentDocChecklist);

// ─── Finance / Profitability ─────────────────────────────────

router.get('/finance/my-schedule',         requireAuth, financeCtrl.getMyPaymentSchedule);
router.get('/finance/po/:id/breakdown',    requireAuth, financeCtrl.getPoLandedCostBreakdown);
router.get('/finance/profitability',       requireAuth, financeCtrl.getProfitabilitySummary);

router.get('/refund-cases', requireAuth, async (req, res, next) => {
  try {
    const pool = require('../db');
    const result = await pool.query(
      `SELECT rc.*, c.reference AS claim_reference
       FROM logistics_refund_cases rc
       LEFT JOIN logistics_claims c ON c.id = rc.claim_id
       WHERE rc.user_id = $1
       ORDER BY rc.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
