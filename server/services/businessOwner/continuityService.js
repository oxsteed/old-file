'use strict';
// Groups 5-6 items 241-245: ownership transfer, deputy designation, open work
// transition, record access after departure, and the closure checklist.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const permissions = require('../permissionsService');
const { fail, invalid, text, uuid, int, isoDate, ownerOf, activeMember, notify } = require('./common');

const TRANSFER_DAYS = 7;
const MAX_DEPUTY_DAYS = 90;
const FORMER_ACCESS_YEARS = 3;
// Operational codes a deputy covers while the owner is away. Money movement,
// payouts, permissions, ownership and billing stay with the owner.
const DEPUTY_CODES = ['jobs.view_all', 'jobs.assign', 'jobs.reassign', 'jobs.change_status', 'calendar.view_all', 'calendar.manage_all',
  'customers.view_all', 'messages.view_all', 'messages.assign_threads', 'quotes.approve_discounts', 'bookings.manage', 'team.view',
  'invoices.view', 'payments.view', 'support.resolve'];
const consoleUrl = id => `/business/${id}/workspace/owner-console`;

async function audit(db, businessId, actorId, action, targetType, targetId, after) {
  await db.query(`INSERT INTO business_audit_log(business_id, actor_user_id, actor_role, action, target_type, target_id, after_state)
    VALUES($1,$2,NULL,$3,$4,$5,$6)`, [businessId, actorId, action, targetType, String(targetId), after || null]);
}

