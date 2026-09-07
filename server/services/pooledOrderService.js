'use strict';
const pool = require('../db');
const { logLogisticsAction } = require('./logisticsAuditService');
const { calculateLandedCost } = require('./logisticsPricingService');

async function generatePooledRef() {
  const year = new Date().getFullYear();
  const res = await pool.query(`SELECT COUNT(*) FROM pooled_orders`);
  const seq = String(parseInt(res.rows[0].count) + 1).padStart(5, '0');
  return `PO-${year}-${seq}`;
}

async function listPooledOrders({
  status, laneId, organizerUserId, open = null, limit = 50, offset = 0
} = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (status)          { conditions.push(`po.status = $${params.push(status)}`); }
  if (laneId)          { conditions.push(`po.lane_id = $${params.push(laneId)}`); }
  if (organizerUserId) { conditions.push(`po.organizer_user_id = $${params.push(organizerUserId)}`); }
  if (open === true)   { conditions.push(`po.status IN ('open','pledging','deposit_phase')`); }

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM pooled_orders po WHERE ${conditions.join(' AND ')}`, params
  );
  const rows = await pool.query(
    `SELECT po.*,
            ll.name AS lane_name, ll.origin_country, ll.destination_country,
            u.first_name || ' ' || u.last_name AS organizer_name,
            sp.title AS product_title, sp.category AS product_category,
            (SELECT COUNT(*) FROM pooled_order_participants pp WHERE pp.pooled_order_id = po.id AND pp.status NOT IN ('refunded','disputed')) AS participant_count,
            ROUND(po.current_committed_qty::numeric / NULLIF(po.target_moq,0) * 100) AS moq_pct
     FROM pooled_orders po
     LEFT JOIN logistics_lanes ll ON ll.id = po.lane_id
     LEFT JOIN users u ON u.id = po.organizer_user_id
     LEFT JOIN supplier_products sp ON sp.id = po.supplier_product_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY po.created_at DESC
     LIMIT $${params.push(Math.min(limit,200))} OFFSET $${params.push(offset)}`,
    params
  );
  return { orders: rows.rows, total: parseInt(countRes.rows[0].count) };
}

async function getPooledOrder(id, { viewerUserId = null, includePrivate = false } = {}) {
  const result = await pool.query(
    `SELECT po.*,
            ll.name AS lane_name, ll.origin_country, ll.destination_country,
            ll.risk_tier, ll.customs_complexity, ll.freight_options,
            ll.requires_business_verification, ll.requires_manual_approval, ll.requires_reseller_approval,
            u.first_name || ' ' || u.last_name AS organizer_name,
            sp.title AS product_title, sp.category AS product_category,
            sp.specs AS product_specs, sp.image_urls AS product_images,
            (SELECT COUNT(*) FROM pooled_order_participants pp
             WHERE pp.pooled_order_id = po.id AND pp.status NOT IN ('refunded','disputed')) AS participant_count
     FROM pooled_orders po
     LEFT JOIN logistics_lanes ll ON ll.id = po.lane_id
     LEFT JOIN users u ON u.id = po.organizer_user_id
     LEFT JOIN supplier_products sp ON sp.id = po.supplier_product_id
     WHERE po.id = $1
     GROUP BY po.id, ll.id, u.id, sp.id`,
    [id]
  );
  const order = result.rows[0];
  if (!order) return null;

  const participants = await pool.query(
    includePrivate
      ? `SELECT * FROM pooled_order_participants WHERE pooled_order_id = $1 ORDER BY created_at`
      : `SELECT id, committed_qty, status, delivery_preference
           FROM pooled_order_participants
          WHERE pooled_order_id = $1 AND status NOT IN ('refunded','disputed')
          ORDER BY created_at`,
    [id]
  );
  order.participants = participants.rows;

  if (viewerUserId) {
    const mine = await pool.query(
      `SELECT * FROM pooled_order_participants WHERE pooled_order_id = $1 AND user_id = $2 LIMIT 1`,
      [id, viewerUserId]
    );
    order.my_participation = mine.rows[0] || null;
  } else {
    order.my_participation = null;
  }
  return order;
}

async function createPooledOrder(data, organizerUserId) {
  const ref = await generatePooledRef();
  const {
    title, description, lane_id, supplier_product_id, supplier_quote_id,
    organizer_business_id, target_moq, unit_product_cost_usd,
    unit_freight_est_usd, close_date, lock_date, expected_ship_date,
    expected_arrival_date, cancellation_policy, deposit_pct,
    max_participants, destination_warehouse_id, notes,
  } = data;

  // Calculate landed cost
  let unitLandedCostUSD = null;
  let unitMarkupUSD = null;
  let unitFeesUSD = null;
  if (unit_product_cost_usd) {
    const pricing = await calculateLandedCost({
      unitProductCostUSD: unit_product_cost_usd,
      qty: target_moq,
      laneId: lane_id,
      freightEstUSD: unit_freight_est_usd,
      isPooled: true,
    });
    unitLandedCostUSD = pricing.unitCost.landed;
    unitMarkupUSD     = pricing.unitCost.markup;
    unitFeesUSD       = pricing.unitCost.sourcingFee + pricing.unitCost.customsAdmin +
                        pricing.unitCost.warehouse + pricing.unitCost.lastMile +
                        pricing.unitCost.riskSurcharge;
  }

  const result = await pool.query(
    `INSERT INTO pooled_orders
       (reference,title,description,lane_id,supplier_product_id,supplier_quote_id,
        organizer_user_id,organizer_business_id,target_moq,unit_product_cost_usd,
        unit_freight_est_usd,unit_markup_usd,unit_fees_usd,unit_landed_cost_usd,
        close_date,lock_date,expected_ship_date,expected_arrival_date,
        cancellation_policy,deposit_pct,max_participants,
        destination_warehouse_id,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING *`,
    [
      ref,title,description,lane_id,supplier_product_id,supplier_quote_id,
      organizerUserId,organizer_business_id,target_moq,unit_product_cost_usd,
      unit_freight_est_usd,unitMarkupUSD,unitFeesUSD,unitLandedCostUSD,
      close_date,lock_date,expected_ship_date,expected_arrival_date,
      cancellation_policy,deposit_pct||0.30,max_participants,
      destination_warehouse_id,notes,
    ]
  );
  const order = result.rows[0];
  logLogisticsAction('pooled_order', order.id, 'created', { actorUserId: organizerUserId });
  return order;
}

async function joinPooledOrder(pooledOrderId, userId, { committedQty, businessId, destinationCountry, destinationAddress, deliveryPreference } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the pooled order row
    const orderRes = await client.query(
      `SELECT * FROM pooled_orders WHERE id = $1 FOR UPDATE`, [pooledOrderId]
    );
    const order = orderRes.rows[0];
    if (!order) throw new Error('pooled_order_not_found');
    if (!['open','pledging'].includes(order.status)) throw new Error('pooled_order_not_open');
    if (order.close_date && new Date() > new Date(order.close_date)) throw new Error('pooled_order_closed');

    // Upsert participant
    const subtotalUSD = order.unit_landed_cost_usd
      ? parseFloat(order.unit_landed_cost_usd) * committedQty
      : null;
    const depositUSD = subtotalUSD ? subtotalUSD * parseFloat(order.deposit_pct) : null;

    const partResult = await client.query(
      `INSERT INTO pooled_order_participants
         (pooled_order_id,user_id,business_id,status,committed_qty,unit_price_usd,
          subtotal_usd,deposit_amount_usd,destination_country,destination_address,delivery_preference)
       VALUES ($1,$2,$3,'pledged',$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (pooled_order_id,user_id) DO UPDATE
         SET committed_qty = $4, subtotal_usd = $6, deposit_amount_usd = $7,
             destination_country = $8, destination_address = $9, delivery_preference = $10,
             status = CASE WHEN pooled_order_participants.status = 'invited' THEN 'pledged'
                           ELSE pooled_order_participants.status END
       RETURNING *`,
      [
        pooledOrderId, userId, businessId, committedQty,
        order.unit_landed_cost_usd, subtotalUSD, depositUSD,
        destinationCountry, destinationAddress, deliveryPreference||'warehouse_pickup',
      ]
    );

    // Recalculate committed qty
    await client.query(
      `UPDATE pooled_orders
       SET current_committed_qty = (
         SELECT COALESCE(SUM(committed_qty),0) FROM pooled_order_participants
         WHERE pooled_order_id = $1 AND status NOT IN ('refunded','disputed')
       ), status = CASE WHEN status = 'open' THEN 'pledging' ELSE status END
       WHERE id = $1`,
      [pooledOrderId]
    );

    await client.query('COMMIT');
    logLogisticsAction('pooled_order', pooledOrderId, 'participant_joined', { actorUserId: userId });
    return partResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updatePooledOrderStatus(id, status, actorUserId, notes) {
  const before = await pool.query('SELECT status FROM pooled_orders WHERE id = $1', [id]);
  const result = await pool.query(
    `UPDATE pooled_orders SET status = $1 WHERE id = $2 RETURNING *`,
    [status, id]
  );
  logLogisticsAction('pooled_order', id, `status_to_${status}`, {
    actorUserId,
    beforeState: { status: before.rows[0]?.status },
    afterState: { status },
    notes,
  });
  return result.rows[0];
}

module.exports = {
  listPooledOrders, getPooledOrder, createPooledOrder,
  joinPooledOrder, updatePooledOrderStatus,
};
