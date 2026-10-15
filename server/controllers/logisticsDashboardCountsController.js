'use strict';
/**
 * OxSteed Logistics — dashboard count controllers.
 *
 * Lightweight authoritative counters for the workspace dashboards. The
 * customer dashboards previously derived headline metrics from `limit: N`
 * list responses, which undercounts as soon as a user has more rows than
 * the page size. Each scope mirrors the visibility rules of the
 * corresponding list endpoints (non-admins are scoped to their own
 * records; admins see the global picture unless they pass the same
 * user-filter query params the list endpoints accept), so the counts
 * always agree with what the lists would show unpaginated.
 *
 * Only aggregates are returned, never row data, and every count is
 * restricted to records the caller could already see in the matching
 * list (their own requests/orders/allocations/deliveries/claims, or the
 * shipment visibility rule from shipmentService).
 */
const pool = require('../db');
const AppError = require('../utils/appError');

const asInt = (value) => parseInt(value, 10) || 0;

const SCOPES = ['buyer', 'organizer', 'distributor', 'compliance'];

// Shipment visibility, mirroring shipmentService.listShipments({ userId }):
// admins see everything; everyone else sees shipments they coordinate,
// bought (via purchase order), organized, or participate in.
function shipmentVisibility(req) {
  if (req.isAdmin) return { clause: '1=1', params: [] };
  return {
    clause: `(sr.assigned_coordinator = $1
      OR EXISTS (SELECT 1 FROM purchase_orders po
                 WHERE po.id = sr.purchase_order_id
                   AND (po.buyer_user_id = $1 OR po.assigned_coordinator = $1))
      OR EXISTS (SELECT 1 FROM pooled_orders po
                 LEFT JOIN pooled_order_participants pp ON pp.pooled_order_id = po.id
                 WHERE po.id = sr.pooled_order_id
                   AND (po.organizer_user_id = $1 OR pp.user_id = $1)))`,
    params: [req.user.id],
  };
}

// Ownership scoping mirrors each list controller: admins may pass the same
// user-filter query params the list endpoints accept, otherwise they see
// the global picture; non-admins are always self-scoped.
function scopedUserWhere(req, column, param) {
  const scoped = req.isAdmin ? (req.query[param] || null) : req.user.id;
  return scoped
    ? { clause: `${column} = $1`, params: [scoped] }
    : { clause: '1=1', params: [] };
}

async function buyerDistributorCounts(req, counts) {
  const userId = req.user.id;

  // Sourcing requests (mirrors sourcingCtrl.listRequests).
  const rq = scopedUserWhere(req, 'user_id', 'user_id');
  const reqRows = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status NOT IN ('fulfilled', 'closed', 'cancelled')) AS active
     FROM sourcing_requests WHERE ${rq.clause}`,
    rq.params
  );
  counts.totalRequests = asInt(reqRows.rows[0].total);
  counts.activeRequests = asInt(reqRows.rows[0].active);

  // Purchase orders (mirrors poCtrl.listPurchaseOrders).
  const po = scopedUserWhere(req, 'buyer_user_id', 'buyer_user_id');
  const poRows = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'warehoused') AS warehoused
     FROM purchase_orders WHERE ${po.clause}`,
    po.params
  );
  counts.totalOrders = asInt(poRows.rows[0].total);
  counts.warehousedOrders = asInt(poRows.rows[0].warehoused);

  // Allocations (mirrors whCtrl.listAllocations).
  const al = scopedUserWhere(req, 'buyer_user_id', 'buyer_user_id');
  const alRows = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'released') AS released,
            COUNT(*) FILTER (WHERE status <> 'released') AS pending
     FROM inventory_allocations WHERE ${al.clause}`,
    al.params
  );
  counts.totalAllocations = asInt(alRows.rows[0].total);
  counts.releasedAllocations = asInt(alRows.rows[0].released);
  counts.pendingAllocations = asInt(alRows.rows[0].pending);

  // Deliveries (mirrors whCtrl.listDeliveryOrders).
  const dl = scopedUserWhere(req, 'recipient_user_id', 'recipient_user_id');
  const dlRows = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled,
            COUNT(*) FILTER (WHERE status = 'in_transit') AS in_transit,
            COUNT(*) FILTER (WHERE status IN ('failed', 'cancelled')) AS failed
     FROM delivery_orders WHERE ${dl.clause}`,
    dl.params
  );
  counts.totalDeliveries = asInt(dlRows.rows[0].total);
  counts.scheduledDeliveries = asInt(dlRows.rows[0].scheduled);
  counts.inTransitDeliveries = asInt(dlRows.rows[0].in_transit);
  counts.failedDeliveries = asInt(dlRows.rows[0].failed);

  // Shipments (mirrors shipCtrl.listShipments).
  const ship = shipmentVisibility(req);
  const shTotal = await pool.query(
    `SELECT COUNT(*) AS count FROM shipment_records sr WHERE ${ship.clause}`,
    ship.params
  );
  counts.totalShipments = asInt(shTotal.rows[0].count);
  const shRisk = await pool.query(
    `SELECT COUNT(*) AS count FROM shipment_records sr
     WHERE ${ship.clause} AND sr.status IN ('customs_review', 'exception', 'customs_hold')`,
    ship.params
  );
  counts.atRiskShipments = asInt(shRisk.rows[0].count);

  if (req.query.scope === 'buyer') {
    // Claims and refund cases (mirrors the inline /claims and /refund-cases
    // routes: always the caller's own).
    const clRows = await pool.query(
      'SELECT COUNT(*) AS count FROM logistics_claims WHERE claimant_user_id = $1',
      [userId]
    );
    counts.activeClaims = asInt(clRows.rows[0].count);
    const rcRows = await pool.query(
      'SELECT COUNT(*) AS count FROM logistics_refund_cases WHERE user_id = $1',
      [userId]
    );
    counts.refundCases = asInt(rcRows.rows[0].count);
  }
}

