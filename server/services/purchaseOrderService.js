'use strict';
const pool = require('../db');
const { logLogisticsAction } = require('./logisticsAuditService');
const { calculateLandedCost } = require('./logisticsPricingService');

const VALID_TRANSITIONS = {
  draft:               ['quoted','cancelled'],
  quoted:              ['approved','draft','cancelled'],
  approved:            ['awaiting_deposit','cancelled'],
  awaiting_deposit:    ['deposit_collected','cancelled'],
  deposit_collected:   ['placed_with_supplier','cancelled'],
  placed_with_supplier:['in_production','cancelled'],
  in_production:       ['production_complete','cancelled'],
  production_complete: ['ready_for_pickup'],
  ready_for_pickup:    ['in_transit'],
  in_transit:          ['customs_review','cleared'],
  customs_review:      ['cleared','customs_review'],
  cleared:             ['warehoused'],
  warehoused:          ['allocated'],
  allocated:           ['fulfilled'],
  fulfilled:           ['closed'],
  closed:              [],
  cancelled:           [],
};

function canTransition(from, to) {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

async function generatePORef() {
  const year = new Date().getFullYear();
  const res = await pool.query(`SELECT COUNT(*) FROM purchase_orders`);
  const seq = String(parseInt(res.rows[0].count) + 1).padStart(5, '0');
  return `PO-${year}-${seq}`;
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
  const before = await pool.query('SELECT status FROM purchase_orders WHERE id = $1', [id]);
  const fromStatus = before.rows[0]?.status;
  if (!fromStatus) throw new Error('purchase_order_not_found');
  if (!canTransition(fromStatus, toStatus)) {
    throw Object.assign(new Error(`Cannot transition from ${fromStatus} to ${toStatus}`), { code: 'invalid_transition' });
  }

  const extra = {};
  if (toStatus === 'approved' && approvedBy) {
    extra.approved_by = approvedBy;
    extra.approved_at = 'NOW()';
  }
  if (toStatus === 'placed_with_supplier') {
    extra.placed_with_supplier_at = 'NOW()';
  }

  const sets = [`status = $1`];
  const params = [toStatus, id];
  if (toStatus === 'approved' && approvedBy) {
    sets.push(`approved_by = $${params.push(approvedBy)}`, `approved_at = NOW()`);
  }
  if (toStatus === 'placed_with_supplier') sets.push(`placed_with_supplier_at = NOW()`);
  if (notes) sets.push(`internal_notes = COALESCE(internal_notes,'') || $${params.push('\n' + notes)}`);

  const result = await pool.query(
    `UPDATE purchase_orders SET ${sets.join(',')} WHERE id = $${params.indexOf(id)+1} RETURNING *`,
    params
  );
  logLogisticsAction('purchase_order', id, `status_to_${toStatus}`, {
    actorUserId,
    beforeState: { status: fromStatus },
    afterState: { status: toStatus },
    notes,
  });
  return result.rows[0];
}

module.exports = {
  createPurchaseOrder, getPurchaseOrder, listPurchaseOrders,
  transitionStatus, canTransition, VALID_TRANSITIONS,
};
