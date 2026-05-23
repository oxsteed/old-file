'use strict';
const pool = require('../db');
const { logLogisticsAction } = require('./logisticsAuditService');

const VALID_SHIPMENT_TRANSITIONS = {
  planned:               ['booked','exception'],
  booked:                ['origin_received','exception'],
  origin_received:       ['consolidating','departed_origin','exception'],
  consolidating:         ['departed_origin','exception'],
  departed_origin:       ['transshipment','arrived_destination','exception'],
  transshipment:         ['departed_origin','arrived_destination','exception'],
  arrived_destination:   ['customs_hold','customs_cleared','exception'],
  customs_hold:          ['customs_cleared','exception'],
  customs_cleared:       ['delivered_to_warehouse'],
  delivered_to_warehouse:['receiving'],
  receiving:             ['allocation_ready'],
  allocation_ready:      ['distributed'],
  distributed:           ['completed'],
  completed:             [],
  exception:             ['planned','booked','origin_received'],
};

async function generateShipmentRef() {
  const year = new Date().getFullYear();
  const res = await pool.query(`SELECT COUNT(*) FROM shipment_records`);
  const seq = String(parseInt(res.rows[0].count) + 1).padStart(5, '0');
  return `SHP-${year}-${seq}`;
}

async function createShipment(data, actorUserId) {
  const ref = await generateShipmentRef();
  const {
    purchase_order_id, pooled_order_id, lane_id, freight_option, carrier,
    carrier_booking_ref, container_number, vessel_name, voyage_number,
    bl_number, awb_number, origin_port, destination_port, origin_country,
    destination_country, total_cartons, total_weight_kg, total_cbm,
    estimated_value_usd, freight_cost_usd, insurance_usd, eta,
    assigned_coordinator, notes,
  } = data;

  const result = await pool.query(
    `INSERT INTO shipment_records
       (reference,purchase_order_id,pooled_order_id,lane_id,freight_option,carrier,
        carrier_booking_ref,container_number,vessel_name,voyage_number,
        bl_number,awb_number,origin_port,destination_port,origin_country,destination_country,
        total_cartons,total_weight_kg,total_cbm,estimated_value_usd,freight_cost_usd,
        insurance_usd,eta,assigned_coordinator,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     RETURNING *`,
    [
      ref,purchase_order_id,pooled_order_id,lane_id,freight_option,carrier,
      carrier_booking_ref,container_number,vessel_name,voyage_number,
      bl_number,awb_number,origin_port,destination_port,origin_country,destination_country,
      total_cartons,total_weight_kg,total_cbm,estimated_value_usd,freight_cost_usd,
      insurance_usd,eta,assigned_coordinator,notes,
    ]
  );
  const shipment = result.rows[0];
  // Write initial milestone
  await pool.query(
    `INSERT INTO shipment_milestones (shipment_id,milestone,notes,created_by)
     VALUES ($1,'planned','Shipment record created',$2)`,
    [shipment.id, actorUserId]
  );
  logLogisticsAction('shipment', shipment.id, 'created', { actorUserId });
  return shipment;
}

async function getShipment(id, { userId = null, isAdmin = false } = {}) {
  const conditions = ['sr.id = $1'];
  const params = [id];
  if (!isAdmin && userId) {
    conditions.push(`(
      sr.assigned_coordinator = $2
      OR EXISTS (
        SELECT 1 FROM purchase_orders po
        WHERE po.id = sr.purchase_order_id
          AND (po.buyer_user_id = $2 OR po.assigned_coordinator = $2)
      )
      OR EXISTS (
        SELECT 1 FROM pooled_orders po
        LEFT JOIN pooled_order_participants pp ON pp.pooled_order_id = po.id
        WHERE po.id = sr.pooled_order_id
          AND (po.organizer_user_id = $2 OR pp.user_id = $2)
      )
    )`);
    params.push(userId);
  }
  const result = await pool.query(
    `SELECT sr.*,
            ll.name AS lane_name,
            COALESCE(json_agg(DISTINCT sm.* ORDER BY sm.occurred_at) FILTER (WHERE sm.id IS NOT NULL), '[]') AS milestones,
            COALESCE(json_agg(DISTINCT sd.*) FILTER (WHERE sd.id IS NOT NULL), '[]') AS documents
     FROM shipment_records sr
     LEFT JOIN logistics_lanes ll ON ll.id = sr.lane_id
     LEFT JOIN shipment_milestones sm ON sm.shipment_id = sr.id
     LEFT JOIN shipment_documents sd ON sd.shipment_id = sr.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY sr.id, ll.id`,
    params
  );
  return result.rows[0] || null;
}

