'use strict';

const pool = require('../db');
const { logLogisticsAction } = require('./logisticsAuditService');
const permissionsService = require('./permissionsService');

const PROCUREMENT_PERMISSION_CODES = new Set([
  'analytics.view_ops',
  'products.manage',
  'settings.general',
  'team.assign_permissions',
]);

function validationError(message, statusCode = 400, code = 'validation_failed') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function validateReferences({ businessId, sourcingRequestId, actorUserId, includeAll = false } = {}) {
  if (includeAll) return;

  if (businessId) {
    await assertBusinessProcurementAccess(businessId, actorUserId);
  }

  if (sourcingRequestId) {
    const request = await pool.query(
      `SELECT business_id
       FROM sourcing_requests
       WHERE id = $1
         AND (user_id = $2 OR ($3::int IS NOT NULL AND business_id = $3))
       LIMIT 1`,
      [sourcingRequestId, actorUserId, businessId || null]
    );
    if (!request.rows.length) {
      throw validationError('You do not have permission to use this sourcing request', 403, 'sourcing_request_access_denied');
    }
    if (businessId && request.rows[0].business_id && String(request.rows[0].business_id) !== String(businessId)) {
      throw validationError('sourcing_request_id must belong to business_id', 400, 'reference_mismatch');
    }
  }
}

async function businessProcurementAccessRows(userId, businessId = null) {
  const result = await pool.query(
    `SELECT b.id, b.user_id, bm.id AS membership_id, bm.role
       FROM businesses b
       LEFT JOIN business_members bm
         ON bm.business_id = b.id
        AND bm.member_id = $1
        AND bm.status = 'active'
      WHERE b.deleted_at IS NULL
        AND b.is_active = TRUE
        AND ($2::int IS NULL AND (b.user_id = $1 OR bm.member_id = $1) OR b.id = $2::int)
      ORDER BY b.id`,
    [userId, businessId || null]
  );
  return result.rows;
}

async function hasBusinessProcurementAccess(businessId, userId) {
  if (!businessId || !userId) return false;
  const rows = await businessProcurementAccessRows(userId, businessId);
  const row = rows.find((item) => String(item.id) === String(businessId));
  if (!row) return false;
  if (String(row.user_id) === String(userId) || row.role === 'manager') return true;
  const { permissions } = await permissionsService.getEffectivePermissions({
    businessId: row.id,
    userId,
    role: row.role,
    membershipId: row.membership_id,
  });
  return [...permissions].some((permission) => PROCUREMENT_PERMISSION_CODES.has(permission));
}

async function assertBusinessProcurementAccess(businessId, userId) {
  if (!(await hasBusinessProcurementAccess(businessId, userId))) {
    throw validationError('You do not have permission to use this business for procurement', 403, 'business_procurement_access_denied');
  }
}

async function listProcurementBusinessIds(userId) {
  const rows = await businessProcurementAccessRows(userId);
  const ids = [];
  for (const row of rows) {
    if (String(row.user_id) === String(userId) || row.role === 'manager') {
      ids.push(row.id);
      continue;
    }
    const { permissions } = await permissionsService.getEffectivePermissions({
      businessId: row.id,
      userId,
      role: row.role,
      membershipId: row.membership_id,
    });
    if ([...permissions].some((permission) => PROCUREMENT_PERMISSION_CODES.has(permission))) ids.push(row.id);
  }
  return ids;
}

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
    const accessibleBusinessIds = await listProcurementBusinessIds(userId);
    const ownerParam = params.push(userId);
    const businessParam = params.push(accessibleBusinessIds);
    conditions.push(`(rp.business_id IS NOT NULL AND (rp.owner_user_id = $${ownerParam}
      OR sr.user_id = $${ownerParam}
      OR rp.business_id = ANY($${businessParam}::int[])))`);
  }
  if (businessId) {
    if (!includeAll && userId) await assertBusinessProcurementAccess(businessId, userId);
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

async function createProgram(data, ownerUserId, { includeAll = false } = {}) {
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

  if (!business_id && !includeAll) {
    throw validationError('business_id is required for procurement programs', 400, 'business_required');
  }

  await validateReferences({
    businessId: business_id || null,
    sourcingRequestId: sourcing_request_id || null,
    actorUserId: ownerUserId,
    includeAll,
  });

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

  const nextBusinessId = Object.prototype.hasOwnProperty.call(data, 'business_id')
    ? data.business_id
    : existing.business_id;
  const nextSourcingRequestId = Object.prototype.hasOwnProperty.call(data, 'sourcing_request_id')
    ? data.sourcing_request_id
    : existing.sourcing_request_id;
  await validateReferences({
    businessId: nextBusinessId || null,
    sourcingRequestId: nextSourcingRequestId || null,
    actorUserId,
    includeAll,
  });

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
  hasBusinessProcurementAccess,
  assertBusinessProcurementAccess,
  listProcurementBusinessIds,
};
