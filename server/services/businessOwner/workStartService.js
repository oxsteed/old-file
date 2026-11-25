'use strict';
// Groups 5-6 items 252, 254-258, 260, 288: what a team member is responsible
// for, shift onboarding, permission help, the claimable queue, availability
// matching, conflict warnings and dispatch confirmation.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const permissions = require('../permissionsService');
const { fail, invalid, text, int, notify } = require('./common');
const { ACTIVE_MEMBER, STAFF_SQL, workedAppointment, routeTarget, fitFor, tz } = require('./teamCommon');
const policies = require('./policyService');

// Codes a member can never ask for (owner-held or money-moving).
const NEVER_REQUEST = new Set(['owner.transfer', 'owner.delete_business', 'owner.change_legal_entity', 'payouts.manage', 'refunds.approve',
  'team.assign_permissions', 'team.assign_roles', 'settings.billing', 'settings.security', 'credit.manage', 'payroll.manage']);
const myWorkUrl = id => `/business/${id}/workspace/my-work`;
const consoleUrl = id => `/business/${id}/workspace/owner-console`;

async function membership(db, businessId, userId) {
  const { rows: [m] } = await db.query(`SELECT id, role, job_role, member_type, company_name, accepted_at, access_valid_until, expires_at FROM business_members
    WHERE business_id=$1 AND member_id=$2 AND ${ACTIVE_MEMBER}`, [businessId, userId]);
  return m || null;
}

// 252
async function overview(businessId, userId, ctx) {
  const m = await membership(pool, businessId, userId);
  const [locations, services, crews, deputy, counts, managers] = await Promise.all([
    pool.query(`SELECT l.id, l.name, l.status FROM business_service_location_members lm JOIN business_service_locations l ON l.id=lm.location_id
      WHERE lm.user_id=$2 AND l.business_id=$1 AND l.status <> 'closed' ORDER BY l.name`, [businessId, userId]),
    pool.query(`SELECT s.id, s.name FROM business_service_staff ss JOIN business_services s ON s.id=ss.service_id
      WHERE ss.staff_id=$2 AND ss.is_available AND s.business_id=$1 AND s.deleted_at IS NULL ORDER BY s.name`, [businessId, userId]),
    pool.query(`SELECT c.id, c.name, c.lead_user_id = $2 AS is_lead FROM business_crew_members cm JOIN business_crews c ON c.id=cm.crew_id
      WHERE cm.user_id=$2 AND c.business_id=$1 AND c.is_active ORDER BY c.name`, [businessId, userId]),
    pool.query('SELECT ends_at FROM business_deputies WHERE business_id=$1 AND deputy_user_id=$2 AND ended_at IS NULL AND ends_at > NOW()', [businessId, userId]),
    pool.query(`SELECT
        (SELECT COUNT(*)::int FROM business_appointments a WHERE a.business_id=$1 AND a.staff_id=$2 AND a.status IN ('pending','confirmed','in_progress')
           AND (timezone($3, a.start_time))::date = (timezone($3, NOW()))::date) AS today,
        (SELECT COUNT(*)::int FROM business_appointments a WHERE a.business_id=$1 AND a.staff_id=$2 AND a.status IN ('pending','confirmed') AND a.start_time > NOW() AND a.start_time < NOW() + INTERVAL '7 days') AS next_7_days,
        (SELECT COUNT(*)::int FROM business_team_tasks t WHERE t.business_id=$1 AND t.assignee_id=$2 AND t.status='open') AS open_tasks,
        (SELECT COUNT(*)::int FROM business_appointments a WHERE a.business_id=$1 AND a.staff_id=$2 AND a.dispatch_status='pending' AND a.start_time > NOW()) AS to_confirm,
        (SELECT COUNT(*)::int FROM business_work_exceptions e WHERE e.business_id=$1 AND e.raised_by=$2 AND e.status IN ('open','acknowledged')) AS my_open_issues`, [businessId, userId, await tz(pool, businessId)]),
    pool.query(`SELECT u.id, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name, CASE WHEN b.user_id=u.id THEN 'owner' ELSE 'manager' END AS role
      FROM businesses b JOIN users u ON u.id=b.user_id WHERE b.id=$1
      UNION ALL SELECT u.id, TRIM(CONCAT(u.first_name,' ',u.last_name)), 'manager' FROM business_members m JOIN users u ON u.id=m.member_id
      WHERE m.business_id=$1 AND m.role='manager' AND ${ACTIVE_MEMBER.replace(/(status|member_id|access_valid_until|expires_at)/g, 'm.$1')}`, [businessId]),
  ]);
  const ends = [m?.access_valid_until, m?.expires_at].filter(Boolean).map(d => new Date(d)).sort((a, b) => a - b)[0] || null;
  return {
    role: ctx.role, job_role: m?.job_role || null, member_type: m?.member_type || (ctx.role === 'owner' ? null : 'staff'), company_name: m?.company_name || null,
    member_since: m?.accepted_at || null, access_ends_at: ends, permissions: [...(ctx.permissions || [])].sort(),
    locations: locations.rows, services: services.rows, crews: crews.rows, deputy_until: deputy.rows[0]?.ends_at || null, counts: counts.rows[0], managers: managers.rows,
  };
}