async function organizerCounts(req, counts) {
  const userId = req.user.id;

  // Organizer campaigns (mirrors pooledCtrl.listOrganizerCampaigns: always
  // the caller's own, including drafts).
  const cpRows = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status IN ('open', 'pledging', 'deposit_phase', 'locked', 'placed')) AS active,
            COUNT(*) FILTER (WHERE status = 'open'
              AND ROUND(current_committed_qty::numeric / NULLIF(target_moq, 0) * 100) < 50) AS needing_momentum,
            COALESCE(SUM(current_committed_qty), 0) AS committed_units
     FROM pooled_orders WHERE organizer_user_id = $1`,
    [userId]
  );
  counts.totalCampaigns = asInt(cpRows.rows[0].total);
  counts.activeCampaigns = asInt(cpRows.rows[0].active);
  counts.needingMomentum = asInt(cpRows.rows[0].needing_momentum);
  counts.committedUnits = asInt(cpRows.rows[0].committed_units);

  // The organizer's own live participations (mirrors getMyParticipation).
  const pcRows = await pool.query(
    `SELECT COUNT(*) AS count FROM pooled_order_participants
     WHERE user_id = $1 AND status <> 'fulfilled'`,
    [userId]
  );
  counts.openCommitments = asInt(pcRows.rows[0].count);

  // Deliveries moving toward the organizer's recipients.
  const hdRows = await pool.query(
    `SELECT COUNT(*) AS count FROM delivery_orders
     WHERE recipient_user_id = $1 AND status IN ('pending', 'scheduled', 'in_transit')`,
    [userId]
  );
  counts.handoffDeliveries = asInt(hdRows.rows[0].count);
  const tdRows = await pool.query(
    'SELECT COUNT(*) AS count FROM delivery_orders WHERE recipient_user_id = $1',
    [userId]
  );
  counts.totalDeliveries = asInt(tdRows.rows[0].count);

  // Shipments (mirrors shipCtrl.listShipments).
  const ship = shipmentVisibility(req);
  const shRows = await pool.query(
    `SELECT COUNT(*) AS count FROM shipment_records sr WHERE ${ship.clause}`,
    ship.params
  );
  counts.totalShipments = asInt(shRows.rows[0].count);
}

async function complianceCounts(req, counts) {
  // Review queue (mirrors the compliance workspace's use of
  // adminListShipments: shipments in review-relevant states, with the
  // caller's shipment visibility applied).
  const ship = shipmentVisibility(req);
  const rqRows = await pool.query(
    `SELECT COUNT(*) AS count FROM shipment_records sr
     WHERE ${ship.clause} AND sr.status IN ('arrived_destination', 'customs_hold', 'exception')`,
    ship.params
  );
  counts.reviewQueue = asInt(rqRows.rows[0].count);
}

exports.getDashboardCounts = async (req, res, next) => {
  try {
    const scope = req.query.scope;
    if (!SCOPES.includes(scope)) {
      return next(new AppError(
        `scope must be one of: ${SCOPES.join(', ')}`,
        400,
        'validation_failed'
      ));
    }
    const counts = {};
    if (scope === 'buyer' || scope === 'distributor') {
      await buyerDistributorCounts(req, counts);
    } else if (scope === 'organizer') {
      await organizerCounts(req, counts);
    } else if (scope === 'compliance') {
      await complianceCounts(req, counts);
    }
    res.json({ success: true, scope, counts });
  } catch (err) { next(err); }
};

exports.getWarehouseDashboardCounts = async (req, res, next) => {
  try {
    const [warehouses, receipts, allocations, deliveries] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM warehouses'),
      pool.query(`SELECT COUNT(*) AS total,
                         COUNT(*) FILTER (WHERE status <> 'reconciled') AS open
                  FROM inventory_receipts`),
      pool.query(`SELECT COUNT(*) AS total,
                         COUNT(*) FILTER (WHERE status <> 'released') AS pending
                  FROM inventory_allocations`),
      pool.query('SELECT COUNT(*) AS count FROM delivery_orders'),
    ]);
    res.json({
      success: true,
      counts: {
        totalWarehouses: asInt(warehouses.rows[0].count),
        totalReceipts: asInt(receipts.rows[0].total),
        openReceipts: asInt(receipts.rows[0].open),
        totalAllocations: asInt(allocations.rows[0].total),
        pendingAllocations: asInt(allocations.rows[0].pending),
        totalDeliveries: asInt(deliveries.rows[0].count),
      },
    });
  } catch (err) { next(err); }
};
