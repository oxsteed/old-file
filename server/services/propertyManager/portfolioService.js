'use strict';
// Group 7 items 301-310 (portfolio, delegation) and 346-350 (transfer).
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, uuid, isoDate, notify, ownerOf } = require('../businessOwner/common');
const { ACTIVE_ASSIGNMENT, cents, oneOf, property, propertyAccess } = require('./access');

const TYPES = ['single_family', 'multi_family', 'condo', 'commercial', 'mixed_use', 'other'];
const AREA_KINDS = ['lobby', 'laundry', 'parking', 'grounds', 'roof', 'mechanical', 'amenity', 'other'];
const ROLES = ['manager', 'building_staff', 'coverage', 'unit_contact'];
const OPEN_REQ = `status NOT IN ('completed','cancelled','rejected')`;
const url = (b, p) => `/business/${b}/workspace?tab=properties${p ? `&property=${p}` : ''}`;

// 301 portfolio dashboard (admins see all; assigned staff see their properties)
async function portfolio(businessId, user, role, { archived = false } = {}) {
  const admin = ['owner', 'manager'].includes(role);
  const { rows } = await pool.query(`SELECT p.id, p.label, p.address, p.address_city, p.property_type, p.status, p.archived_at, p.owner_name,
      p.monthly_budget_cents, p.reserve_target_cents, p.reserve_balance_cents,
      (SELECT COUNT(*)::int FROM property_portfolio_units u WHERE u.property_id=p.id) AS units,
      (SELECT COUNT(*)::int FROM property_portfolio_units u WHERE u.property_id=p.id AND u.occupancy_status='vacant') AS vacant,
      (SELECT COUNT(*)::int FROM property_portfolio_units u WHERE u.property_id=p.id AND u.occupancy_status='turnover') AS turnover,
      (SELECT COUNT(*)::int FROM property_maintenance_requests r WHERE r.property_id=p.id AND r.${OPEN_REQ}) AS open_requests,
      (SELECT COUNT(*)::int FROM property_maintenance_requests r WHERE r.property_id=p.id AND r.${OPEN_REQ} AND r.urgency IN ('emergency','urgent')) AS urgent_requests,
      (SELECT COUNT(*)::int FROM property_maintenance_requests r WHERE r.property_id=p.id AND r.approval_status='pending') AS pending_approvals,
      (SELECT COUNT(*)::int FROM property_maintenance_schedules s WHERE s.property_id=p.id AND s.active AND s.next_due_on < CURRENT_DATE) AS overdue_maintenance,
      (SELECT COUNT(*)::int FROM property_incidents i WHERE i.property_id=p.id AND i.status='open') AS open_incidents,
      (SELECT string_agg(DISTINCT COALESCE(NULLIF(TRIM(CONCAT(us.first_name,' ',us.last_name)),''),'?'), ', ') FROM property_staff_assignments a JOIN users us ON us.id=a.user_id
         WHERE a.property_id=p.id AND a.role='manager' AND ${ACTIVE_ASSIGNMENT}) AS managers
    FROM properties p WHERE p.business_id=$1 AND p.status = $2
      AND ($3::boolean OR EXISTS (SELECT 1 FROM property_staff_assignments a WHERE a.property_id=p.id AND a.user_id=$4 AND ${ACTIVE_ASSIGNMENT}))
    ORDER BY p.label`, [businessId, archived ? 'archived' : 'active', admin, user]);
  const totals = rows.reduce((t, r) => { for (const k of ['units', 'vacant', 'open_requests', 'urgent_requests', 'pending_approvals', 'overdue_maintenance', 'open_incidents']) t[k] = (t[k] || 0) + r[k]; return t; }, { properties: rows.length });
  return { properties: rows, totals, can_manage: admin };
}
function profileFields(body, partial) {
  const out = {};
  if (!partial || body.label !== undefined) out.label = text(body.label, 160);
  if (body.address !== undefined) out.address = text(body.address, 300, { required: false });
  if (body.address_city !== undefined) out.address_city = text(body.address_city, 120, { required: false });
  if (body.address_state !== undefined) out.address_state = text(body.address_state, 60, { required: false });
  if (body.address_zip !== undefined) out.address_zip = text(body.address_zip, 20, { required: false });
  if (body.property_type !== undefined) out.property_type = oneOf(body.property_type, TYPES, 'property_type', null);
  if (body.owner_name !== undefined) out.owner_name = text(body.owner_name, 160, { required: false });
  if (body.notes !== undefined) out.notes = text(body.notes, 4000, { required: false });
  for (const k of ['approval_threshold_cents', 'monthly_budget_cents', 'reserve_target_cents', 'reserve_balance_cents']) if (body[k] !== undefined) out[k] = cents(body[k], k);
  if (body.owner_user_id !== undefined) out.owner_user_id = body.owner_user_id ? uuid(body.owner_user_id, 'owner_user_id') : null;
  return out;
}
async function createProperty(businessId, user, body) {
  const f = profileFields(body || {}, false);
  // G6-17 (Batch G, D-500): same duplicate-label guard as the legacy
  // createProperty — no duplicate active label in the business.
  const { rows: dup } = await pool.query('SELECT 1 FROM properties WHERE business_id=$1 AND archived_at IS NULL AND LOWER(label)=LOWER($2) LIMIT 1', [businessId, f.label]);
  if (dup.length) fail(409, 'duplicate_property');
  const keys = Object.keys(f);
  const { rows: [p] } = await pool.query(`INSERT INTO properties(business_id, created_by, ${keys.join(',')}) VALUES($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')}) RETURNING *`, [businessId, user, ...keys.map(k => f[k])]);
  return p;
}
async function updateProperty(businessId, propertyId, body) {
  const f = profileFields(body || {}, true);
  if (f.owner_user_id) { const { rows } = await pool.query('SELECT 1 FROM users WHERE id=$1', [f.owner_user_id]); if (!rows.length) invalid('owner_user_id'); }
  const keys = Object.keys(f);
  if (!keys.length) invalid();
  await property(pool, businessId, propertyId);
  const { rows: [p] } = await pool.query(`UPDATE properties SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(',')}, updated_at=NOW() WHERE id=$1 AND business_id=$2 RETURNING *`, [propertyId, businessId, ...keys.map(k => f[k])]);
  return p;
}
// 302-305 profile with units, common areas, history
async function profile(businessId, propertyId, user, role) {
  const { property: p, admin, roles } = await propertyAccess(pool, businessId, propertyId, user, role);
  const [units, areas, assignments, history] = await Promise.all([
    pool.query(`SELECT id, unit_label, property_type, occupancy_status, contact_name, contact_phone, contact_email, access_summary, priority_tier FROM property_portfolio_units WHERE property_id=$1 ORDER BY unit_label`, [p.id]),
    pool.query('SELECT id, name, kind, access_notes, archived_at FROM property_common_areas WHERE property_id=$1 AND archived_at IS NULL ORDER BY name', [p.id]),
    pool.query(`SELECT a.id, a.role, a.unit_id, a.user_id, a.contact_name, a.contact_email, a.contact_phone, a.starts_at, a.ends_at, a.reviewed_at,
        NULLIF(TRIM(CONCAT(us.first_name,' ',us.last_name)),'') AS user_name FROM property_staff_assignments a LEFT JOIN users us ON us.id=a.user_id
        WHERE a.property_id=$1 AND ${ACTIVE_ASSIGNMENT} ORDER BY a.role, a.created_at`, [p.id]),
    pool.query(`SELECT id, title, status, urgency, issue_category, unit_label, created_at, status_updated_at, actual_cost FROM property_maintenance_requests WHERE property_id=$1 ORDER BY created_at DESC LIMIT 100`, [p.id]),
  ]);
  return { property: p, can_manage: admin, my_roles: roles, units: units.rows, common_areas: areas.rows, assignments: admin ? assignments.rows : assignments.rows.filter(a => a.role !== 'unit_contact' || a.user_id === user), history: history.rows };
}
async function archive(businessId, propertyId, user, body) {
  const reason = text(body?.reason, 500, { required: false });
  return withTransaction(pool, async db => {
    const p = await property(db, businessId, propertyId, { lock: true });
    if (p.status === 'archived') fail(409, 'already_archived');
    const { rows: [open] } = await db.query(`SELECT COUNT(*)::int n FROM property_maintenance_requests WHERE property_id=$1 AND ${OPEN_REQ}`, [p.id]);
    if (open.n && !body?.force) fail(409, 'property_has_open_requests');
    await db.query(`UPDATE property_staff_assignments SET status='ended', ended_at=NOW(), ended_by=$2, end_reason='archived' WHERE property_id=$1 AND status='active'`, [p.id, user]);
    const { rows: [out] } = await db.query(`UPDATE properties SET status='archived', archived_at=NOW(), archived_reason=$2, updated_at=NOW() WHERE id=$1 RETURNING *`, [p.id, reason]);
    return out;
  });
}
async function restore(businessId, propertyId) {
  const p = await property(pool, businessId, propertyId);
  if (p.status !== 'archived') fail(409, 'not_archived');
  const { rows: [out] } = await pool.query(`UPDATE properties SET status='active', archived_at=NULL, updated_at=NOW() WHERE id=$1 RETURNING *`, [p.id]);
  return out;
}
// 302 (Batch F): hard delete, fail closed. Only when no live (open)
// maintenance request names the property; the archive step stays the
// lifecycle (D-241) and delete is the cleanup after it. FKs decide the
// rest: requests/jobs/units keep their rows with property_id nulled,
// common areas, assignments, schedules, keys and incidents cascade.
async function deleteProperty(businessId, propertyId) {
  return withTransaction(pool, async db => {
    const p = await property(db, businessId, propertyId, { lock: true });
    const { rows: [open] } = await db.query(`SELECT COUNT(*)::int n FROM property_maintenance_requests WHERE property_id=$1 AND ${OPEN_REQ}`, [p.id]);
    if (open.n) fail(409, 'property_has_live_requests');
    await db.query('DELETE FROM properties WHERE id=$1', [p.id]);
    return { deleted: true, id: p.id };
  });
}
// 303 attach an existing unit or create a new one under the property
async function addUnit(businessId, propertyId, body) {
  const p = await property(pool, businessId, propertyId);
  if (body?.unit_id) {
    const { rows: [u] } = await pool.query('UPDATE property_portfolio_units SET property_id=$1, property_label=$2, updated_at=NOW() WHERE id::text=$3 AND business_id=$4 RETURNING *', [p.id, p.label, String(body.unit_id), businessId]);
    if (!u) fail(404, 'not_found');
    return u;
  }
  const label = text(body?.unit_label, 120);
  const occ = oneOf(body?.occupancy_status, ['occupied', 'vacant', 'turnover', 'owner_hold'], 'occupancy_status', 'vacant');
  // 309 (Batch F): a unit contact email that is present must be shaped like
  // an email; the contact account/scope leg stays partial (coordinator
  // decision, Emile §4 #1). Same rule as the ops-tab unit leg.
  const contactEmail = text(body.contact_email, 255, { required: false });
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) invalid('contact_email');
  const { rows: [u] } = await pool.query(`INSERT INTO property_portfolio_units(business_id, property_id, property_label, unit_label, occupancy_status, contact_name, contact_phone, contact_email, access_summary)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [businessId, p.id, p.label, label, occ, text(body.contact_name, 160, { required: false }), text(body.contact_phone, 40, { required: false }), contactEmail, text(body.access_summary, 2000, { required: false })]);
  return u;
}
async function addArea(businessId, propertyId, body) {
  const p = await property(pool, businessId, propertyId);
  const { rows: [a] } = await pool.query('INSERT INTO property_common_areas(business_id, property_id, name, kind, access_notes) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [businessId, p.id, text(body?.name, 120), oneOf(body?.kind, AREA_KINDS, 'kind', 'other'), text(body?.access_notes, 2000, { required: false })]);
  return a;
}
async function archiveArea(businessId, areaId) {
  const { rows: [a] } = await pool.query('UPDATE property_common_areas SET archived_at=NOW() WHERE id::text=$1 AND business_id=$2 AND archived_at IS NULL RETURNING id', [String(areaId), businessId]);
  if (!a) fail(404, 'not_found');
  return { archived: true };
}
// 306-309 delegate by site
async function assign(businessId, propertyId, actor, body) {
  const role = oneOf(body?.role, ROLES, 'role');
  const p = await property(pool, businessId, propertyId);
  if (p.status !== 'active') fail(409, 'property_archived');
  let userId = null; let unitId = null;
  if (body.user_id) {
    userId = uuid(body.user_id, 'user_id');
    const { rows } = await pool.query(`SELECT 1 FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active' AND (access_valid_until IS NULL OR access_valid_until > NOW())`, [businessId, userId]);
    if (!rows.length) fail(409, 'not_a_team_member');
  } else if (role !== 'unit_contact') invalid('user_id');
  if (role === 'unit_contact') {
    unitId = uuid(body.unit_id, 'unit_id');
    const { rows } = await pool.query('SELECT 1 FROM property_portfolio_units WHERE id=$1 AND property_id=$2', [unitId, p.id]);
    if (!rows.length) fail(404, 'not_found');
  }
  const contactName = userId ? null : text(body.contact_name, 160);
  const startsAt = body.starts_at ? isoDate(body.starts_at, 'starts_at') : new Date().toISOString();
  const endsAt = body.ends_at ? isoDate(body.ends_at, 'ends_at') : null;
  if (role === 'coverage' && !endsAt) invalid('ends_at');
  if (endsAt && endsAt <= startsAt) invalid('ends_at');
  if (userId) {
    const { rows: dup } = await pool.query(`SELECT 1 FROM property_staff_assignments a WHERE a.property_id=$1 AND a.user_id=$2 AND a.role=$3 AND a.status='active' AND (a.ends_at IS NULL OR a.ends_at > NOW())`, [p.id, userId, role]);
    if (dup.length) fail(409, 'already_assigned');
  }
  const { rows: [a] } = await pool.query(`INSERT INTO property_staff_assignments(business_id, property_id, unit_id, user_id, contact_name, contact_email, contact_phone, role, starts_at, ends_at, assigned_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [businessId, p.id, unitId, userId, contactName, text(body.contact_email, 255, { required: false }), text(body.contact_phone, 40, { required: false }), role, startsAt, endsAt, actor]);
  if (userId) await notify(userId, 'property_assigned', { property: p.label }, `property_assigned:${a.id}`, url(businessId, p.id));
  return a;
}
async function endAssignment(businessId, assignmentId, actor, reason = 'removed') {
  const { rows: [a] } = await pool.query(`UPDATE property_staff_assignments SET status='ended', ended_at=NOW(), ended_by=$3, end_reason=$4 WHERE id::text=$1 AND business_id=$2 AND status='active' RETURNING *`, [String(assignmentId), businessId, actor, reason]);
  if (!a) fail(404, 'not_found');
  return a;
}
// 310 access review: every active grant with review flags
async function accessReview(businessId) {
  const { rows } = await pool.query(`SELECT a.id, a.property_id, p.label AS property, a.role, a.user_id, a.contact_name, a.starts_at, a.ends_at, a.reviewed_at,
      NULLIF(TRIM(CONCAT(us.first_name,' ',us.last_name)),'') AS user_name,
      (a.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM business_members m WHERE m.business_id=a.business_id AND m.member_id=a.user_id AND m.status='active')) AS member_inactive,
      (a.ends_at IS NOT NULL AND a.ends_at < NOW() + INTERVAL '7 days') AS ending_soon,
      (COALESCE(a.reviewed_at, a.created_at) < NOW() - INTERVAL '90 days') AS review_due,
      (SELECT COUNT(*)::int FROM property_keys k WHERE k.holder_user_id=a.user_id AND k.property_id=a.property_id AND k.status='out') AS keys_out
    FROM property_staff_assignments a JOIN properties p ON p.id=a.property_id LEFT JOIN users us ON us.id=a.user_id
    WHERE a.business_id=$1 AND a.status='active' ORDER BY p.label, a.role`, [businessId]);
  return { assignments: rows, flagged: rows.filter(r => r.member_inactive || r.ending_soon || r.review_due).length };
}
async function reviewAssignment(businessId, assignmentId, actor, body) {
  const decision = oneOf(body?.decision, ['keep', 'end'], 'decision');
  if (decision === 'end') return endAssignment(businessId, assignmentId, actor, 'access_review');
  const { rows: [a] } = await pool.query(`UPDATE property_staff_assignments SET reviewed_at=NOW(), reviewed_by=$3 WHERE id::text=$1 AND business_id=$2 AND status='active' RETURNING *`, [String(assignmentId), businessId, actor]);
  if (!a) fail(404, 'not_found');
  return a;
}
// Staff view: my properties
async function mine(businessId, user) {
  const { rows } = await pool.query(`SELECT p.id, p.label, p.address, array_agg(DISTINCT a.role) AS roles, MIN(a.ends_at) AS ends_at,
      (SELECT COUNT(*)::int FROM property_maintenance_requests r WHERE r.property_id=p.id AND r.${OPEN_REQ}) AS open_requests
    FROM property_staff_assignments a JOIN properties p ON p.id=a.property_id WHERE a.business_id=$1 AND a.user_id=$2 AND ${ACTIVE_ASSIGNMENT} AND p.status='active'
    GROUP BY p.id ORDER BY p.label`, [businessId, user]);
  return { properties: rows };
}
// 346, 348 handover export
async function handoverExport(businessId, propertyId) {
  const p = await property(pool, businessId, propertyId);
  const q = (sql) => pool.query(sql, [p.id]).then(r => r.rows);
  const [units, areas, assignments, open, schedules, keys, incidents, vendors] = await Promise.all([
    q('SELECT unit_label, occupancy_status, contact_name, contact_phone, contact_email, access_summary FROM property_portfolio_units WHERE property_id=$1 ORDER BY unit_label'),
    q('SELECT name, kind, access_notes FROM property_common_areas WHERE property_id=$1 AND archived_at IS NULL'),
    q(`SELECT a.role, a.contact_name, a.contact_phone, a.ends_at, NULLIF(TRIM(CONCAT(us.first_name,' ',us.last_name)),'') AS user_name FROM property_staff_assignments a LEFT JOIN users us ON us.id=a.user_id WHERE a.property_id=$1 AND ${ACTIVE_ASSIGNMENT}`),
    q(`SELECT id, title, status, urgency, unit_label, vendor_name, scheduled_start_at, created_at FROM property_maintenance_requests WHERE property_id=$1 AND ${OPEN_REQ} ORDER BY created_at`),
    q('SELECT kind, title, equipment_name, next_due_on, interval_days, months FROM property_maintenance_schedules WHERE property_id=$1 AND active ORDER BY next_due_on'),
    q('SELECT label, status, holder_name, due_back_at FROM property_keys WHERE property_id=$1 ORDER BY label'),
    q(`SELECT title, severity, status, follow_up_on, relocation_until FROM property_incidents WHERE property_id=$1 AND status='open'`),
    q(`SELECT DISTINCT v.name, v.trade, v.contact_name, v.phone, v.email, v.insurance_expires_on FROM property_vendors v WHERE v.id IN (
        SELECT o.vendor_id FROM property_work_orders o JOIN property_maintenance_requests r ON r.id=o.request_id WHERE r.property_id=$1
        UNION SELECT s.vendor_id FROM property_maintenance_schedules s WHERE s.property_id=$1 AND s.vendor_id IS NOT NULL)`),
  ]);
  return { generated_at: new Date().toISOString(), property: { label: p.label, address: p.address, city: p.address_city, type: p.property_type, owner_name: p.owner_name, notes: p.notes },
    units, common_areas: areas, assignments, open_requests: open, schedules, keys, open_incidents: incidents, vendor_contacts: vendors };
}
// 347 reassignment: end current managers, add the new one, tell both
async function reassign(businessId, propertyId, actor, body) {
  const to = uuid(body?.to_user_id, 'to_user_id');
  const p = await property(pool, businessId, propertyId);
  const { rows: prev } = await pool.query(`SELECT a.id, a.user_id FROM property_staff_assignments a WHERE a.property_id=$1 AND a.role='manager' AND a.status='active'`, [p.id]);
  const created = await assign(businessId, propertyId, actor, { role: 'manager', user_id: to }).catch(e => { if (e.code === 'already_assigned') return null; throw e; });
  for (const a of prev.filter(x => String(x.user_id) !== to)) {
    await endAssignment(businessId, a.id, actor, 'reassigned');
    await notify(a.user_id, 'property_manager_changed', { property: p.label }, `property_manager_changed:${a.id}`, url(businessId));
  }
  return { assignment: created, ended: prev.filter(x => String(x.user_id) !== to).length, handover: await handoverExport(businessId, propertyId) };
}
// 349 tell occupants (requesters with accounts) who to contact now
async function notifyOccupants(businessId, propertyId, actor) {
  const p = await property(pool, businessId, propertyId);
  const { rows } = await pool.query(`SELECT DISTINCT requester_id FROM property_maintenance_requests WHERE property_id=$1 AND requester_id IS NOT NULL AND created_at > NOW() - INTERVAL '12 months'
      AND requester_id NOT IN (SELECT user_id FROM businesses WHERE id=$2 UNION SELECT member_id FROM business_members WHERE business_id=$2 AND member_id IS NOT NULL)`, [p.id, businessId]);
  const stamp = Date.now();
  for (const r of rows) await notify(r.requester_id, 'property_contact_updated', { property: p.label }, `property_contact_updated:${p.id}:${r.requester_id}:${stamp}`, `/business/${businessId}/maintenance-request`);
  return { notified: rows.length };
}
// 347 property transfer between businesses (fail-closed, D-518): the
// caller must own BOTH businesses; the property moves with its units,
// requests, schedules, keys, incidents, turnovers, work orders, quotes,
// invoices, common areas, entry records and compliance records in one
// transaction. Converted work never moves: any linked request with a job,
// or any job naming the property directly, refuses the transfer with 409.
// Staff assignments end (their members belong to the source business).
// Vendor contacts carry over (348): the property's vendors are copied
// into the target business's directory, deduped by name + email, so the
// relationships survive the move.
async function transferProperty(businessId, propertyId, actor, body) {
  const toBusinessId = Number(body?.to_business_id ?? body?.toBusinessId);
  if (!Number.isInteger(toBusinessId)) invalid('to_business_id');
  if (toBusinessId === businessId) invalid('to_business_id');
  const out = await withTransaction(pool, async db => {
    const { rows: [from] } = await db.query('SELECT id, user_id FROM businesses WHERE id=$1', [businessId]);
    const { rows: [to] } = await db.query('SELECT id, user_id FROM businesses WHERE id=$1', [toBusinessId]);
    if (!from || !to) fail(404, 'not_found');
    if (String(from.user_id) !== String(actor) || String(to.user_id) !== String(actor)) fail(403, 'transfer_not_permitted');
    const p = await property(db, businessId, propertyId, { lock: true });
    if (p.status !== 'active') fail(409, 'property_archived');
    const { rows: dup } = await db.query('SELECT 1 FROM properties WHERE business_id=$1 AND archived_at IS NULL AND LOWER(label)=LOWER($2) LIMIT 1', [toBusinessId, p.label]);
    if (dup.length) fail(409, 'duplicate_property');
    const { rows: [converted] } = await db.query('SELECT COUNT(*)::int n FROM property_maintenance_requests WHERE property_id=$1 AND job_id IS NOT NULL', [p.id]);
    if (converted.n) fail(409, 'property_has_converted_requests');
    const { rows: [jobbed] } = await db.query('SELECT COUNT(*)::int n FROM jobs WHERE property_id=$1', [p.id]);
    if (jobbed.n) fail(409, 'property_has_converted_requests');
    const { rows: vendors } = await db.query(`SELECT DISTINCT v.name, v.trade, v.contact_name, v.phone, v.email, v.license_number FROM property_vendors v WHERE v.id IN (
        SELECT o.vendor_id FROM property_work_orders o JOIN property_maintenance_requests r ON r.id=o.request_id WHERE r.property_id=$1
        UNION SELECT s.vendor_id FROM property_maintenance_schedules s WHERE s.property_id=$1 AND s.vendor_id IS NOT NULL)`, [p.id]);
    let vendorsCarried = 0;
    for (const v of vendors) {
      const { rows: [ex] } = await db.query('SELECT 1 FROM property_vendors WHERE business_id=$1 AND LOWER(name)=LOWER($2) AND COALESCE(email,\'\')=COALESCE($3,\'\') LIMIT 1', [toBusinessId, v.name, v.email]);
      if (ex) continue;
      await db.query(`INSERT INTO property_vendors(business_id, created_by, name, trade, contact_name, phone, email, license_number, status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'approved')`, [toBusinessId, actor, v.name, v.trade, v.contact_name, v.phone, v.email, v.license_number]);
      vendorsCarried += 1;
    }
    const moved = {};
    const move = async (key, sql, params) => { moved[key] = (await db.query(sql, params)).rowCount; };
    await move('properties', 'UPDATE properties SET business_id=$2 WHERE id=$1', [p.id, toBusinessId]);
    await move('units', 'UPDATE property_portfolio_units SET business_id=$2 WHERE property_id=$1', [p.id, toBusinessId]);
    await move('requests', 'UPDATE property_maintenance_requests SET business_id=$2, owner_id=$3 WHERE property_id=$1', [p.id, toBusinessId, to.user_id]);
    await move('schedules', 'UPDATE property_maintenance_schedules SET business_id=$2 WHERE property_id=$1', [p.id, toBusinessId]);
    await move('keys', 'UPDATE property_keys SET business_id=$2 WHERE property_id=$1', [p.id, toBusinessId]);
    await move('incidents', 'UPDATE property_incidents SET business_id=$2 WHERE property_id=$1', [p.id, toBusinessId]);
    await move('turnovers', 'UPDATE property_turnovers SET business_id=$2 WHERE property_id=$1', [p.id, toBusinessId]);
    await move('work_orders', `UPDATE property_work_orders SET business_id=$2 WHERE request_id IN (SELECT id FROM property_maintenance_requests WHERE property_id=$1)`, [p.id, toBusinessId]);
    await move('quotes', `UPDATE property_work_quotes SET business_id=$2 WHERE request_id IN (SELECT id FROM property_maintenance_requests WHERE property_id=$1)`, [p.id, toBusinessId]);
    await move('invoices', `UPDATE property_vendor_invoices SET business_id=$2 WHERE work_order_id IN (SELECT id FROM property_work_orders WHERE request_id IN (SELECT id FROM property_maintenance_requests WHERE property_id=$1)) OR property_id=$1`, [p.id, toBusinessId]);
    await move('common_areas', 'UPDATE property_common_areas SET business_id=$2 WHERE property_id=$1', [p.id, toBusinessId]);
    await move('entry_records', `UPDATE property_entry_records SET business_id=$2 WHERE request_id IN (SELECT id FROM property_maintenance_requests WHERE property_id=$1)`, [p.id, toBusinessId]);
    await move('compliance_records', `UPDATE property_compliance_records SET business_id=$2 WHERE unit_id IN (SELECT id FROM property_portfolio_units WHERE property_id=$1)`, [p.id, toBusinessId]);
    moved.assignments_ended = (await db.query(`UPDATE property_staff_assignments SET status='ended', ended_at=NOW(), ended_by=$2, end_reason='transferred' WHERE property_id=$1 AND status='active'`, [p.id, actor])).rowCount;
    return { property_id: p.id, from_business_id: businessId, to_business_id: toBusinessId, moved, vendors_carried: vendorsCarried };
  });
  return { ...out, handover: await handoverExport(toBusinessId, propertyId) };
}
// 346 portfolio handover export (G6-13): the whole portfolio as JSON, or
// CSV by section. JSON reuses handoverExport per property so the bundle
// matches the per-property handover exactly, plus the full vendor
// directory. CSV flattens one row per unit (properties without units get
// one row); the vendors section flattens the directory.
const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers, rows) => [headers.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n');
async function portfolioExport(businessId, { format = 'json', section = 'properties' } = {}) {
  const fmt = format === 'csv' ? 'csv' : 'json';
  const sec = section === 'vendors' ? 'vendors' : 'properties';
  if (fmt === 'csv' && sec === 'vendors') {
    const { rows } = await pool.query(`SELECT v.*, (SELECT COUNT(*)::int FROM property_work_orders o WHERE o.vendor_id=v.id) AS work_orders
      FROM property_vendors v WHERE v.business_id=$1 ORDER BY v.name`, [businessId]);
    return { contentType: 'text/csv', filename: `portfolio-vendors-${new Date().toISOString().slice(0, 10)}.csv`,
      body: toCsv(['name', 'trade', 'status', 'contact_name', 'phone', 'email', 'license_number', 'insurance_expires_on', 'work_orders'],
        rows.map(v => [v.name, v.trade, v.status, v.contact_name, v.phone, v.email, v.license_number, v.insurance_expires_on ? String(v.insurance_expires_on).slice(0, 10) : null, v.work_orders])) };
  }
  const { rows: props } = await pool.query(`SELECT id FROM properties WHERE business_id=$1 AND status='active' ORDER BY label`, [businessId]);
  const handovers = [];
  for (const { id } of props) handovers.push(await handoverExport(businessId, id));
  if (fmt === 'json') {
    const { rows: vendors } = await pool.query('SELECT * FROM property_vendors WHERE business_id=$1 ORDER BY name', [businessId]);
    return { contentType: 'application/json', body: { generated_at: new Date().toISOString(), properties: handovers, vendors } };
  }
  const rows = [];
  for (const h of handovers) {
    const managers = h.assignments.filter(a => a.role === 'manager').map(a => a.user_name || a.contact_name).filter(Boolean).join('; ');
    const vendorNames = h.vendor_contacts.map(v => v.name).join('; ');
    const units = h.units.length ? h.units : [null];
    for (const u of units) rows.push([h.property.label, h.property.type, h.property.address, h.property.city, h.property.owner_name,
      u?.unit_label, u?.occupancy_status, u?.contact_name, u?.contact_email, u?.contact_phone, managers, vendorNames, h.open_requests.length]);
  }
  return { contentType: 'text/csv', filename: `portfolio-export-${new Date().toISOString().slice(0, 10)}.csv`,
    body: toCsv(['property', 'type', 'address', 'city', 'owner', 'unit', 'occupancy', 'unit_contact_name', 'unit_contact_email', 'unit_contact_phone', 'managers', 'vendors', 'open_requests'], rows) };
}
// 350 revoke one person's access to a property; keys they hold get flagged
async function revokeAccess(businessId, propertyId, actor, body) {
  const userId = uuid(body?.user_id, 'user_id');
  const p = await property(pool, businessId, propertyId);
  const { rows } = await pool.query(`UPDATE property_staff_assignments SET status='ended', ended_at=NOW(), ended_by=$3, end_reason='revoked' WHERE property_id=$1 AND user_id=$2 AND status='active' RETURNING id`, [p.id, userId, actor]);
  if (!rows.length) fail(404, 'not_found');
  const { rows: keys } = await pool.query(`SELECT id, label, due_back_at FROM property_keys WHERE property_id=$1 AND holder_user_id=$2 AND status='out'`, [p.id, userId]);
  await notify(userId, 'property_access_revoked', { property: p.label }, `property_access_revoked:${rows[0].id}`, null);
  return { ended: rows.length, keys_to_recover: keys };
}
module.exports = { TYPES, portfolio, createProperty, updateProperty, profile, archive, restore, deleteProperty, addUnit, addArea, archiveArea, assign, endAssignment, accessReview, reviewAssignment, mine, handoverExport, portfolioExport, transferProperty, reassign, notifyOccupants, revokeAccess, OPEN_REQ, ownerOf };
