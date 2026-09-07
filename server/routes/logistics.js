'use strict';
/**
 * OxSteed Logistics — main router
 * Mounted at /api/logistics in server/index.js
 */
const router = require('express').Router();
const crypto = require('crypto');
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
const requireWarehouseOps = requireLogisticsRole('warehouse_operator', 'logistics_coordinator');

function publicReference(prefix) {
  return `${prefix}-${new Date().getFullYear()}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

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
router.get('/inventory-receipts',             requireAuth, requireWarehouseOps, whCtrl.listReceipts);
router.post('/inventory-receipts',            requireAuth, requireWarehouseOps, whCtrl.createReceipt);
router.post('/inventory-receipts/:id/receive',requireAuth, requireWarehouseOps, whCtrl.receiveInventory);
router.post('/inventory-receipts/:id/reconcile', requireAuth, requireWarehouseOps, whCtrl.reconcileReceipt);
router.get('/allocations',                    requireAuth, requireWarehouseOps, whCtrl.listAllocations);
router.post('/allocations',                   requireAuth, requireWarehouseOps, whCtrl.createAllocation);
router.post('/allocations/:id/release',       requireAuth, requireWarehouseOps, whCtrl.releaseAllocation);
router.get('/deliveries',                     requireAuth, requireWarehouseOps, whCtrl.listDeliveryOrders);
router.post('/deliveries',                    requireAuth, requireWarehouseOps, whCtrl.createDeliveryOrder);

// ─── Claims ───────────────────────────────────────────────────

router.post('/claims', requireAuth, async (req, res, next) => {
  try {
    const pool = require('../db');
    const { claim_type, description, purchase_order_id, shipment_id, pooled_order_id, claimed_amount_usd } = req.body;
    if (!claim_type || !description) {
      return next(new (require('../utils/appError'))('claim_type and description required', 400, 'validation_failed'));
    }
    const reference = publicReference('CLM');
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
    const referenceIds = [claim_id, purchase_order_id, pooled_order_id, participant_id].filter(
      value => value !== undefined && value !== null && String(value).trim() !== ''
    );
    const amount = Number(requested_amount_usd);
    if (!refund_reason || !referenceIds.length || !Number.isFinite(amount) || amount <= 0) {
      return next(new (require('../utils/appError'))('refund_reason and requested_amount_usd required', 400, 'validation_failed'));
    }

    // A refund case must be tied to an object the requester can actually access.
    if (claim_id !== undefined && claim_id !== null) {
      const result = await pool.query(
        'SELECT 1 FROM logistics_claims WHERE id = $1 AND claimant_user_id = $2',
        [claim_id, req.user.id]
      );
      if (!result.rows.length) return next(new (require('../utils/appError'))('Claim not found', 404, 'not_found'));
    }
    if (purchase_order_id !== undefined && purchase_order_id !== null) {
      const result = await pool.query(
        `SELECT 1 FROM purchase_orders po
         WHERE po.id = $1 AND (po.buyer_user_id = $2 OR EXISTS (
           SELECT 1 FROM pooled_order_participants pp
           WHERE pp.pooled_order_id = po.pooled_order_id AND pp.user_id = $2
         ))`,
        [purchase_order_id, req.user.id]
      );
      if (!result.rows.length) return next(new (require('../utils/appError'))('Purchase order not found', 404, 'not_found'));
    }
    if (pooled_order_id !== undefined && pooled_order_id !== null) {
      const result = await pool.query(
        `SELECT 1 FROM pooled_orders po
         WHERE po.id = $1 AND (po.organizer_user_id = $2 OR EXISTS (
           SELECT 1 FROM pooled_order_participants pp
           WHERE pp.pooled_order_id = po.id AND pp.user_id = $2
         ))`,
        [pooled_order_id, req.user.id]
      );
      if (!result.rows.length) return next(new (require('../utils/appError'))('Pooled order not found', 404, 'not_found'));
    }
    if (participant_id !== undefined && participant_id !== null) {
      const result = await pool.query(
        'SELECT 1 FROM pooled_order_participants WHERE id = $1 AND user_id = $2',
        [participant_id, req.user.id]
      );
      if (!result.rows.length) return next(new (require('../utils/appError'))('Participation not found', 404, 'not_found'));
    }
    const reference = publicReference('RFC');
    const result = await pool.query(
      `INSERT INTO logistics_refund_cases
         (reference,claim_id,purchase_order_id,pooled_order_id,participant_id,user_id,refund_reason,requested_amount_usd,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [reference, claim_id, purchase_order_id, pooled_order_id, participant_id, req.user.id, refund_reason, amount, notes]
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
