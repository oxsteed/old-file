'use strict';

const pool = require('../db');
const { logLogisticsAction } = require('./logisticsAuditService');

async function listPrograms({
  userId,
  businessId,
  status,
  cadence,
  includeAll = false,
  limit = 100,
  offset = 0,
} = {}) {
  const conditions = ['1=1'];
  const params = [];

  if (!includeAll && userId) {
    conditions.push(`(rp.owner_user_id = $${params.push(userId)} OR sr.user_id = $${params.push(userId)})`);
  }
  if (businessId) {
    conditions.push(`rp.business_id = $${params.push(businessId)}`);
  }
  if (status) {
    conditions.push(`rp.status = $${params.push(status)}`);
  }
  if (cadence) {
    conditions.push(`rp.cadence = $${params.push(cadence)}`);
  }

  const result = await pool.query(
    `SELECT rp.*,
            ll.name AS lane_name,
            ll.origin_country,
            ll.destination_country,
            b.business_name,
            sr.reference AS sourcing_reference,
            sr.status AS sourcing_status,
            sr.converted_to,
            u.first_name || ' ' || u.last_name AS owner_name
     FROM logistics_recurring_procurement_programs rp
     LEFT JOIN logistics_lanes ll ON ll.id = rp.lane_id
     LEFT JOIN businesses b ON b.id = rp.business_id
     LEFT JOIN sourcing_requests sr ON sr.id = rp.sourcing_request_id
     LEFT JOIN users u ON u.id = rp.owner_user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE rp.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
       rp.next_run_date NULLS LAST,
       rp.created_at DESC
     LIMIT $${params.push(Math.min(limit, 200))}
     OFFSET $${params.push(offset)}`,
    params
  );

  return result.rows;
}

async function getProgram(id, { userId, includeAll = false } = {}) {
  const rows = await listPrograms({
    includeAll,
    userId,
    limit: 1,
    offset: 0,
  });
  return rows.find((program) => String(program.id) === String(id)) || null;
}

async function createProgram(data, ownerUserId) {
  const {
    business_id,
    lane_id,
    sourcing_request_id,
    title,
    category,
    description,
    cadence,
    target_qty,
    target_unit,
    preferred_freight,
    destination_country,
    destination_city,
    budget_max_usd,
    status,
    next_run_date,
    last_run_date,
    notes,
  } = data;

  const result = await pool.query(
    `INSERT INTO logistics_recurring_procurement_programs
       (business_id, owner_user_id, lane_id, sourcing_request_id, title, category, description,
        cadence, target_qty, target_unit, preferred_freight, destination_country, destination_city,
        budget_max_usd, status, next_run_date, last_run_date, notes)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      business_id || null,
      ownerUserId,
      lane_id || null,
      sourcing_request_id || null,
      title,
      category || null,
      description || null,
      cadence || 'monthly',
      target_qty || null,
      target_unit || 'unit',
      preferred_freight || null,
      destination_country || null,
      destination_city || null,
      budget_max_usd || null,
      status || 'draft',
      next_run_date || null,
      last_run_date || null,
      notes || null,
    ]
  );

  const program = result.rows[0];
  logLogisticsAction('recurring_procurement_program', program.id, 'created', { actorUserId: ownerUserId });
  return program;
}

async function updateProgram(id, data, actorUserId, { includeAll = false } = {}) {
  const existing = await getProgram(id, { userId: actorUserId, includeAll });
  if (!existing) return null;

  const allowed = [
    'business_id', 'lane_id', 'sourcing_request_id', 'title', 'category', 'description',
    'cadence', 'target_qty', 'target_unit', 'preferred_freight', 'destination_country',
    'destination_city', 'budget_max_usd', 'status', 'next_run_date', 'last_run_date', 'notes',
  ];

  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(data)) {
    if (allowed.includes(key)) {
      params.push(value);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return existing;
  params.push(id);

  const result = await pool.query(
    `UPDATE logistics_recurring_procurement_programs
     SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING *`,
    params
  );

  const program = result.rows[0];
  logLogisticsAction('recurring_procurement_program', id, 'updated', {
    actorUserId,
    beforeState: existing,
    afterState: program,
  });
  return program;
}

module.exports = {
  listPrograms,
  getProgram,
  createProgram,
  updateProgram,
};