// ── 241 ownership transfer ──────────────────────────────────────────────
async function expireTransfers(db, businessId) {
  await db.query("UPDATE business_ownership_transfers SET status='expired' WHERE business_id=$1 AND status='pending' AND expires_at <= NOW()", [businessId]);
}
async function transferState(businessId, userId) {
  await expireTransfers(pool, businessId);
  const { rows } = await pool.query(`SELECT t.*, TRIM(CONCAT(f.first_name,' ',f.last_name)) AS from_name, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS to_name
    FROM business_ownership_transfers t JOIN users f ON f.id=t.from_user_id JOIN users u ON u.id=t.to_user_id
    WHERE t.business_id=$1 ORDER BY t.created_at DESC LIMIT 10`, [businessId]);
  const { rows: candidates } = await pool.query(`SELECT m.member_id AS id, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name FROM business_members m JOIN users u ON u.id=m.member_id
    WHERE m.business_id=$1 AND m.status='active' AND m.role='manager' AND (m.access_valid_until IS NULL OR m.access_valid_until > NOW()) ORDER BY 2`, [businessId]);
  const open = rows.find(r => ['pending', 'awaiting_admin'].includes(r.status)) || null;
  return { open, history: rows, candidates, mine: open && String(open.to_user_id) === String(userId) ? open : null };
}
async function requestTransfer(businessId, actorId, body) {
  const to = uuid(body?.to_user_id, 'to_user_id');
  const note = text(body.note, 500, { required: false });
  const result = await withTransaction(pool, async db => {
    const { rows: [b] } = await db.query('SELECT id, user_id, business_name FROM businesses WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [businessId]);
    if (!b || String(b.user_id) !== String(actorId)) fail(403, 'owner_only');
    if (String(body.confirm_name || '').trim() !== b.business_name) fail(400, 'confirm_name_mismatch');
    const m = await activeMember(db, businessId, to);
    if (!m || m.owner || m.membership.role !== 'manager') fail(409, 'transfer_target_not_manager');
    await expireTransfers(db, businessId);
    try {
      const { rows: [t] } = await db.query(`INSERT INTO business_ownership_transfers(business_id, from_user_id, to_user_id, note, expires_at)
        VALUES($1,$2,$3,$4,NOW() + make_interval(days => $5)) RETURNING *`, [businessId, actorId, to, note, TRANSFER_DAYS]);
      await audit(db, businessId, actorId, 'business.ownership_transfer.requested', 'ownership_transfer', t.id, { to_user_id: to });
      return t;
    } catch (e) { if (e.code === '23505') fail(409, 'transfer_already_open'); throw e; }
  }, 'business_ownership_transfer_request');
  await notify(to, 'business_ownership_transfer_requested', { businessId }, `own-transfer-req:${result.id}`, consoleUrl(businessId));
  return result;
}
async function lockTransfer(db, businessId, transferId) {
  const id = int(transferId, { min: 1, field: 'transfer' });
  const { rows: [t] } = await db.query('SELECT * FROM business_ownership_transfers WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, businessId]);
  if (!t) fail(404, 'not_found');
  return t;
}
async function completeTransfer(db, t, actorId) {
  const { rows: [b] } = await db.query('SELECT id, user_id FROM businesses WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [t.business_id]);
  if (!b || String(b.user_id) !== String(t.from_user_id)) fail(409, 'transfer_stale');
  const { rows: [target] } = await db.query("SELECT id FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active' FOR UPDATE", [t.business_id, t.to_user_id]);
  if (!target) fail(409, 'transfer_stale');
  await db.query('UPDATE businesses SET user_id=$2, is_primary=FALSE, updated_at=NOW() WHERE id=$1', [t.business_id, t.to_user_id]);
  await db.query("UPDATE business_members SET status='revoked', role_updated_at=NOW(), role_updated_by=$2 WHERE id=$1", [target.id, actorId]);
  const { rows: [from] } = await db.query('SELECT email FROM users WHERE id=$1', [t.from_user_id]);
  await db.query(`INSERT INTO business_members(business_id, owner_id, member_id, invite_email, role, status, accepted_at, role_updated_at, role_updated_by)
    VALUES($1,$2,$3,$4,'manager','active',NOW(),NOW(),$5)
    ON CONFLICT (business_id, member_id) WHERE member_id IS NOT NULL AND status <> 'revoked'
    DO UPDATE SET role='manager', status='active', accepted_at=COALESCE(business_members.accepted_at, NOW()), role_updated_at=NOW(), role_updated_by=$5`,
  [t.business_id, t.to_user_id, t.from_user_id, from?.email || `former-owner-${t.from_user_id}@invalid.local`, actorId]);
  await db.query('UPDATE business_members SET owner_id=$2 WHERE business_id=$1', [t.business_id, t.to_user_id]);
  await endDeputies(db, t.business_id);
  const { rows: [done] } = await db.query("UPDATE business_ownership_transfers SET status='completed', completed_at=NOW() WHERE id=$1 RETURNING *", [t.id]);
  await audit(db, t.business_id, actorId, 'business.ownership_transfer.completed', 'ownership_transfer', t.id, { from_user_id: t.from_user_id, to_user_id: t.to_user_id });
  return done;
}
function afterComplete(t) {
  permissions.invalidateCache(t.business_id, t.from_user_id);
  permissions.invalidateCache(t.business_id, t.to_user_id);
  return Promise.all([t.from_user_id, t.to_user_id].map(u => notify(u, 'business_ownership_transfer_completed', { businessId: t.business_id }, `own-transfer-done:${t.id}:${u}`, consoleUrl(t.business_id))));
}
async function respondTransfer(businessId, actorId, transferId, accept) {
  const out = await withTransaction(pool, async db => {
    const t = await lockTransfer(db, businessId, transferId);
    if (String(t.to_user_id) !== String(actorId)) fail(403, 'not_transfer_recipient');
    if (t.status !== 'pending' || new Date(t.expires_at) <= new Date()) fail(409, 'transfer_not_pending');
    if (!accept) {
      const { rows: [r] } = await db.query("UPDATE business_ownership_transfers SET status='declined', responded_at=NOW() WHERE id=$1 RETURNING *", [t.id]);
      return { t: r, declined: true };
    }
    const { rows: [b] } = await db.query('SELECT stripe_account_id FROM businesses WHERE id=$1', [businessId]);
    if (b?.stripe_account_id) {
      // Payout account belongs to the current owner's identity: OxSteed reviews.
      const { rows: [r] } = await db.query("UPDATE business_ownership_transfers SET status='awaiting_admin', responded_at=NOW() WHERE id=$1 RETURNING *", [t.id]);
      return { t: r };
    }
    await db.query('UPDATE business_ownership_transfers SET responded_at=NOW() WHERE id=$1', [t.id]);
    return { t: await completeTransfer(db, t, actorId), completed: true };
  }, 'business_ownership_transfer_respond');
  if (out.completed) await afterComplete(out.t);
  if (out.declined) await notify(out.t.from_user_id, 'business_ownership_transfer_declined', { businessId }, `own-transfer-decl:${out.t.id}`, consoleUrl(businessId));
  return out.t;
}
async function cancelTransfer(businessId, actorId, transferId) {
  return withTransaction(pool, async db => {
    const t = await lockTransfer(db, businessId, transferId);
    if (String(t.from_user_id) !== String(actorId)) fail(403, 'owner_only');
    if (!['pending', 'awaiting_admin'].includes(t.status)) fail(409, 'transfer_not_pending');
    const { rows: [r] } = await db.query("UPDATE business_ownership_transfers SET status='cancelled', responded_at=COALESCE(responded_at, NOW()) WHERE id=$1 RETURNING *", [t.id]);
    return r;
  }, 'business_ownership_transfer_cancel');
}
async function adminQueue() {
  const { rows } = await pool.query(`SELECT t.*, b.business_name, f.email AS from_email, u.email AS to_email FROM business_ownership_transfers t
    JOIN businesses b ON b.id=t.business_id JOIN users f ON f.id=t.from_user_id JOIN users u ON u.id=t.to_user_id
    WHERE t.status='awaiting_admin' ORDER BY t.responded_at LIMIT 200`);
  return { transfers: rows };
}
async function adminDecide(adminId, transferId, body) {
  if (!['approve', 'reject'].includes(body?.decision)) invalid('decision');
  const note = text(body.note, 500, { required: body.decision === 'reject' });
  const out = await withTransaction(pool, async db => {
    const id = int(transferId, { min: 1, field: 'transfer' });
    const { rows: [t] } = await db.query('SELECT * FROM business_ownership_transfers WHERE id=$1 FOR UPDATE', [id]);
    if (!t) fail(404, 'not_found');
    if (t.status !== 'awaiting_admin') fail(409, 'transfer_not_pending');
    if ([String(t.from_user_id), String(t.to_user_id)].includes(String(adminId))) fail(403, 'self_review');
    await db.query('UPDATE business_ownership_transfers SET admin_id=$2, admin_note=$3 WHERE id=$1', [t.id, adminId, note]);
    if (body.decision === 'reject') {
      const { rows: [r] } = await db.query("UPDATE business_ownership_transfers SET status='rejected' WHERE id=$1 RETURNING *", [t.id]);
      return { t: r };
    }
    return { t: await completeTransfer(db, t, adminId), completed: true };
  }, 'business_ownership_transfer_admin');
  if (out.completed) await afterComplete(out.t);
  else await Promise.all([out.t.from_user_id, out.t.to_user_id].map(u => notify(u, 'business_ownership_transfer_declined', { businessId: out.t.business_id }, `own-transfer-rej:${out.t.id}:${u}`, consoleUrl(out.t.business_id))));
  return out.t;
}

// ── 242 deputy ──────────────────────────────────────────────────────────
async function endDeputies(db, businessId) {
  const { rows } = await db.query('UPDATE business_deputies SET ended_at=NOW() WHERE business_id=$1 AND ended_at IS NULL AND ends_at > NOW() RETURNING id, deputy_user_id, membership_id', [businessId]);
  for (const d of rows) await db.query('DELETE FROM membership_permission_overrides WHERE membership_id=$1 AND reason=$2', [d.membership_id, `deputy:${d.id}`]);
  return rows;
}
async function deputyState(businessId) {
  const { rows } = await pool.query(`SELECT d.*, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS deputy_name, (d.ended_at IS NULL AND d.ends_at > NOW()) AS active
    FROM business_deputies d JOIN users u ON u.id=d.deputy_user_id WHERE d.business_id=$1 ORDER BY d.created_at DESC LIMIT 10`, [businessId]);
  const { rows: candidates } = await pool.query(`SELECT m.member_id AS id, m.role, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name FROM business_members m JOIN users u ON u.id=m.member_id
    WHERE m.business_id=$1 AND m.status='active' AND m.role IN ('manager','representative') AND (m.access_valid_until IS NULL OR m.access_valid_until > NOW()) ORDER BY 3`, [businessId]);
  return { current: rows.find(r => r.active) || null, history: rows, candidates, codes: DEPUTY_CODES };
}
async function designateDeputy(businessId, actorId, body) {
  const userId = uuid(body?.user_id, 'user_id');
  const endsAt = isoDate(body.ends_at, 'ends_at');
  const ms = new Date(endsAt) - Date.now();
  if (ms <= 0 || ms > MAX_DEPUTY_DAYS * 864e5) invalid('ends_at');
  const note = text(body.note, 500, { required: false });
  const row = await withTransaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`biz-deputy:${businessId}`]);
    const m = await activeMember(db, businessId, userId);
    if (!m || m.owner || !['manager', 'representative'].includes(m.membership.role)) fail(409, 'deputy_not_eligible');
    const { rows: [cur] } = await db.query('SELECT id FROM business_deputies WHERE business_id=$1 AND ended_at IS NULL AND ends_at > NOW()', [businessId]);
    if (cur) fail(409, 'deputy_exists');
    const { rows: [d] } = await db.query('INSERT INTO business_deputies(business_id, deputy_user_id, membership_id, ends_at, note, created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [businessId, userId, m.membership.id, endsAt, note, actorId]);
    // Only codes without an existing override are granted; explicit denies win.
    const { rows: granted } = await db.query(`INSERT INTO membership_permission_overrides(membership_id, permission_id, effect, reason, granted_by_user_id, expires_at)
      SELECT $1, p.id, 'allow', $2, $3, $4 FROM team_permissions p WHERE p.code = ANY($5::text[])
      ON CONFLICT (membership_id, permission_id) DO NOTHING RETURNING permission_id`, [m.membership.id, `deputy:${d.id}`, actorId, endsAt, DEPUTY_CODES]);
    const { rows: codes } = await db.query('SELECT code FROM team_permissions WHERE id = ANY($1::int[]) ORDER BY code', [granted.map(g => g.permission_id)]);
    const { rows: [out] } = await db.query('UPDATE business_deputies SET granted_codes=$2 WHERE id=$1 RETURNING *', [d.id, codes.map(c => c.code)]);
    await db.query('UPDATE business_members SET permission_version = COALESCE(permission_version,0) + 1 WHERE id=$1', [m.membership.id]);
    await audit(db, businessId, actorId, 'business.deputy.designated', 'business_member', m.membership.id, { ends_at: endsAt, codes: out.granted_codes });
    return out;
  }, 'business_deputy_designate');
  permissions.invalidateCache(businessId, userId);
  await notify(userId, 'business_deputy_designated', { businessId }, `deputy:${row.id}`, consoleUrl(businessId));
  return row;
}
async function endDeputy(businessId, actorId) {
  const ended = await withTransaction(pool, async db => {
    const rows = await endDeputies(db, businessId);
    if (!rows.length) fail(404, 'not_found');
    for (const d of rows) {
      await db.query('UPDATE business_members SET permission_version = COALESCE(permission_version,0) + 1 WHERE id=$1', [d.membership_id]);
      await audit(db, businessId, actorId, 'business.deputy.ended', 'business_member', d.membership_id, null);
    }
    return rows;
  }, 'business_deputy_end');
  for (const d of ended) permissions.invalidateCache(businessId, d.deputy_user_id);
  return { ended: ended.length };
}

