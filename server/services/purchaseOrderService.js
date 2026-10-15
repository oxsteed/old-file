'use strict';
const pool = require('../db');
require('./logisticsTransitionGuards').registerLogisticsGuards();
const crypto = require('crypto');
const { logLogisticsAction } = require('./logisticsAuditService');
const { calculateLandedCost } = require('./logisticsPricingService');

const { purchaseOrder: poMachine, PO_TRANSITIONS, applyTransition } = require('./logisticsStateMachine');

// Canonical transition graph lives in logisticsStateMachine.js (and is
// mirrored by DB migration 605's purchase_order_state_integrity_guard
// trigger). These aliases stay for backward compatibility with any
// importers of the old local names.
const VALID_TRANSITIONS = PO_TRANSITIONS;
const canTransition = poMachine.canTransition;

async function generatePORef() {
  const year = new Date().getFullYear();
  return `PO-${year}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

async function createPurchaseOrder(data, actorUserId) {
  const ref = await generatePORef();
  const {
    sourcing_request_id, pooled_order_id, supplier_id, supplier_product_id,
    supplier_quote_id, lane_id, buyer_user_id, buyer_business_id,
    qty_ordered, unit_cost_usd, freight_option, incoterms, payment_terms,
    production_notes, shipping_notes, expected_production_complete,
    expected_ship_date, expected_arrival_date, destination_country,
    destination_address, assigned_coordinator, notes, internal_notes,
  } = data;

  const pricing = await calculateLandedCost({
    unitProductCostUSD: unit_cost_usd,
    qty: qty_ordered,
    laneId: lane_id,
    freightEstUSD: data.freight_est_usd,
    isPooled: !!pooled_order_id,
  });
  const uc = pricing.unitCost;
  const q = qty_ordered;

  const result = await pool.query(
    `INSERT INTO purchase_orders
       (reference,sourcing_request_id,pooled_order_id,supplier_id,supplier_product_id,
        supplier_quote_id,lane_id,buyer_user_id,buyer_business_id,
        qty_ordered,unit_cost_usd,total_product_usd,
        origin_handling_usd,sourcing_fee_usd,oxsteed_markup_usd,freight_est_usd,
        customs_admin_usd,warehouse_fee_usd,last_mile_usd,risk_surcharge_usd,total_landed_usd,
        deposit_due_usd,final_due_usd,freight_option,incoterms,payment_terms,
        production_notes,shipping_notes,expected_production_complete,
        expected_ship_date,expected_arrival_date,destination_country,destination_address,
        assigned_coordinator,notes,internal_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)
     RETURNING *`,
    [
      ref,sourcing_request_id,pooled_order_id,supplier_id,supplier_product_id,
      supplier_quote_id,lane_id,buyer_user_id,buyer_business_id,
      q, unit_cost_usd, pricing.totals.product,
      uc.originHandling*q, uc.sourcingFee*q, uc.markup*q, uc.freight*q,
      uc.customsAdmin*q, uc.warehouse*q, uc.lastMile*q, uc.riskSurcharge*q,
      pricing.totals.landed,
      pricing.totals.landed * 0.30, // deposit 30%
      pricing.totals.landed * 0.70, // final 70%
      freight_option, incoterms, payment_terms,
      production_notes, shipping_notes, expected_production_complete,
      expected_ship_date, expected_arrival_date, destination_country, destination_address,
      assigned_coordinator, notes, internal_notes,
    ]
  );
  const po = result.rows[0];
  logLogisticsAction('purchase_order', po.id, 'created', { actorUserId });
  return po;
}

async function getPurchaseOrder(id) {
  const result = await pool.query(
    `SELECT po.*,
            ll.name AS lane_name, ll.origin_country, ll.destination_country,
            s.company_name AS supplier_name, s.country AS supplier_country,
            s.contact_name AS supplier_contact, s.contact_email AS supplier_email,
            sp.title AS product_title, sp.category, sp.internal_sku,
            u.first_name || ' ' || u.last_name AS buyer_name,
            b.business_name
     FROM purchase_orders po
     LEFT JOIN logistics_lanes ll ON ll.id = po.lane_id
     LEFT JOIN supplier_profiles s ON s.id = po.supplier_id
     LEFT JOIN supplier_products sp ON sp.id = po.supplier_product_id
     LEFT JOIN users u ON u.id = po.buyer_user_id
     LEFT JOIN businesses b ON b.id = po.buyer_business_id
     WHERE po.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function listPurchaseOrders({
  status, laneId, supplierId, buyerUserId, assignedCoordinator,
  limit = 50, offset = 0
} = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (status)             { conditions.push(`po.status = $${params.push(status)}`); }
  if (laneId)             { conditions.push(`po.lane_id = $${params.push(laneId)}`); }
  if (supplierId)         { conditions.push(`po.supplier_id = $${params.push(supplierId)}`); }
  if (buyerUserId)        { conditions.push(`po.buyer_user_id = $${params.push(buyerUserId)}`); }
  if (assignedCoordinator){ conditions.push(`po.assigned_coordinator = $${params.push(assignedCoordinator)}`); }

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM purchase_orders po WHERE ${conditions.join(' AND ')}`, params
  );
  const rows = await pool.query(
    `SELECT po.reference,po.id,po.status,po.qty_ordered,po.total_landed_usd,
            po.expected_arrival_date,po.created_at,po.deposit_paid_usd,
            s.company_name AS supplier_name, ll.name AS lane_name,
            ll.origin_country, ll.destination_country,
            sp.title AS product_title
     FROM purchase_orders po
     LEFT JOIN supplier_profiles s ON s.id = po.supplier_id
     LEFT JOIN logistics_lanes ll ON ll.id = po.lane_id
     LEFT JOIN supplier_products sp ON sp.id = po.supplier_product_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY po.created_at DESC
     LIMIT $${params.push(Math.min(limit,200))} OFFSET $${params.push(offset)}`,
    params
  );
  return { orders: rows.rows, total: parseInt(countRes.rows[0].count) };
}

async function transitionStatus(id, toStatus, actorUserId, { notes, approvedBy } = {}) {
  // Transactional: the current status is re-read with FOR UPDATE inside the
  // state machine's transaction, so two concurrent transitions cannot both
  // pass validation against the same stale status.
  const set = {};
  const nowColumns = [];
  if (toStatus === 'approved' && approvedBy) {
    set.approved_by = approvedBy;
    nowColumns.push('approved_at');
  }
  if (toStatus === 'placed_with_supplier') nowColumns.push('placed_with_supplier_at');

  const result = await applyTransition(pool, {
    entityType: 'purchase_order',
    id,
    to: toStatus,
    actorUserId,
    set,
    nowColumns,
    appendNotes: notes ? { column: 'internal_notes', text: `\n${notes}` } : null,
  });
  if (!result.ok) {
    if(result.blocker) throw Object.assign(new Error(result.blocker.message),{statusCode:409,code:result.blocker.code});
    if (result.reason === 'not_found') throw new Error('purchase_order_not_found');
    if (result.reason === 'unknown_entity_type' || result.reason === 'missing_target_status') {
      throw Object.assign(new Error('invalid_target_status'), { code: 'invalid_transition' });
    }
    throw Object.assign(
      new Error(`Cannot transition from ${result.from} to ${result.to}`),
      { code: 'invalid_transition' }
    );
  }

  logLogisticsAction('purchase_order', id, `status_to_${toStatus}`, {
    actorUserId,
    beforeState: { status: result.from },
    afterState: { status: result.to },
    notes,
  });
  return result.record;
}

module.exports = {
  createPurchaseOrder, getPurchaseOrder, listPurchaseOrders,
  transitionStatus, canTransition, VALID_TRANSITIONS,
};