// 254
async function onboarding(businessId, userId) {
  const { rows: [c] } = await pool.query(`SELECT
      EXISTS (SELECT 1 FROM business_staff_availability WHERE business_id=$1 AND user_id=$2) AS availability,
      NOT EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (kind) id FROM business_team_documents WHERE business_id=$1 ORDER BY kind, version DESC) d
        WHERE NOT EXISTS (SELECT 1 FROM business_team_acknowledgments a WHERE a.document_id=d.id AND a.user_id=$2)) AS documents,
      EXISTS (SELECT 1 FROM business_service_staff ss JOIN business_services s ON s.id=ss.service_id WHERE s.business_id=$1 AND ss.staff_id=$2 AND ss.is_available) AS services,
      EXISTS (SELECT 1 FROM business_staff_shifts WHERE business_id=$1 AND user_id=$2 AND cancelled_at IS NULL AND published_at IS NOT NULL AND shift_date >= CURRENT_DATE) AS first_shift,
      EXISTS (SELECT 1 FROM users WHERE id=$2 AND COALESCE(NULLIF(phone,''), NULLIF(phone_number,'')) IS NOT NULL) AS phone`, [businessId, userId]);
  const items = ['phone', 'availability', 'documents', 'services', 'first_shift'].map(key => ({ key, done: !!c[key] }));
  return { items, complete: items.every(i => i.done) };
}