// ── 243 open work transition ────────────────────────────────────────────
const OPEN_APPTS = `SELECT a.id, a.start_time, a.end_time, a.status, a.customer_name, a.service_id, s.name AS service_name
  FROM business_appointments a LEFT JOIN business_services s ON s.id=a.service_id
  WHERE a.business_id=$1 AND a.staff_id=$2 AND a.status IN ('pending','confirmed') AND a.start_time > NOW() ORDER BY a.start_time`;
async function workPreview(businessId, fromUserId) {
  const from = uuid(fromUserId, 'from');
  const [{ rows: appointments }, { rows: tasks }] = await Promise.all([
    pool.query(`${OPEN_APPTS} LIMIT 500`, [businessId, from]),
    pool.query("SELECT id, title, kind, due_at FROM business_team_tasks WHERE business_id=$1 AND assignee_id=$2 AND status='open' ORDER BY due_at NULLS LAST LIMIT 500", [businessId, from]),
  ]);
  return { appointments, tasks };
}
async function transitionWork(businessId, actorId, body) {
  const from = uuid(body?.from_user_id, 'from_user_id');
  const to = body.to_user_id ? uuid(body.to_user_id, 'to_user_id') : null;
  if (to === from) invalid('to_user_id');
  const reason = text(body.reason, 300, { required: false });
  const only = Array.isArray(body.appointment_ids) ? body.appointment_ids.map(String) : null;
  const result = await withTransaction(pool, async db => {
    if (to && !(await activeMember(db, businessId, to))) fail(409, 'target_not_active');
    const { rows: appts } = await db.query(`${OPEN_APPTS} FOR UPDATE OF a`, [businessId, from]);
    const moved = [], skipped = [];
    for (const a of appts) {
      if (only && !only.includes(String(a.id))) continue;
      if (to) {
        const { rows: [qualified] } = await db.query(`SELECT EXISTS (SELECT 1 FROM business_service_staff WHERE service_id=$1 AND staff_id=$2 AND is_available) AS ok`, [a.service_id, to]);
        if (!qualified.ok) { skipped.push({ id: a.id, reason: 'not_qualified' }); continue; }
        const { rows: [clash] } = await db.query(`SELECT 1 FROM business_appointments WHERE business_id=$1 AND staff_id=$2 AND id<>$3
            AND status IN ('pending','confirmed','in_progress') AND start_time < $5 AND end_time > $4 LIMIT 1`, [businessId, to, a.id, a.start_time, a.end_time]);
        if (clash) { skipped.push({ id: a.id, reason: 'conflict' }); continue; }
      }
      await db.query("UPDATE business_appointments SET staff_id=$2, dispatch_status=CASE WHEN $2::uuid IS NULL THEN NULL ELSE 'pending' END, dispatch_responded_at=NULL, updated_at=NOW() WHERE id=$1", [a.id, to]);
      await db.query(`INSERT INTO business_appointment_assignment_events(appointment_id, business_id, from_staff_id, to_staff_id, actor_id, source, reason)
        VALUES($1,$2,$3,$4,$5,'transfer',$6)`, [a.id, businessId, from, to, actorId, reason]);
      moved.push(a.id);
    }
    let tasks = 0;
    if (body.include_tasks !== false && to) {
      ({ rowCount: tasks } = await db.query("UPDATE business_team_tasks SET assignee_id=$3, version=version+1 WHERE business_id=$1 AND assignee_id=$2 AND status='open'", [businessId, from, to]));
    }
    await audit(db, businessId, actorId, 'business.work.transitioned', 'user', from, { to_user_id: to, appointments: moved.length, tasks });
    return { moved, skipped, tasks };
  }, 'business_work_transition');
  if (to && (result.moved.length || result.tasks)) {
    await notify(to, 'business_work_transferred', { businessId, count: result.moved.length + result.tasks }, `work-transition:${businessId}:${from}:${to}:${Date.now()}`, `/business/${businessId}/workspace/my-work`);
  }
  return result;
}

