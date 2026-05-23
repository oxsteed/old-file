'use strict';
const pool = require('../db');
const { logLogisticsAction } = require('./logisticsAuditService');

// Reference generator: SR-2026-00001
async function generateSourcingRef() {
  const year = new Date().getFullYear();
  const result = await pool.query(`SELECT nextval('sourcing_request_seq') AS seq`);
  const seq = String(result.rows[0].seq).padStart(5, '0');
  return `SR-${year}-${seq}`;
}

async function createSourcingRequest(data, userId) {
  const ref = await generateSourcingRef();
  const {
    business_id, lane_id, title, category, description, specs,
    target_qty, target_unit, target_price_usd, budget_max_usd,
    destination_country, destination_city, preferred_freight,
    private_label, custom_mfg, deadline, notes,
  } = data;

  const result = await pool.query(
    `INSERT INTO sourcing_requests
       (reference,user_id,business_id,lane_id,title,category,description,specs,
        target_qty,target_unit,target_price_usd,budget_max_usd,
        destination_country,destination_city,preferred_freight,
        private_label,custom_mfg,deadline,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      ref,userId,business_id,lane_id,title,category,description,
      JSON.stringify(specs||{}),target_qty,target_unit||'unit',
      target_price_usd,budget_max_usd,destination_country,destination_city,
      preferred_freight,private_label||false,custom_mfg||false,deadline,notes,
    ]
  );
  const req = result.rows[0];
  logLogisticsAction('sourcing_request', req.id, 'created', { actorUserId: userId });
  return req;
}

async function listSourcingRequests({
  userId, businessId, status, laneId, assignedOperator, limit = 50, offset = 0
} = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (userId)           { conditions.push(`sr.user_id = $${params.push(userId)}`); }
  if (businessId)       { conditions.push(`sr.business_id = $${params.push(businessId)}`); }
  if (status)           { conditions.push(`sr.status = $${params.push(status)}`); }
  if (laneId)           { conditions.push(`sr.lane_id = $${params.push(laneId)}`); }
  if (assignedOperator) { conditions.push(`sr.assigned_operator = $${params.push(assignedOperator)}`); }

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM sourcing_requests sr WHERE ${conditions.join(' AND ')}`, params
  );
  const rows = await pool.query(
    `SELECT sr.*, ll.name AS lane_name, ll.origin_country, ll.destination_country,
            u.first_name || ' ' || u.last_name AS requester_name,
            (SELECT COUNT(*) FROM supplier_quotes sq WHERE sq.sourcing_request_id = sr.id) AS quote_count
     FROM sourcing_requests sr
     LEFT JOIN logistics_lanes ll ON ll.id = sr.lane_id
     LEFT JOIN users u ON u.id = sr.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sr.created_at DESC
     LIMIT $${params.push(Math.min(limit,200))} OFFSET $${params.push(offset)}`,
    params
  );
  return { requests: rows.rows, total: parseInt(countRes.rows[0].count) };
}

async function getSourcingRequest(id) {
  const result = await pool.query(
    `SELECT sr.*, ll.name AS lane_name, ll.origin_country, ll.destination_country,
            ll.risk_tier, ll.customs_complexity,
            u.first_name || ' ' || u.last_name AS requester_name,
            b.business_name,
            COALESCE(json_agg(DISTINCT sq.*) FILTER (WHERE sq.id IS NOT NULL), '[]') AS quotes
     FROM sourcing_requests sr
     LEFT JOIN logistics_lanes ll ON ll.id = sr.lane_id
     LEFT JOIN users u ON u.id = sr.user_id
     LEFT JOIN businesses b ON b.id = sr.business_id
     LEFT JOIN supplier_quotes sq ON sq.sourcing_request_id = sr.id
     WHERE sr.id = $1
     GROUP BY sr.id, ll.id, u.id, b.id`,
    [id]
  );
  return result.rows[0] || null;
}