// 255 / 288
async function catalogRow(db, code) {
  const { rows: [p] } = await db.query('SELECT id, code, description FROM team_permissions WHERE code=$1', [code]);
  return p || null;
}
async function accessCheck(businessId, userId, ctx, code) {
  if (typeof code !== 'string' || !(await catalogRow(pool, code))) invalid('code');
  const m = await membership(pool, businessId, userId);
  const allowed = ctx.role === 'owner' || !!ctx.permissions?.has?.(code);
  let reason = allowed ? 'granted' : 'not_in_role';
  if (!allowed && m) {
    const { rows: [o] } = await pool.query(`SELECT o.effect, o.expires_at FROM membership_permission_overrides o JOIN team_permissions p ON p.id=o.permission_id
      WHERE o.membership_id=$1 AND p.code=$2`, [m.id, code]);
    if (o?.effect === 'deny') reason = 'denied_by_owner';
    else if (o && o.expires_at && new Date(o.expires_at) <= new Date()) reason = 'grant_expired';
  }
  const { rows: [pending] } = m ? await pool.query("SELECT id, created_at FROM business_permission_requests WHERE membership_id=$1 AND permission_code=$2 AND status='pending'", [m.id, code]) : { rows: [] };
  return { code, allowed, reason, can_request: !allowed && !!m && !NEVER_REQUEST.has(code) && reason !== 'denied_by_owner', pending_request: pending || null };
}
async function requestPermission(businessId, userId, ctx, body) {
  const code = typeof body?.permission_code === 'string' ? body.permission_code : invalid('permission_code');
  const reason = text(body.reason, 500, { min: 5 });
  const contextPath = text(body.context_path, 200, { required: false });
  const duration = body.duration_days == null || body.duration_days === '' ? null : int(body.duration_days, { min: 1, max: 365, field: 'duration_days' });
  if (NEVER_REQUEST.has(code)) fail(409, 'permission_not_requestable');
  if (!(await catalogRow(pool, code))) invalid('permission_code');
  if (ctx.permissions?.has?.(code)) fail(409, 'permission_already_held');
  const m = await membership(pool, businessId, userId);
  if (!m) fail(409, 'permission_not_requestable');
  let row;
  try {
    ({ rows: [row] } = await pool.query(`INSERT INTO business_permission_requests(business_id, membership_id, requester_id, permission_code, reason, context_path, duration_days)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [businessId, m.id, userId, code, reason, contextPath, duration]));
  } catch (e) { if (e.code === '23505') fail(409, 'permission_request_pending'); throw e; }
  const { rows: [b] } = await pool.query('SELECT user_id FROM businesses WHERE id=$1', [businessId]);
  await notify(b.user_id, 'business_permission_requested', { businessId }, `perm-req:${row.id}`, consoleUrl(businessId));
  return row;
}
async function myPermissionRequests(businessId, userId) {
  const { rows } = await pool.query(`SELECT r.*, p.description FROM business_permission_requests r LEFT JOIN team_permissions p ON p.code=r.permission_code
    WHERE r.business_id=$1 AND r.requester_id=$2 ORDER BY r.created_at DESC LIMIT 50`, [businessId, userId]);
  return { requests: rows };
}
async function permissionQueue(businessId) {
  const { rows } = await pool.query(`SELECT r.*, p.description, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS requester_name, m.role AS requester_role
    FROM business_permission_requests r JOIN business_members m ON m.id=r.membership_id JOIN users u ON u.id=r.requester_id LEFT JOIN team_permissions p ON p.code=r.permission_code
    WHERE r.business_id=$1 AND r.status='pending' ORDER BY r.created_at LIMIT 200`, [businessId]);
  return { requests: rows };
}
async function decidePermission(businessId, actorId, ctx, requestId, body) {
  const id = int(requestId, { min: 1, field: 'request' });
  if (!['approve', 'deny'].includes(body?.decision)) invalid('decision');
  const note = text(body.note, 500, { required: false });
  const out = await withTransaction(pool, async db => {
    const { rows: [r] } = await db.query("SELECT * FROM business_permission_requests WHERE id=$1 AND business_id=$2 FOR UPDATE", [id, businessId]);
    if (!r) fail(404, 'not_found');
    if (r.status !== 'pending') fail(409, 'conflict');
    if (String(r.requester_id) === String(actorId)) fail(403, 'self_review');
    // A non-owner approver can only hand out codes they hold themselves.
    if (body.decision === 'approve' && ctx.role !== 'owner' && !ctx.permissions?.has?.(r.permission_code)) fail(403, 'cannot_grant_unheld');
    const { rows: [m] } = await db.query(`SELECT id FROM business_members WHERE id=$1 AND ${ACTIVE_MEMBER}`, [r.membership_id]);
    if (!m && body.decision === 'approve') fail(409, 'target_not_active');
    if (body.decision === 'approve') {
      const p = await catalogRow(db, r.permission_code);
      await db.query(`INSERT INTO membership_permission_overrides(membership_id, permission_id, effect, reason, granted_by_user_id, expires_at)
        VALUES($1,$2,'allow',$3,$4, CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $5::int) END)
        ON CONFLICT (membership_id, permission_id) DO UPDATE SET effect='allow', reason=EXCLUDED.reason, granted_by_user_id=EXCLUDED.granted_by_user_id, expires_at=EXCLUDED.expires_at`,
      [r.membership_id, p.id, `request:${r.id}`, actorId, r.duration_days]);
      await db.query('UPDATE business_members SET permission_version=COALESCE(permission_version,0)+1 WHERE id=$1', [r.membership_id]);
    }
    const { rows: [done] } = await db.query(`UPDATE business_permission_requests SET status=$2, decided_by=$3, decided_at=NOW(), decision_note=$4 WHERE id=$1 RETURNING *`,
      [r.id, body.decision === 'approve' ? 'approved' : 'denied', actorId, note]);
    return done;
  }, 'business_permission_decide');
  permissions.invalidateCache(businessId, out.requester_id);
  await notify(out.requester_id, 'business_permission_decided', { businessId }, `perm-dec:${out.id}`, myWorkUrl(businessId));
  return out;
}
async function cancelPermissionRequest(businessId, userId, requestId) {
  const id = int(requestId, { min: 1, field: 'request' });
  const { rows: [r] } = await pool.query("UPDATE business_permission_requests SET status='cancelled' WHERE id=$1 AND business_id=$2 AND requester_id=$3 AND status='pending' RETURNING *", [id, businessId, userId]);
  if (!r) fail(404, 'not_found');
  return r;
}

// 256: unassigned upcoming visits the member is qualified for.
async function queue(businessId, userId) {
  const policy = await policies.policyRow(pool, businessId);
  const { rows } = await pool.query(`SELECT a.id, a.service_id, a.start_time, a.end_time, a.status, a.customer_name, s.name AS service_name
    FROM business_appointments a JOIN business_services s ON s.id=a.service_id
    WHERE a.business_id=$1 AND a.staff_id IS NULL AND a.status IN ('pending','confirmed') AND a.start_time > NOW() AND a.start_time < NOW() + INTERVAL '14 days'
      AND EXISTS (SELECT 1 FROM business_service_staff ss WHERE ss.service_id=a.service_id AND ss.staff_id=$2 AND ss.is_available)
    ORDER BY a.start_time LIMIT 100`, [businessId, userId]);
  const out = [];
  for (const a of rows) {
    const [fit] = await fitFor(pool, businessId, [userId], a);
    out.push({ ...a, available: fit.available, conflict: fit.conflict, time_off: fit.time_off });
  }
  return { self_claim: policy.allow_self_claim, visits: out };
}
async function claim(businessId, userId, ctx, appointmentId) {
  const policy = await policies.policyRow(pool, businessId);
  if (!policy.allow_self_claim && !(ctx.permissions?.has?.('jobs.assign'))) fail(403, 'self_claim_disabled');
  return withTransaction(pool, async db => {
    const { rows: [a] } = await db.query('SELECT * FROM business_appointments WHERE id::text=$1 AND business_id=$2 FOR UPDATE', [String(appointmentId), businessId]);
    if (!a) fail(404, 'not_found');
    if (a.staff_id) fail(409, 'already_assigned');
    if (!['pending', 'confirmed'].includes(a.status) || new Date(a.start_time) <= new Date()) fail(409, 'invalid_status_transition');
    const [fit] = await fitFor(db, businessId, [userId], a);
    if (!fit.qualified) fail(409, 'not_qualified');
    if (fit.conflict) fail(409, 'schedule_conflict');
    if (fit.time_off) fail(409, 'on_time_off');
    const { rows: [row] } = await db.query("UPDATE business_appointments SET staff_id=$2, dispatch_status='confirmed', dispatch_responded_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *", [a.id, userId]);
    await db.query("INSERT INTO business_appointment_assignment_events(appointment_id,business_id,from_staff_id,to_staff_id,actor_id,source) VALUES($1,$2,NULL,$3,$3,'claim')", [a.id, businessId, userId]);
    return row;
  }, 'business_work_claim');
}
const RELEASE_MIN_HOURS = 24;
async function release(businessId, userId, appointmentId, body) {
  const reason = text(body?.reason, 300, { required: false });
  const row = await withTransaction(pool, async db => {
    const { appt, assignee } = await workedAppointment(db, businessId, appointmentId, userId, { lock: true });
    if (!assignee) fail(404, 'not_found');
    if (!['pending', 'confirmed'].includes(appt.status)) fail(409, 'invalid_status_transition');
    if (new Date(appt.start_time) - Date.now() < RELEASE_MIN_HOURS * 36e5) fail(409, 'release_too_late');
    const { rows: [r] } = await db.query('UPDATE business_appointments SET staff_id=NULL, dispatch_status=NULL, dispatch_responded_at=NULL, updated_at=NOW() WHERE id=$1 RETURNING *', [appt.id]);
    await db.query("INSERT INTO business_appointment_assignment_events(appointment_id,business_id,from_staff_id,to_staff_id,actor_id,source,reason) VALUES($1,$2,$3,NULL,$3,'release',$4)", [appt.id, businessId, userId, reason]);
    return r;
  }, 'business_work_release');
  await notify(await routeTarget(pool, businessId, userId), 'business_work_released', { businessId }, `release:${row.id}:${Date.now()}`, consoleUrl(businessId));
  return row;
}

// 257: ranked candidates for one visit.
async function matches(businessId, appointmentId) {
  const { rows: [a] } = await pool.query('SELECT * FROM business_appointments WHERE id::text=$1 AND business_id=$2', [String(appointmentId), businessId]);
  if (!a) fail(404, 'not_found');
  const { rows: staff } = await pool.query(`SELECT s.user_id, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name FROM (${STAFF_SQL}) s JOIN users u ON u.id=s.user_id`, [businessId]);
  const fits = await fitFor(pool, businessId, staff.map(s => s.user_id), a);
  const byId = Object.fromEntries(fits.map(f => [String(f.user_id), f]));
  const ranked = staff.map(s => {
    const f = byId[String(s.user_id)];
    const score = (f.qualified ? 100 : 0) + (f.available ? 40 : 0) - (f.conflict ? 200 : 0) - (f.time_off ? 200 : 0) - f.same_day * 5;
    return { user_id: s.user_id, name: s.name, qualified: f.qualified, available: f.available, conflict: f.conflict, time_off: f.time_off, same_day: f.same_day,
      current: String(a.staff_id) === String(s.user_id), eligible: f.qualified && !f.conflict && !f.time_off, score };
  }).sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  return { appointment: { id: a.id, start_time: a.start_time, end_time: a.end_time, staff_id: a.staff_id }, candidates: ranked };
}

// 258: the member's own upcoming assignments with warnings.
async function conflicts(businessId, userId) {
  const { rows } = await pool.query(`SELECT a.id, a.service_id, a.start_time, a.end_time, a.status, a.customer_name, s.name AS service_name FROM business_appointments a
    LEFT JOIN business_services s ON s.id=a.service_id WHERE a.business_id=$1 AND a.status IN ('pending','confirmed') AND a.start_time > NOW() AND a.start_time < NOW() + INTERVAL '14 days'
      AND (a.staff_id=$2 OR EXISTS (SELECT 1 FROM business_appointment_crew c WHERE c.appointment_id=a.id AND c.user_id=$2 AND c.attendance <> 'declined')) ORDER BY a.start_time`, [businessId, userId]);
  const out = [];
  for (const a of rows) {
    const [f] = await fitFor(pool, businessId, [userId], a);
    const warnings = [f.conflict && 'overlap', !f.available && 'outside_schedule', f.time_off && 'time_off'].filter(Boolean);
    if (warnings.length) out.push({ ...a, warnings });
  }
  return { warnings: out, checked: rows.length };
}

// 260
async function respondDispatch(businessId, userId, appointmentId, body) {
  if (!['confirm', 'decline'].includes(body?.response)) invalid('response');
  const note = text(body.note, 300, { required: body.response === 'decline', min: 3 });
  const row = await withTransaction(pool, async db => {
    const { appt, assignee } = await workedAppointment(db, businessId, appointmentId, userId, { lock: true });
    if (!assignee) fail(404, 'not_found');
    if (!['pending', 'confirmed'].includes(appt.status) || new Date(appt.start_time) <= new Date()) fail(409, 'invalid_status_transition');
    if (body.response === 'confirm') {
      const { rows: [r] } = await db.query("UPDATE business_appointments SET dispatch_status='confirmed', dispatch_responded_at=NOW(), dispatch_note=$2 WHERE id=$1 RETURNING *", [appt.id, note]);
      await db.query("INSERT INTO business_appointment_assignment_events(appointment_id,business_id,from_staff_id,to_staff_id,actor_id,source) VALUES($1,$2,$3,$3,$3,'confirm')", [appt.id, businessId, userId]);
      return r;
    }
    const { rows: [r] } = await db.query("UPDATE business_appointments SET staff_id=NULL, dispatch_status=NULL, dispatch_responded_at=NOW(), dispatch_note=$2, updated_at=NOW() WHERE id=$1 RETURNING *", [appt.id, note]);
    await db.query("INSERT INTO business_appointment_assignment_events(appointment_id,business_id,from_staff_id,to_staff_id,actor_id,source,reason) VALUES($1,$2,$3,NULL,$3,'decline',$4)", [appt.id, businessId, userId, note]);
    return { ...r, declined: true };
  }, 'business_dispatch_respond');
  if (row.declined) await notify(await routeTarget(pool, businessId, userId), 'business_dispatch_declined', { businessId }, `dispatch-decl:${row.id}:${Date.now()}`, consoleUrl(businessId));
  return row;
}
async function dispatchBoard(businessId) {
  const policy = await policies.policyRow(pool, businessId);
  const hours = policy.dispatch_confirm_hours || 24;
  const { rows } = await pool.query(`SELECT a.id, a.start_time, a.dispatch_status, a.dispatch_responded_at, a.dispatch_note, a.customer_name, s.name AS service_name,
      TRIM(CONCAT(u.first_name,' ',u.last_name)) AS staff_name, a.start_time < NOW() + make_interval(hours => $2) AS overdue
    FROM business_appointments a LEFT JOIN business_services s ON s.id=a.service_id LEFT JOIN users u ON u.id=a.staff_id
    WHERE a.business_id=$1 AND a.staff_id IS NOT NULL AND a.dispatch_status='pending' AND a.status IN ('pending','confirmed') AND a.start_time > NOW()
    ORDER BY a.start_time LIMIT 200`, [businessId, hours]);
  return { confirm_within_hours: hours, pending: rows };
}

module.exports = { overview, onboarding, accessCheck, requestPermission, myPermissionRequests, permissionQueue, decidePermission, cancelPermissionRequest,
  queue, claim, release, matches, conflicts, respondDispatch, dispatchBoard, NEVER_REQUEST, membership };