// ── 244 record access after departure ───────────────────────────────────
const ACCESS_UNTIL = `COALESCE(o.former_access_until, GREATEST(o.retain_until::timestamptz, o.removed_at + make_interval(years => ${FORMER_ACCESS_YEARS})))`;
async function departed(businessId) {
  const { rows } = await pool.query(`SELECT o.id, o.user_id, o.removed_at, o.reason, o.retain_until, o.rehire_eligible, ${ACCESS_UNTIL} AS access_until,
      TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name,
      (SELECT COUNT(*)::int FROM business_time_entries te WHERE te.business_id=o.business_id AND te.user_id=o.user_id AND te.voided_at IS NULL) AS time_entries,
      (SELECT COUNT(*)::int FROM business_appointments a WHERE a.business_id=o.business_id AND a.staff_id=o.user_id AND a.status='completed') AS visits,
      EXISTS (SELECT 1 FROM business_members m WHERE m.business_id=o.business_id AND m.member_id=o.user_id AND m.status='active') AS rejoined
    FROM staff_offboarding_records o LEFT JOIN users u ON u.id=o.user_id WHERE o.business_id=$1 ORDER BY o.removed_at DESC LIMIT 200`, [businessId]);
  return { departed: rows, default_years: FORMER_ACCESS_YEARS };
}
async function setFormerAccess(businessId, actorId, recordId, body) {
  const id = int(recordId, { min: 1, field: 'record' });
  const until = isoDate(body?.former_access_until, 'former_access_until');
  if (new Date(until) > new Date(Date.now() + 7 * 365.25 * 864e5)) invalid('former_access_until');
  const { rows: [r] } = await pool.query(`UPDATE staff_offboarding_records o SET former_access_until = GREATEST($3::timestamptz, o.removed_at + make_interval(years => ${FORMER_ACCESS_YEARS}))
    WHERE o.id=$1 AND o.business_id=$2 RETURNING o.id, o.former_access_until`, [id, businessId, until]);
  if (!r) fail(404, 'not_found');
  await audit(pool, businessId, actorId, 'business.former_access.updated', 'offboarding_record', id, { former_access_until: r.former_access_until });
  return r;
}
// Former staff: read-only view of their own records at businesses they left.
async function myFormerWorkplaces(userId) {
  const { rows: places } = await pool.query(`SELECT DISTINCT ON (o.business_id) o.business_id, b.business_name, o.removed_at, ${ACCESS_UNTIL} AS access_until
    FROM staff_offboarding_records o JOIN businesses b ON b.id=o.business_id
    WHERE o.user_id=$1 AND ${ACCESS_UNTIL} > NOW()
      AND NOT EXISTS (SELECT 1 FROM business_members m WHERE m.business_id=o.business_id AND m.member_id=$1 AND m.status='active')
    ORDER BY o.business_id, o.removed_at DESC`, [userId]);
  const out = [];
  for (const p of places) {
    const [{ rows: entries }, { rows: [visits] }] = await Promise.all([
      pool.query(`SELECT entry_date, hours_worked, clock_in_at, clock_out_at, description, approved_by IS NOT NULL AS approved FROM business_time_entries
        WHERE business_id=$1 AND user_id=$2 AND voided_at IS NULL ORDER BY entry_date DESC LIMIT 500`, [p.business_id, userId]),
      pool.query("SELECT COUNT(*)::int AS completed FROM business_appointments WHERE business_id=$1 AND staff_id=$2 AND status='completed'", [p.business_id, userId]),
    ]);
    out.push({ ...p, time_entries: entries, total_hours: entries.reduce((n, e) => n + Number(e.hours_worked || 0), 0), completed_visits: visits.completed });
  }
  return { workplaces: out };
}