async function listShipments({
  status, laneId, assignedCoordinator, userId, limit = 50, offset = 0
} = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (status)             { conditions.push(`sr.status = $${params.push(status)}`); }
  if (laneId)             { conditions.push(`sr.lane_id = $${params.push(laneId)}`); }
  if (assignedCoordinator){ conditions.push(`sr.assigned_coordinator = $${params.push(assignedCoordinator)}`); }
  if (userId) {
    conditions.push(`(
      sr.assigned_coordinator = $${params.push(userId)}
      OR EXISTS (
        SELECT 1 FROM purchase_orders po
        WHERE po.id = sr.purchase_order_id
          AND (po.buyer_user_id = $${params.length} OR po.assigned_coordinator = $${params.length})
      )
      OR EXISTS (
        SELECT 1 FROM pooled_orders po
        LEFT JOIN pooled_order_participants pp ON pp.pooled_order_id = po.id
        WHERE po.id = sr.pooled_order_id
          AND (po.organizer_user_id = $${params.length} OR pp.user_id = $${params.length})
      )
    )`);
  }

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM shipment_records sr WHERE ${conditions.join(' AND ')}`, params
  );
  const rows = await pool.query(
    `SELECT sr.reference,sr.id,sr.status,sr.freight_option,sr.carrier,
            sr.tracking_number,sr.eta,sr.origin_country,sr.destination_country,
            sr.total_weight_kg,sr.total_cbm,sr.created_at,
            ll.name AS lane_name
     FROM shipment_records sr
     LEFT JOIN logistics_lanes ll ON ll.id = sr.lane_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sr.created_at DESC
     LIMIT $${params.push(Math.min(limit,200))} OFFSET $${params.push(offset)}`,
    params
  );
  return { shipments: rows.rows, total: parseInt(countRes.rows[0].count) };
}

async function addMilestone(shipmentId, milestone, { location, notes, actorUserId } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shipRes = await client.query(
      `SELECT status FROM shipment_records WHERE id = $1 FOR UPDATE`, [shipmentId]
    );
    const current = shipRes.rows[0]?.status;
    if (!current) throw new Error('shipment_not_found');
    if (!VALID_SHIPMENT_TRANSITIONS[current]?.includes(milestone)) {
      throw Object.assign(new Error(`Cannot move from ${current} to ${milestone}`), { code: 'invalid_transition' });
    }

    // Update status field timestamps
    const tsField = {
      booked:                'booked_at',
      departed_origin:       'departed_at',
      arrived_destination:   'arrived_at',
      customs_cleared:       'customs_cleared_at',
      delivered_to_warehouse:'delivered_to_wh_at',
    }[milestone];

    const sets = [`status = $1`];
    const params = [milestone, shipmentId];
    if (tsField) sets.push(`${tsField} = NOW()`);

    await client.query(
      `UPDATE shipment_records SET ${sets.join(',')} WHERE id = $${params.indexOf(shipmentId)+1}`,
      params
    );
    await client.query(
      `INSERT INTO shipment_milestones (shipment_id,milestone,location,notes,created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [shipmentId, milestone, location, notes, actorUserId]
    );
    await client.query('COMMIT');
    logLogisticsAction('shipment', shipmentId, `milestone_${milestone}`, { actorUserId, notes });
    return await getShipment(shipmentId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function addDocument(shipmentId, docData, uploadedBy) {
  const { purchase_order_id, doc_type, file_url, filename, notes } = docData;
  const result = await pool.query(
    `INSERT INTO shipment_documents (shipment_id,purchase_order_id,doc_type,file_url,filename,notes,uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [shipmentId, purchase_order_id, doc_type, file_url, filename, notes, uploadedBy]
  );
  return result.rows[0];
}

module.exports = {
  createShipment, getShipment, listShipments, addMilestone, addDocument,
  VALID_SHIPMENT_TRANSITIONS,
};