async function updateSourcingRequestStatus(id, status, actorUserId, notes) {
  const before = await pool.query('SELECT status FROM sourcing_requests WHERE id = $1', [id]);
  const result = await pool.query(
    `UPDATE sourcing_requests SET status = $1, internal_notes = COALESCE(internal_notes,'') || $2
     WHERE id = $3 RETURNING *`,
    [status, notes ? `\n[${new Date().toISOString()}] ${notes}` : '', id]
  );
  logLogisticsAction('sourcing_request', id, `status_changed_to_${status}`, {
    actorUserId,
    beforeState: { status: before.rows[0]?.status },
    afterState: { status },
  });
  return result.rows[0];
}

async function assignOperator(id, operatorUserId, actorUserId) {
  const result = await pool.query(
    `UPDATE sourcing_requests SET assigned_operator = $1 WHERE id = $2 RETURNING *`,
    [operatorUserId, id]
  );
  logLogisticsAction('sourcing_request', id, 'operator_assigned', { actorUserId });
  return result.rows[0];
}

// ─── Quotes ───────────────────────────────────────────────────

async function createQuote(data, createdBy) {
  const {
    sourcing_request_id, supplier_id, supplier_product_id, lane_id,
    qty_quoted, unit_price_usd, total_product_usd, freight_est_usd,
    lead_time_days, valid_until, payment_terms, freight_terms,
    sample_available, sample_price_usd, notes, doc_urls,
  } = data;

  const year = new Date().getFullYear();
  const countRes = await pool.query(`SELECT COUNT(*) FROM supplier_quotes`);
  const seq = String(parseInt(countRes.rows[0].count) + 1).padStart(5, '0');
  const reference = `QT-${year}-${seq}`;

  const result = await pool.query(
    `INSERT INTO supplier_quotes
       (reference,sourcing_request_id,supplier_id,supplier_product_id,lane_id,
        qty_quoted,unit_price_usd,total_product_usd,freight_est_usd,
        lead_time_days,valid_until,payment_terms,freight_terms,
        sample_available,sample_price_usd,notes,doc_urls,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      reference,sourcing_request_id,supplier_id,supplier_product_id,lane_id,
      qty_quoted,unit_price_usd,total_product_usd||null,freight_est_usd||null,
      lead_time_days,valid_until,payment_terms,freight_terms,
      sample_available||false,sample_price_usd,notes,doc_urls||[],createdBy,
    ]
  );
  return result.rows[0];
}

async function reviewQuote(id, status, reviewedBy, notes) {
  const result = await pool.query(
    `UPDATE supplier_quotes
     SET status = $1, reviewed_by = $2, reviewed_at = NOW(), notes = COALESCE(notes,'') || $3
     WHERE id = $4 RETURNING *`,
    [status, reviewedBy, notes ? `\n${notes}` : '', id]
  );
  logLogisticsAction('supplier_quote', id, `quote_${status}`, { actorUserId: reviewedBy });
  return result.rows[0];
}

async function listQuotes({ status, sourcingRequestId, supplierId, limit = 100, offset = 0 } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (status) { conditions.push(`sq.status = $${params.push(status)}`); }
  if (sourcingRequestId) { conditions.push(`sq.sourcing_request_id = $${params.push(sourcingRequestId)}`); }
  if (supplierId) { conditions.push(`sq.supplier_id = $${params.push(supplierId)}`); }

  const result = await pool.query(
    `SELECT sq.*,
            sr.reference AS sourcing_ref,
            sp.company_name AS supplier_name
     FROM supplier_quotes sq
     LEFT JOIN sourcing_requests sr ON sr.id = sq.sourcing_request_id
     LEFT JOIN supplier_profiles sp ON sp.id = sq.supplier_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sq.created_at DESC
     LIMIT $${params.push(Math.min(limit, 200))} OFFSET $${params.push(offset)}`,
    params
  );
  return result.rows;
}

module.exports = {
  createSourcingRequest, listSourcingRequests, getSourcingRequest,
  updateSourcingRequestStatus, assignOperator, createQuote, reviewQuote, listQuotes,
};
