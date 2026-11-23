'use strict';
// Groups 5-6 items 291-300: shift handovers, task owner replacement, absence
// delegation, unfinished work transfer, end-of-shift review, and leaving a
// business scope (pending action summary, workspace cleanup, return to the
// personal Home; remaining access is the former-workplace view, item 244).
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, uuid, int, isoDate, notify } = require('./common');
const { tz, isStaff, canManage, routeTarget, OPEN_STATUSES } = require('./teamCommon');

const myWorkUrl = id => `/business/${id}/workspace/my-work`;
async function audit(db, businessId, actorId, action, targetType, targetId, after) {
  await db.query(`INSERT INTO business_audit_log(business_id, actor_user_id, actor_role, action, target_type, target_id, after_state)
    VALUES($1,$2,NULL,$3,$4,$5,$6)`, [businessId, actorId, action, targetType, String(targetId), after || null]);
}
async function taskEvent(db, taskId, businessId, from, to, actor, reason) {
  await db.query('INSERT INTO business_team_task_events(task_id,business_id,from_user_id,to_user_id,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)', [taskId, businessId, from, to, actor, reason || null]);
}

// 291
async function handovers(businessId, userId) {
  const { rows } = await pool.query(`SELECT h.*, TRIM(CONCAT(f.first_name,' ',f.last_name)) AS from_name, TRIM(CONCAT(t.first_name,' ',t.last_name)) AS to_name
    FROM business_shift_handovers h LEFT JOIN users f ON f.id=h.from_user_id LEFT JOIN users t ON t.id=h.to_user_id
    WHERE h.business_id=$1 AND (h.from_user_id=$2 OR h.to_user_id=$2 OR (h.to_user_id IS NULL AND h.from_user_id<>$2)) ORDER BY h.created_at DESC LIMIT 50`, [businessId, userId]);
  return { received: rows.filter(r => String(r.from_user_id) !== String(userId)), sent: rows.filter(r => String(r.from_user_id) === String(userId)) };
}
async function createHandover(businessId, userId, body) {
  const summary = text(body?.summary, 2000, { min: 5 });
  const to = body.to_user_id ? uuid(body.to_user_id, 'to_user_id') : null;
  if (to && (to === String(userId) || !(await isStaff(pool, businessId, to)))) invalid('to_user_id');
  const items = Array.isArray(body.open_items) ? body.open_items : [];
  if (items.length > 30) invalid('open_items');
  const clean = items.map(i => ({ label: text(typeof i === 'string' ? i : i?.label, 200) }));
  const shiftId = body.shift_id ? int(body.shift_id, { min: 1, field: 'shift' }) : null;
  if (shiftId) {
    const { rows } = await pool.query('SELECT 1 FROM business_staff_shifts WHERE id=$1 AND business_id=$2 AND user_id=$3', [shiftId, businessId, userId]);
    if (!rows.length) invalid('shift_id');
  }
  const { rows: [h] } = await pool.query(`INSERT INTO business_shift_handovers(business_id,from_user_id,to_user_id,shift_id,summary,open_items)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [businessId, userId, to, shiftId, summary, JSON.stringify(clean)]);
  await notify(to || await routeTarget(pool, businessId, userId), 'business_shift_handover', { businessId }, `handover:${h.id}`, myWorkUrl(businessId));
  return h;
}
async function acknowledgeHandover(businessId, userId, handoverId) {
  const id = int(handoverId, { min: 1, field: 'handover' });
  const { rows: [h] } = await pool.query(`UPDATE business_shift_handovers SET acknowledged_at=COALESCE(acknowledged_at,NOW())
    WHERE id=$1 AND business_id=$2 AND from_user_id<>$3 AND (to_user_id=$3 OR to_user_id IS NULL) RETURNING *`, [id, businessId, userId]);
  if (!h) fail(404, 'not_found');
  await pool.query(`INSERT INTO business_handoff_acknowledgments(business_id,user_id,handover_id) VALUES($1,$2,$3)
    ON CONFLICT (user_id, COALESCE(appointment_id::text,''), COALESCE(handover_id,0)) DO NOTHING`, [businessId, userId, id]);
  return h;
}

// 292: a manager replaces a task's owner; 294: a member hands their own open
// tasks to a teammate. Both leave a task event trail.
async function moveTasks(db, businessId, actorId, fromUser, toUser, taskIds, reason) {
  const { rows } = await db.query(`SELECT id, assignee_id FROM business_team_tasks WHERE business_id=$1 AND status='open' AND id::text = ANY($2::text[])
    ${fromUser ? 'AND assignee_id=$3' : ''} FOR UPDATE`, fromUser ? [businessId, taskIds, fromUser] : [businessId, taskIds]);
  if (rows.length !== taskIds.length) fail(404, 'not_found');
  for (const t of rows) {
    if (String(t.assignee_id) === String(toUser)) invalid('to_user_id');
    await db.query('UPDATE business_team_tasks SET assignee_id=$2, version=version+1 WHERE id=$1', [t.id, toUser]);
    await taskEvent(db, t.id, businessId, t.assignee_id, toUser, actorId, reason);
  }
  return rows.length;
}
async function replaceTaskOwner(businessId, actorId, taskId, body) {
  const to = uuid(body?.to_user_id, 'to_user_id');
  const reason = text(body.reason, 300, { required: false });
  const moved = await withTransaction(pool, async db => {
    if (!(await isStaff(db, businessId, to))) invalid('to_user_id');
    return moveTasks(db, businessId, actorId, null, to, [String(taskId)], reason);
  }, 'business_task_replace');
  await notify(to, 'business_task_assigned_to_you', { businessId }, `task-move:${taskId}:${to}`, myWorkUrl(businessId));
  return { moved };
}
async function transferUnfinished(businessId, userId, body) {
  const to = uuid(body?.to_user_id, 'to_user_id');
  if (to === String(userId)) invalid('to_user_id');
  const ids = Array.isArray(body.task_ids) ? [...new Set(body.task_ids.map(String))] : invalid('task_ids');
  if (!ids.length || ids.length > 100) invalid('task_ids');
  const reason = text(body.reason, 300, { required: false });
  const moved = await withTransaction(pool, async db => {
    if (!(await isStaff(db, businessId, to))) invalid('to_user_id');
    const n = await moveTasks(db, businessId, userId, userId, to, ids, reason);
    await audit(db, businessId, userId, 'business.work.unfinished_transferred', 'user', userId, { to_user_id: to, tasks: n });
    return n;
  }, 'business_unfinished_transfer');
  await notify(to, 'business_task_assigned_to_you', { businessId }, `task-xfer:${userId}:${to}:${ids.sort().join(',').slice(0, 60)}`, myWorkUrl(businessId));
  return { moved };
}
async function taskHistory(businessId, userId, ctx, taskId) {
  const { rows: [t] } = await pool.query('SELECT id, assignee_id, created_by FROM business_team_tasks WHERE id::text=$1 AND business_id=$2', [String(taskId), businessId]);
  if (!t) fail(404, 'not_found');
  const { rows } = await pool.query(`SELECT e.*, TRIM(CONCAT(f.first_name,' ',f.last_name)) AS from_name, TRIM(CONCAT(o.first_name,' ',o.last_name)) AS to_name
    FROM business_team_task_events e LEFT JOIN users f ON f.id=e.from_user_id LEFT JOIN users o ON o.id=e.to_user_id WHERE e.task_id=$1 ORDER BY e.created_at`, [t.id]);
  const involved = String(t.assignee_id) === String(userId) || String(t.created_by) === String(userId) || rows.some(r => [String(r.from_user_id), String(r.to_user_id)].includes(String(userId)));
  if (!involved && !canManage(ctx.role, ctx.permissions)) fail(404, 'not_found');
  return { events: rows };
}

// 293: a member proposes a stand-in for an absence; on acceptance, open tasks
// due in the window move to the delegate. Visits are listed for a manager to
// reassign (a delegate is not auto-dispatched to customers).
async function delegations(businessId, userId) {
  const { rows } = await pool.query(`SELECT d.*, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS user_name, TRIM(CONCAT(g.first_name,' ',g.last_name)) AS delegate_name
    FROM business_absence_delegations d LEFT JOIN users u ON u.id=d.user_id LEFT JOIN users g ON g.id=d.delegate_id
    WHERE d.business_id=$1 AND (d.user_id=$2 OR d.delegate_id=$2) AND d.ends_at > NOW() - INTERVAL '30 days' ORDER BY d.starts_at DESC LIMIT 50`, [businessId, userId]);
  return { mine: rows.filter(r => String(r.user_id) === String(userId)), covering: rows.filter(r => String(r.delegate_id) === String(userId)) };
}
async function proposeDelegation(businessId, userId, body) {
  const delegate = uuid(body?.delegate_id, 'delegate_id');
  if (delegate === String(userId) || !(await isStaff(pool, businessId, delegate))) invalid('delegate_id');
  const starts = isoDate(body.starts_at, 'starts_at'), ends = isoDate(body.ends_at, 'ends_at');
  if (new Date(ends) <= new Date(starts) || new Date(ends) - new Date(starts) > 90 * 864e5 || new Date(ends) < new Date()) invalid('ends_at');
  const note = text(body.note, 500, { required: false });
  const { rows: overlap } = await pool.query(`SELECT 1 FROM business_absence_delegations WHERE business_id=$1 AND user_id=$2 AND status IN ('proposed','accepted')
    AND starts_at < $4 AND ends_at > $3`, [businessId, userId, starts, ends]);
  if (overlap.length) fail(409, 'delegation_overlap');
  const { rows: [d] } = await pool.query(`INSERT INTO business_absence_delegations(business_id,user_id,delegate_id,starts_at,ends_at,note)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [businessId, userId, delegate, starts, ends, note]);
  await notify(delegate, 'business_delegation_proposed', { businessId }, `deleg:${d.id}`, myWorkUrl(businessId));
  return d;
}
async function respondDelegation(businessId, userId, delegationId, body) {
  const id = int(delegationId, { min: 1, field: 'delegation' });
  if (!['accept', 'decline', 'cancel'].includes(body?.response)) invalid('response');
  const out = await withTransaction(pool, async db => {
    const { rows: [d] } = await db.query('SELECT * FROM business_absence_delegations WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, businessId]);
    if (!d) fail(404, 'not_found');
    const isOwner = String(d.user_id) === String(userId), isDelegate = String(d.delegate_id) === String(userId);
    if (body.response === 'cancel' ? !isOwner : !isDelegate) fail(404, 'not_found');
    if (body.response === 'cancel' ? !['proposed', 'accepted'].includes(d.status) : d.status !== 'proposed') fail(409, 'invalid_transition');
    let moved = 0, visits = [];
    if (body.response === 'accept') {
      if (!(await isStaff(db, businessId, d.user_id))) fail(409, 'member_inactive');
      const { rows: tasks } = await db.query("SELECT id FROM business_team_tasks WHERE business_id=$1 AND assignee_id=$2 AND status='open' AND due_at < $3", [businessId, d.user_id, d.ends_at]);
      if (tasks.length) moved = await moveTasks(db, businessId, userId, d.user_id, d.delegate_id, tasks.map(t => String(t.id)), 'absence_delegation');
      ({ rows: visits } = await db.query(`SELECT id FROM business_appointments WHERE business_id=$1 AND staff_id=$2 AND status = ANY($5::text[])
        AND start_time < $4 AND end_time > $3`, [businessId, d.user_id, d.starts_at, d.ends_at, OPEN_STATUSES]));
    }
    const status = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[body.response];
    const { rows: [r] } = await db.query('UPDATE business_absence_delegations SET status=$2, responded_at=NOW(), moved_count=moved_count+$3, skipped_count=$4 WHERE id=$1 RETURNING *',
      [id, status, moved, visits.length]);
    return { delegation: r, visits_needing_manager: visits.map(v => v.id) };
  }, 'business_delegation_respond');
  const d = out.delegation;
  if (body.response !== 'cancel') await notify(d.user_id, 'business_delegation_answered', { businessId }, `deleg-ans:${d.id}`, myWorkUrl(businessId));
  if (out.visits_needing_manager.length) await notify(await routeTarget(pool, businessId, d.user_id), 'business_delegation_visits', { businessId, count: out.visits_needing_manager.length }, `deleg-visits:${d.id}`, `/business/${businessId}/workspace/owner-console`);
  return out;
}

// 295
async function endOfShift(businessId, userId) {
  const zone = await tz(pool, businessId);
  const { rows: [{ d }] } = await pool.query('SELECT timezone($1, NOW())::date AS d', [zone]);
  const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
  const [visits, tasks, exceptions, handoversOut, saved] = await Promise.all([
    q(`SELECT a.id, a.status, s.name AS service_name, a.start_time,
        NOT EXISTS (SELECT 1 FROM business_appointment_completions c WHERE c.appointment_id=a.id) AS missing_completion,
        (SELECT COUNT(*)::int FROM business_appointment_checklist_items i WHERE i.appointment_id=a.id AND i.required AND i.done_at IS NULL) AS required_open
      FROM business_appointments a LEFT JOIN business_services s ON s.id=a.service_id
      WHERE a.business_id=$1 AND a.staff_id=$2 AND timezone($3, a.start_time)::date=$4 AND a.status IN ('confirmed','in_progress','completed') ORDER BY a.start_time`, [businessId, userId, zone, d]),
    q("SELECT id, title, due_at FROM business_team_tasks WHERE business_id=$1 AND assignee_id=$2 AND status='open' AND timezone($3, due_at)::date <= $4 ORDER BY due_at", [businessId, userId, zone, d]),
    q("SELECT id, kind, description, status FROM business_work_exceptions WHERE business_id=$1 AND raised_by=$2 AND status IN ('open','acknowledged')", [businessId, userId]),
    q('SELECT COUNT(*)::int AS n FROM business_shift_handovers WHERE business_id=$1 AND from_user_id=$2 AND timezone($3, created_at)::date=$4', [businessId, userId, zone, d]),
    q('SELECT * FROM business_shift_reviews WHERE business_id=$1 AND user_id=$2 AND review_date=$3', [businessId, userId, d]),
  ]);
  const unresolved = {
    in_progress: visits.filter(v => v.status === 'in_progress').map(v => v.id),
    missing_completion: visits.filter(v => v.status === 'completed' && v.missing_completion).map(v => v.id),
    required_checklist_open: visits.filter(v => v.required_open > 0).map(v => v.id),
    open_tasks: tasks.map(t => t.id), open_exceptions: exceptions.map(e => e.id),
  };
  return { date: d, visits, tasks, exceptions, handover_sent: handoversOut[0].n > 0, unresolved, review: saved[0] || null };
}
async function saveEndOfShift(businessId, userId, body) {
  const notes = text(body?.notes, 2000, { required: false });
  const summary = await endOfShift(businessId, userId);
  const { rows: [r] } = await pool.query(`INSERT INTO business_shift_reviews(business_id,user_id,review_date,notes,unresolved) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (business_id,user_id,review_date) DO UPDATE SET notes=EXCLUDED.notes, unresolved=EXCLUDED.unresolved RETURNING *`, [businessId, userId, summary.date, notes, JSON.stringify(summary.unresolved)]);
  return r;
}

// 297: what is still on you before you leave.
async function leavePreview(businessId, userId) {
  const { rows: [b] } = await pool.query('SELECT user_id, business_name FROM businesses WHERE id=$1', [businessId]);
  const { rows: [c] } = await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM business_appointments WHERE business_id=$1 AND staff_id=$2 AND status IN ('pending','confirmed','in_progress') AND end_time > NOW()) AS upcoming_visits,
      (SELECT COUNT(*)::int FROM business_appointments WHERE business_id=$1 AND staff_id=$2 AND status='in_progress') AS in_progress_visits,
      (SELECT COUNT(*)::int FROM business_appointment_crew c JOIN business_appointments a ON a.id=c.appointment_id WHERE c.business_id=$1 AND c.user_id=$2 AND a.status IN ('pending','confirmed') AND a.end_time > NOW()) AS crew_spots,
      (SELECT COUNT(*)::int FROM business_team_tasks WHERE business_id=$1 AND assignee_id=$2 AND status='open') AS open_tasks,
      (SELECT COUNT(*)::int FROM business_work_exceptions WHERE business_id=$1 AND routed_to=$2 AND status IN ('open','acknowledged')) AS exceptions_routed_to_me,
      (SELECT COUNT(*)::int FROM business_shift_coverage_requests WHERE business_id=$1 AND claimed_by=$2 AND status='claimed') AS coverage_claims,
      (SELECT COUNT(*)::int FROM business_staff_shifts WHERE business_id=$1 AND user_id=$2 AND cancelled_at IS NULL AND shift_date >= CURRENT_DATE) AS future_shifts,
      (SELECT COUNT(*)::int FROM business_time_entries WHERE business_id=$1 AND user_id=$2 AND clock_out_at IS NULL AND clock_in_at IS NOT NULL AND voided_at IS NULL) AS open_clock_ins`, [businessId, userId]);
  const isOwner = String(b.user_id) === String(userId);
  const blockers = [];
  if (isOwner) blockers.push('owner_must_transfer');
  if (c.in_progress_visits) blockers.push('visit_in_progress');
  if (c.open_clock_ins) blockers.push('clocked_in');
  return { business_name: b.business_name, counts: c, blockers, can_leave: !blockers.length,
    after_leaving: { work_moves_to: isOwner ? null : 'manager', former_access: 'time_entries_and_visit_history', former_access_years: 3 } };
}
// 298-299: leave the scope. Open work moves to the closest manager, the
// workspace context is cleared, and the client returns to the personal Home.
async function leave(businessId, userId, body) {
  if (body?.confirm !== true) invalid('confirm');
  const reason = text(body.reason, 300, { required: false });
  const pre = await leavePreview(businessId, userId);
  if (!pre.can_leave) fail(409, pre.blockers[0]);
  const { applyStaffOffboarding } = require('../staffOffboarding');
  const out = await withTransaction(pool, async db => {
    const { rows: [m] } = await db.query("SELECT id, role FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active' FOR UPDATE", [businessId, userId]);
    if (!m) fail(404, 'not_found');
    const to = await routeTarget(db, businessId, userId);
    await db.query("UPDATE business_shift_coverage_requests SET status='cancelled' WHERE business_id=$1 AND requester_id=$2 AND status IN ('open','claimed')", [businessId, userId]);
    await db.query("UPDATE business_shift_coverage_requests SET status='open', claimed_by=NULL, claimed_at=NULL WHERE business_id=$1 AND claimed_by=$2 AND status='claimed'", [businessId, userId]);
    await db.query("UPDATE business_work_exceptions SET routed_to=$3, updated_at=NOW(), version=version+1 WHERE business_id=$1 AND routed_to=$2 AND status IN ('open','acknowledged')", [businessId, userId, to]);
    await db.query("DELETE FROM business_appointment_crew c USING business_appointments a WHERE a.id=c.appointment_id AND c.business_id=$1 AND c.user_id=$2 AND a.status IN ('pending','confirmed')", [businessId, userId]);
    await db.query("UPDATE business_absence_delegations SET status='cancelled' WHERE business_id=$1 AND (user_id=$2 OR delegate_id=$2) AND status IN ('proposed','accepted') AND ends_at > NOW()", [businessId, userId]);
    await db.query("UPDATE business_members SET status='revoked' WHERE id=$1", [m.id]);
    const offboarding = await applyStaffOffboarding(db, { businessId, userId, reason: reason ? `Left: ${reason}` : 'Member left the business', membershipId: m.id, removedBy: userId, reassignToUserId: to, revokeAccountSessions: false });
    await db.query('DELETE FROM user_workspace_contexts WHERE user_id=$1 AND business_id=$2', [userId, businessId]);
    await audit(db, businessId, userId, 'business.member.left', 'business_member', m.id, { role: m.role, reassigned_to: to });
    return { to, offboarding };
  }, 'business_member_leave');
  try { require('../permissionsService').invalidateCache(businessId, userId); } catch { /* cache is best-effort */ }
  const { rows: [b] } = await pool.query('SELECT user_id FROM businesses WHERE id=$1', [businessId]);
  await notify(b.user_id, 'business_member_left', { businessId }, `left:${businessId}:${userId}`, `/business/${businessId}/workspace/team`);
  return { left: true, redirect: '/dashboard', work_moved_to: out.to, former_workplaces: '/api/me/former-workplaces' };
}

module.exports = { handovers, createHandover, acknowledgeHandover, replaceTaskOwner, transferUnfinished, taskHistory, delegations, proposeDelegation, respondDelegation,
  endOfShift, saveEndOfShift, leavePreview, leave };