// ── 245 closure checklist ───────────────────────────────────────────────
async function closureChecklist(businessId) {
  const { rows: [c] } = await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM business_appointments WHERE business_id=$1 AND status IN ('pending','confirmed','in_progress') AND end_time > NOW()) AS future_bookings,
      (SELECT COUNT(*)::int FROM business_invoices WHERE business_id=$1 AND status IN ('sent','partial','overdue') AND COALESCE(total,0) > COALESCE(amount_paid,0)) AS unpaid_invoices,
      (SELECT COUNT(*)::int FROM money_movement_approvals WHERE movement_type='job_refund' AND payload->>'businessId'=$1::text AND status IN ('pending','approved')) AS pending_refunds,
      (SELECT COUNT(*)::int FROM business_service_issues WHERE business_id=$1 AND status IN ('open','in_review')) AS open_service_issues,
      (SELECT COUNT(*)::int FROM business_quotes WHERE business_id=$1 AND status='sent') AS open_quotes,
      (SELECT COUNT(*)::int FROM business_members WHERE business_id=$1 AND status='active') AS active_team,
      (SELECT COUNT(*)::int FROM business_service_locations WHERE business_id=$1 AND status IN ('active','paused','setup')) AS open_locations,
      (SELECT COUNT(*)::int FROM business_ownership_transfers WHERE business_id=$1 AND status IN ('pending','awaiting_admin')) AS open_transfers`, [businessId]);
  const { rows: [plan] } = await pool.query('SELECT * FROM business_closure_plans WHERE business_id=$1', [businessId]);
  const blocking = ['future_bookings', 'unpaid_invoices', 'pending_refunds', 'open_service_issues', 'open_transfers'];
  const advisory = ['open_quotes', 'active_team', 'open_locations'];
  const items = [...blocking.map(k => ({ key: k, count: c[k], blocking: true, done: c[k] === 0 })), ...advisory.map(k => ({ key: k, count: c[k], blocking: false, done: c[k] === 0 })),
    { key: 'data_export', blocking: true, done: !!plan?.export_confirmed_at }];
  return { items, plan: plan || null, ready: items.every(i => !i.blocking || i.done) };
}
async function saveClosurePlan(businessId, actorId, body) {
  const target = body?.target_date ? (/^\d{4}-\d{2}-\d{2}$/.test(body.target_date) ? body.target_date : invalid('target_date')) : null;
  const reason = text(body.reason, 500, { required: false });
  const message = text(body.customer_message, 2000, { required: false });
  const exportConfirmed = body.export_confirmed === true;
  const { rows: [row] } = await pool.query(`INSERT INTO business_closure_plans(business_id, target_date, reason, customer_message, export_confirmed_at, export_confirmed_by, updated_by)
      VALUES($1,$2,$3,$4,CASE WHEN $5 THEN NOW() END,CASE WHEN $5 THEN $6::uuid END,$6)
    ON CONFLICT (business_id) DO UPDATE SET target_date=EXCLUDED.target_date, reason=EXCLUDED.reason, customer_message=EXCLUDED.customer_message,
      export_confirmed_at = CASE WHEN $5 THEN COALESCE(business_closure_plans.export_confirmed_at, NOW()) ELSE NULL END,
      export_confirmed_by = CASE WHEN $5 THEN COALESCE(business_closure_plans.export_confirmed_by, $6::uuid) ELSE NULL END,
      version = business_closure_plans.version + 1, updated_by=$6, updated_at=NOW()
    WHERE $7::int IS NULL OR business_closure_plans.version = $7::int RETURNING *`, [businessId, target, reason, message, exportConfirmed, actorId, body.expectedVersion ?? null]);
  if (!row) fail(409, 'conflict');
  return row;
}

module.exports = {
  transferState, requestTransfer, respondTransfer, cancelTransfer, adminQueue, adminDecide,
  deputyState, designateDeputy, endDeputy, workPreview, transitionWork, departed, setFormerAccess, myFormerWorkplaces,
  closureChecklist, saveClosurePlan, DEPUTY_CODES, ownerOf,
};
