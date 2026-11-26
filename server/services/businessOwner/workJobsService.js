'use strict';
// Groups 5-6 items 261-262, 264-270, 286-290: the member's work board, visit
// checklists, progress reports, routed exceptions (missing instructions,
// incidents, access problems, reassignment requests) with escalation, and
// crews (roster, allocation, subcontractors, assignment-only documents,
// attendance).
const pool = require('../../db');
const logger = require('../../utils/logger');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, uuid, int, notify } = require('./common');
const { tz, isStaff, workedAppointment, canManage, routeTarget, fitFor } = require('./teamCommon');
const { listIncomingForProvider } = require('../bookingRequestLifecycle');

const myWorkUrl = id => `/business/${id}/workspace/my-work`;
const consoleUrl = id => `/business/${id}/workspace/owner-console`;
const mine = `(a.staff_id=$2 OR EXISTS (SELECT 1 FROM business_appointment_crew c WHERE c.appointment_id=a.id AND c.user_id=$2 AND c.attendance <> 'declined'))`;

// 261
async function board(businessId, userId) {
  const zone = await tz(pool, businessId);
  const { rows } = await pool.query(`SELECT a.id, a.start_time, a.end_time, a.status, a.customer_name, a.dispatch_status, a.staff_id = $2 AS is_assignee,
      s.name AS service_name, (timezone($3, a.start_time))::date = (timezone($3, NOW()))::date AS today,
      (SELECT role FROM business_appointment_crew c WHERE c.appointment_id=a.id AND c.user_id=$2) AS crew_role,
      (SELECT attendance FROM business_appointment_crew c WHERE c.appointment_id=a.id AND c.user_id=$2) AS attendance,
      (SELECT COUNT(*)::int FROM business_appointment_checklist_items i WHERE i.appointment_id=a.id) AS checklist_total,
      (SELECT COUNT(*)::int FROM business_appointment_checklist_items i WHERE i.appointment_id=a.id AND i.done_at IS NOT NULL) AS checklist_done,
      EXISTS (SELECT 1 FROM business_appointment_completions r WHERE r.appointment_id=a.id) AS has_completion_record,
      (SELECT percent FROM business_appointment_progress p WHERE p.appointment_id=a.id AND p.percent IS NOT NULL ORDER BY p.created_at DESC LIMIT 1) AS progress
    FROM business_appointments a LEFT JOIN business_services s ON s.id=a.service_id
    WHERE a.business_id=$1 AND ${mine} AND (a.status='in_progress' OR (a.status IN ('pending','confirmed') AND a.end_time > NOW() - INTERVAL '12 hours' AND a.start_time < NOW() + INTERVAL '14 days')
      OR (a.status='completed' AND a.completed_at > NOW() - INTERVAL '2 days'))
    ORDER BY a.start_time LIMIT 200`, [businessId, userId, zone]);
  const { rows: tasks } = await pool.query("SELECT id, title, kind, due_at, status FROM business_team_tasks WHERE business_id=$1 AND assignee_id=$2 AND status='open' ORDER BY due_at LIMIT 100", [businessId, userId]);
  // D-460 (261, G5-41): the requests half of "My work". Incoming booking
  // requests for this business come from the same inbox read the queue
  // panel uses (read-side expiry and conflict flags included); a request
  // is "mine" when the member is its provider (helper_id), which covers
  // dispatched members (dispatch sets helper_id). Managers see every
  // pending business request; other members see their own plus the
  // business queue, and the UI's Mine filter narrows to is_mine.
  let requests = [];
  try {
    const incoming = await listIncomingForProvider(userId);
    requests = incoming
      .filter((r) => r.businessId === businessId && ['pending', 'counter_proposed'].includes(r.status))
      .map((r) => ({
        id: r.id, status: r.status, customer_name: r.customerName, service_name: r.serviceName,
        requested_date: r.requestedDate, requested_start_time: r.requestedStartTime,
        description: r.description, dispatch_status: r.dispatchStatus || null,
        is_mine: String(r.helperId) === String(userId), can_respond: r.canRespond,
      }));
  } catch (err) {
    // The appointments board must not die with the inbox read; the queue
    // panel is the fallback surface for requests.
    logger.warn('My work board: incoming requests unavailable', { businessId, error: err.message });
  }
  const lanes = { in_progress: [], today: [], upcoming: [], to_confirm: [], finish_up: [] };
  for (const a of rows) {
    if (a.status === 'completed') { if (!a.has_completion_record) lanes.finish_up.push(a); continue; }
    if (a.status === 'in_progress') lanes.in_progress.push(a);
    else if (a.today) lanes.today.push(a);
    else lanes.upcoming.push(a);
    if ((a.is_assignee && a.dispatch_status === 'pending') || (!a.is_assignee && a.attendance === 'pending')) lanes.to_confirm.push(a);
  }
  return { lanes, tasks, requests };
}

// 262
async function readable(db, businessId, appointmentId, userId, ctx) {
  return workedAppointment(db, businessId, appointmentId, userId, { allowManager: canManage(ctx.role, ctx.permissions, 'jobs.view_all') });
}
async function checklist(businessId, userId, ctx, appointmentId) {
  return withTransaction(pool, async db => {
    const { appt } = await readable(db, businessId, appointmentId, userId, ctx);
    let { rows: items } = await db.query('SELECT * FROM business_appointment_checklist_items WHERE appointment_id=$1 ORDER BY position, id', [appt.id]);
    if (!items.length) {
      const { rows: [tpl] } = await db.query('SELECT items FROM business_service_checklists WHERE service_id=$1', [appt.service_id]);
      const seeded = await db.query("SELECT 1 FROM business_appointment_checklist_items WHERE appointment_id=$1 LIMIT 1", [appt.id]);
      if (tpl && Array.isArray(tpl.items) && tpl.items.length && !seeded.rows.length) {
        for (const [i, it] of tpl.items.entries()) await db.query('INSERT INTO business_appointment_checklist_items(appointment_id,label,position,required) VALUES($1,$2,$3,$4)', [appt.id, it.label, i, it.required !== false]);
        ({ rows: items } = await db.query('SELECT * FROM business_appointment_checklist_items WHERE appointment_id=$1 ORDER BY position, id', [appt.id]));
      }
    }
    return { appointment_id: appt.id, items, done: items.filter(i => i.done_at).length, required_open: items.filter(i => i.required && !i.done_at).length };
  }, 'business_checklist_read');
}
async function addChecklistItem(businessId, userId, ctx, appointmentId, body) {
  const label = text(body?.label, 160);
  const { appt } = await workedAppointment(pool, businessId, appointmentId, userId, { allowManager: canManage(ctx.role, ctx.permissions, 'jobs.edit') });
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM business_appointment_checklist_items WHERE appointment_id=$1', [appt.id]);
  if (n >= 100) fail(409, 'checklist_limit');
  const { rows: [row] } = await pool.query('INSERT INTO business_appointment_checklist_items(appointment_id,label,position,required) VALUES($1,$2,$3,$4) RETURNING *', [appt.id, label, n, body.required !== false]);
  return row;
}
async function setChecklistItem(businessId, userId, ctx, appointmentId, itemId, body) {
  const id = int(itemId, { min: 1, field: 'item' });
  const { appt } = await workedAppointment(pool, businessId, appointmentId, userId, { allowManager: canManage(ctx.role, ctx.permissions, 'jobs.edit') });
  if (['completed', 'cancelled'].includes(appt.status) && !canManage(ctx.role, ctx.permissions, 'jobs.edit')) fail(409, 'invalid_status_transition');
  const { rows: [row] } = await pool.query(`UPDATE business_appointment_checklist_items SET done_at = CASE WHEN $3 THEN COALESCE(done_at, NOW()) ELSE NULL END,
    done_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END WHERE id=$1 AND appointment_id=$2 RETURNING *`, [id, appt.id, body?.done === true, userId]);
  if (!row) fail(404, 'not_found');
  return row;
}
async function setServiceChecklist(businessId, actorId, serviceId, body) {
  const sid = int(serviceId, { min: 1, field: 'service' });
  const items = Array.isArray(body?.items) ? body.items : invalid('items');
  if (items.length > 50) invalid('items');
  const clean = items.map(i => ({ label: text(i?.label, 160), required: i?.required !== false }));
  const { rows: [s] } = await pool.query('SELECT id FROM business_services WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL', [sid, businessId]);
  if (!s) fail(404, 'not_found');
  const { rows: [row] } = await pool.query(`INSERT INTO business_service_checklists(service_id,items,updated_by) VALUES($1,$2,$3)
    ON CONFLICT (service_id) DO UPDATE SET items=EXCLUDED.items, updated_by=EXCLUDED.updated_by, updated_at=NOW() RETURNING *`, [sid, JSON.stringify(clean), actorId]);
  return row;
}
async function serviceChecklists(businessId) {
  const { rows } = await pool.query(`SELECT s.id AS service_id, s.name, COALESCE(c.items, '[]'::jsonb) AS items FROM business_services s
    LEFT JOIN business_service_checklists c ON c.service_id=s.id WHERE s.business_id=$1 AND s.deleted_at IS NULL ORDER BY s.name`, [businessId]);
  return { services: rows };
}

// 264
async function addProgress(businessId, userId, appointmentId, body) {
  const note = text(body?.note, 1000);
  const percent = body.percent == null || body.percent === '' ? null : int(body.percent, { min: 0, max: 100, field: 'percent' });
  const { appt } = await workedAppointment(pool, businessId, appointmentId, userId);
  if (['cancelled', 'no_show'].includes(appt.status)) fail(409, 'invalid_status_transition');
  const { rows: [row] } = await pool.query('INSERT INTO business_appointment_progress(appointment_id,business_id,author_id,percent,note) VALUES($1,$2,$3,$4,$5) RETURNING *', [appt.id, businessId, userId, percent, note]);
  return row;
}
async function progress(businessId, userId, ctx, appointmentId) {
  const { appt } = await readable(pool, businessId, appointmentId, userId, ctx);
  const { rows } = await pool.query(`SELECT p.*, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS author_name FROM business_appointment_progress p LEFT JOIN users u ON u.id=p.author_id
    WHERE p.appointment_id=$1 ORDER BY p.created_at DESC LIMIT 100`, [appt.id]);
  return { updates: rows };
}

// 265, 286-290
const KINDS = {
  exception: ['customer_not_home', 'access_issue', 'scope_change', 'parts_missing', 'weather', 'other'],
  missing_instruction: ['address', 'scope', 'access_code', 'materials', 'customer_contact', 'other'],
  incident: ['injury', 'property_damage', 'vehicle', 'safety_hazard', 'customer_conduct', 'other'],
  access_denied: ['permission', 'location', 'document', 'other'],
  reassignment_request: ['schedule', 'skills', 'workload', 'personal', 'other'],
};
const overdueSql = `(e.status='open' AND e.created_at + make_interval(hours => COALESCE(p.escalation_hours,4) * (e.escalation_level + 1)) < NOW())`;
async function raiseException(businessId, userId, ctx, body) {
  const kind = body?.kind;
  if (!KINDS[kind]) invalid('kind');
  if (!KINDS[kind].includes(body.category)) invalid('category');
  const severity = body.severity || (kind === 'incident' ? 'high' : 'normal');
  if (!['low', 'normal', 'high', 'critical'].includes(severity)) invalid('severity');
  const description = text(body.description, 2000, { min: 5 });
  const requestId = typeof body.request_id === 'string' && body.request_id.length <= 80 ? body.request_id : invalid('request_id');
  let appointmentId = null, taskId = null, aboutUser = userId;
  if (body.appointment_id) {
    const { appt } = await workedAppointment(pool, businessId, body.appointment_id, userId, { allowManager: canManage(ctx.role, ctx.permissions, 'jobs.view_all') });
    appointmentId = appt.id; aboutUser = appt.staff_id || userId;
  }
  if (body.task_id) {
    const { rows: [t] } = await pool.query('SELECT id FROM business_team_tasks WHERE id::text=$1 AND business_id=$2 AND assignee_id=$3', [String(body.task_id), businessId, userId]);
    if (!t) fail(404, 'not_found');
    taskId = t.id;
  }
  const routed = await routeTarget(pool, businessId, aboutUser === userId ? userId : aboutUser);
  const { rows: [row] } = await pool.query(`INSERT INTO business_work_exceptions(business_id,appointment_id,task_id,raised_by,request_id,kind,category,severity,description,routed_to)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (raised_by, request_id) DO NOTHING RETURNING *`,
  [businessId, appointmentId, taskId, userId, requestId, kind, body.category, severity, description, String(routed) === String(userId) ? null : routed]);
  if (!row) {
    const { rows: [dup] } = await pool.query('SELECT * FROM business_work_exceptions WHERE raised_by=$1 AND request_id=$2 AND business_id=$3', [userId, requestId, businessId]);
    if (!dup) fail(409, 'conflict');
    return dup;
  }
  if (row.routed_to) await notify(row.routed_to, 'business_work_exception_raised', { businessId }, `exc:${row.id}`, consoleUrl(businessId));
  if (severity === 'critical') {
    const { rows: [b] } = await pool.query('SELECT user_id FROM businesses WHERE id=$1', [businessId]);
    if (String(b.user_id) !== String(row.routed_to)) await notify(b.user_id, 'business_work_exception_raised', { businessId }, `exc-owner:${row.id}`, consoleUrl(businessId));
  }
  return row;
}
const EXC_SELECT = `SELECT e.*, ${overdueSql} AS overdue, TRIM(CONCAT(r.first_name,' ',r.last_name)) AS raised_by_name, TRIM(CONCAT(t.first_name,' ',t.last_name)) AS routed_to_name,
    s.name AS service_name, a.start_time
  FROM business_work_exceptions e LEFT JOIN business_operating_policies p ON p.business_id=e.business_id
  LEFT JOIN users r ON r.id=e.raised_by LEFT JOIN users t ON t.id=e.routed_to
  LEFT JOIN business_appointments a ON a.id=e.appointment_id LEFT JOIN business_services s ON s.id=a.service_id`;
async function myExceptions(businessId, userId) {
  const { rows } = await pool.query(`${EXC_SELECT} WHERE e.business_id=$1 AND (e.raised_by=$2 OR e.routed_to=$2) ORDER BY e.created_at DESC LIMIT 100`, [businessId, userId]);
  return { raised: rows.filter(r => String(r.raised_by) === String(userId)), routed_to_me: rows.filter(r => String(r.routed_to) === String(userId) && ['open', 'acknowledged'].includes(r.status)), kinds: KINDS };
}
async function exceptionQueue(businessId, query) {
  const status = query?.status === 'closed' ? ['resolved', 'dismissed'] : ['open', 'acknowledged'];
  const { rows } = await pool.query(`${EXC_SELECT} WHERE e.business_id=$1 AND e.status = ANY($2::text[]) ORDER BY (e.severity='critical') DESC, e.created_at LIMIT 200`, [businessId, status]);
  return { exceptions: rows };
}
async function updateException(businessId, userId, ctx, exceptionId, body) {
  const id = int(exceptionId, { min: 1, field: 'exception' });
  if (!['acknowledged', 'resolved', 'dismissed'].includes(body?.status)) invalid('status');
  const resolution = text(body.resolution, 1000, { required: body.status !== 'acknowledged' });
  const reassignTo = body?.reassign_to_user_id ? uuid(body.reassign_to_user_id, 'reassign_to_user_id') : null;
  const row = await withTransaction(pool, async db => {
    const { rows: [e] } = await db.query('SELECT * FROM business_work_exceptions WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, businessId]);
    if (!e) fail(404, 'not_found');
    if (String(e.routed_to) !== String(userId) && !canManage(ctx.role, ctx.permissions, 'jobs.view_all')) fail(403, 'forbidden');
    if (String(e.raised_by) === String(userId) && body.status !== 'acknowledged') fail(403, 'self_review');
    if (body.expectedVersion != null && Number(body.expectedVersion) !== e.version) fail(409, 'conflict');
    if (['resolved', 'dismissed'].includes(e.status)) fail(409, 'invalid_transition');
    // 292 (G5-21): resolving a reassignment request applies the move.
    // A task-linked request moves the team's own task to the chosen
    // member in this transaction (assignee change + task event trail +
    // notice to the new assignee). An appointment-linked request has
    // no target applied here: appointments reassign through the
    // calendar path, which enforces the service-assignment and
    // window-free guards — a target on such a request is a 400, and
    // resolving without one closes the request as before.
    let reassignedTo = null;
    if (body.status === 'resolved' && e.kind === 'reassignment_request') {
      if (e.appointment_id && reassignTo) fail(400, 'appointment_reassign_use_calendar');
      if (e.task_id && reassignTo) {
        const { rows: [t] } = await db.query("SELECT id, assignee_id FROM business_team_tasks WHERE id=$1 AND business_id=$2 AND status='open' FOR UPDATE", [e.task_id, businessId]);
        if (!t) fail(404, 'not_found');
        if (String(t.assignee_id) === String(reassignTo)) invalid('reassign_to_user_id');
        if (!(await isStaff(db, businessId, reassignTo))) invalid('reassign_to_user_id');
        await db.query('UPDATE business_team_tasks SET assignee_id=$2, version=version+1 WHERE id=$1', [t.id, reassignTo]);
        await db.query('INSERT INTO business_team_task_events(task_id,business_id,from_user_id,to_user_id,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)', [t.id, businessId, t.assignee_id, reassignTo, userId, resolution]);
        reassignedTo = reassignTo;
      }
    }
    const { rows: [r] } = await db.query(`UPDATE business_work_exceptions SET status=$2, version=version+1, updated_at=NOW(),
        acknowledged_by=COALESCE(acknowledged_by,$3), acknowledged_at=COALESCE(acknowledged_at,NOW()),
        resolved_by=CASE WHEN $2 IN ('resolved','dismissed') THEN $3::uuid END, resolved_at=CASE WHEN $2 IN ('resolved','dismissed') THEN NOW() END,
        resolution=COALESCE($4, resolution) WHERE id=$1 RETURNING *`, [e.id, body.status, userId, resolution]);
    return { ...r, reassigned_to: reassignedTo };
  }, 'business_exception_update');
  await notify(row.raised_by, 'business_work_exception_updated', { businessId }, `exc-upd:${row.id}:${row.version}`, myWorkUrl(businessId));
  if (row.reassigned_to) await notify(row.reassigned_to, 'business_task_assigned_to_you', { businessId }, `task-move:${row.task_id}:${row.reassigned_to}`, myWorkUrl(businessId));
  return row;
}
// 289: the person who raised it can push an overdue item one level up (to the owner).
async function escalate(businessId, userId, exceptionId) {
  const id = int(exceptionId, { min: 1, field: 'exception' });
  const row = await withTransaction(pool, async db => {
    const { rows: [e] } = await db.query(`SELECT e.*, ${overdueSql} AS overdue FROM business_work_exceptions e LEFT JOIN business_operating_policies p ON p.business_id=e.business_id
      WHERE e.id=$1 AND e.business_id=$2 FOR UPDATE OF e`, [id, businessId]);
    if (!e || String(e.raised_by) !== String(userId)) fail(404, 'not_found');
    if (!e.overdue) fail(409, 'not_overdue');
    if (e.escalation_level >= 2) fail(409, 'max_escalation');
    const { rows: [b] } = await db.query('SELECT user_id FROM businesses WHERE id=$1', [businessId]);
    const { rows: [r] } = await db.query('UPDATE business_work_exceptions SET escalation_level=escalation_level+1, escalated_at=NOW(), routed_to=$2, version=version+1, updated_at=NOW() WHERE id=$1 RETURNING *', [e.id, b.user_id]);
    return r;
  }, 'business_exception_escalate');
  await notify(row.routed_to, 'business_work_exception_raised', { businessId }, `exc-esc:${row.id}:${row.escalation_level}`, consoleUrl(businessId));
  return row;
}

// 266-270 crews
async function crews(businessId) {
  const { rows } = await pool.query(`SELECT c.id, c.name, c.lead_user_id, c.is_active, TRIM(CONCAT(l.first_name,' ',l.last_name)) AS lead_name,
      COALESCE((SELECT json_agg(json_build_object('user_id', u.id, 'name', TRIM(CONCAT(u.first_name,' ',u.last_name)),
        'member_type', COALESCE((SELECT member_type FROM business_members bm WHERE bm.business_id=c.business_id AND bm.member_id=u.id AND bm.status='active' LIMIT 1),'staff')) ORDER BY u.first_name)
        FROM business_crew_members cm JOIN users u ON u.id=cm.user_id WHERE cm.crew_id=c.id), '[]') AS members
    FROM business_crews c LEFT JOIN users l ON l.id=c.lead_user_id WHERE c.business_id=$1 ORDER BY c.is_active DESC, LOWER(c.name)`, [businessId]);
  return { crews: rows };
}
async function saveCrew(businessId, actorId, body, crewId) {
  const name = text(body?.name, 60);
  const lead = body.lead_user_id ? uuid(body.lead_user_id, 'lead_user_id') : null;
  const members = Array.isArray(body.member_ids) ? [...new Set(body.member_ids.map(v => uuid(v, 'member_ids')))] : [];
  if (lead && !members.includes(lead)) members.push(lead);
  if (members.length > 50) invalid('member_ids');
  return withTransaction(pool, async db => {
    for (const m of members) if (!(await isStaff(db, businessId, m))) invalid('member_ids');
    let crew;
    try {
      if (crewId) {
        const id = int(crewId, { min: 1, field: 'crew' });
        ({ rows: [crew] } = await db.query('UPDATE business_crews SET name=$3, lead_user_id=$4, is_active=$5 WHERE id=$1 AND business_id=$2 RETURNING *', [id, businessId, name, lead, body.is_active !== false]));
        if (!crew) fail(404, 'not_found');
      } else {
        ({ rows: [crew] } = await db.query('INSERT INTO business_crews(business_id,name,lead_user_id,created_by) VALUES($1,$2,$3,$4) RETURNING *', [businessId, name, lead, actorId]));
      }
    } catch (e) { if (e.code === '23505') fail(409, 'crew_exists'); throw e; }
    await db.query('DELETE FROM business_crew_members WHERE crew_id=$1 AND NOT (user_id::text = ANY($2::text[]))', [crew.id, members]);
    for (const m of members) await db.query('INSERT INTO business_crew_members(crew_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [crew.id, m]);
    return crew;
  }, 'business_crew_save');
}
// 267: a visit's crew (beside the lead assignee).
async function appointmentCrew(businessId, userId, ctx, appointmentId) {
  const { appt } = await readable(pool, businessId, appointmentId, userId, ctx);
  const { rows } = await pool.query(`SELECT c.user_id, c.role, c.task_note, c.attendance, c.responded_at, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name
    FROM business_appointment_crew c JOIN users u ON u.id=c.user_id WHERE c.appointment_id=$1 ORDER BY c.role, u.first_name`, [appt.id]);
  return { appointment_id: appt.id, staff_id: appt.staff_id, crew: rows };
}
async function allocateCrew(businessId, actorId, appointmentId, body) {
  const list = Array.isArray(body?.members) ? body.members : invalid('members');
  if (list.length > 20) invalid('members');
  const members = list.map(m => ({ user_id: uuid(m?.user_id, 'user_id'), role: m.role === 'lead' ? 'lead' : 'member', task_note: text(m.task_note, 300, { required: false }) }));
  const added = await withTransaction(pool, async db => {
    const { rows: [a] } = await db.query('SELECT * FROM business_appointments WHERE id::text=$1 AND business_id=$2 FOR UPDATE', [String(appointmentId), businessId]);
    if (!a) fail(404, 'not_found');
    if (!['pending', 'confirmed', 'in_progress'].includes(a.status)) fail(409, 'invalid_status_transition');
    const ids = members.map(m => m.user_id);
    for (const id of ids) if (!(await isStaff(db, businessId, id)) || String(id) === String(a.staff_id)) invalid('members');
    const { rows: existing } = await db.query('SELECT user_id FROM business_appointment_crew WHERE appointment_id=$1', [a.id]);
    const had = new Set(existing.map(e => String(e.user_id)));
    const fresh = ids.filter(id => !had.has(String(id)));
    const fits = await fitFor(db, businessId, fresh, a);
    const clash = fits.filter(f => f.conflict || f.time_off).map(f => f.user_id);
    if (clash.length) fail(409, 'schedule_conflict', `Busy: ${clash.join(',')}`);
    await db.query('DELETE FROM business_appointment_crew WHERE appointment_id=$1 AND NOT (user_id::text = ANY($2::text[]))', [a.id, ids]);
    for (const m of members) {
      await db.query(`INSERT INTO business_appointment_crew(appointment_id,user_id,business_id,role,task_note,allocated_by) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT (appointment_id,user_id) DO UPDATE SET role=EXCLUDED.role, task_note=EXCLUDED.task_note`, [a.id, m.user_id, businessId, m.role, m.task_note, actorId]);
    }
    return { appointment: a, fresh };
  }, 'business_crew_allocate');
  for (const u of added.fresh) await notify(u, 'business_crew_allocated', { businessId }, `crew:${added.appointment.id}:${u}`, myWorkUrl(businessId));
  return appointmentCrew(businessId, actorId, { role: 'owner' }, appointmentId);
}
// Crew lead (or the assignee) splits the work.
async function setCrewTask(businessId, userId, appointmentId, memberId, body) {
  const note = text(body?.task_note, 300, { required: false });
  const { appt, assignee, crewRole } = await workedAppointment(pool, businessId, appointmentId, userId);
  if (!assignee && crewRole !== 'lead') fail(403, 'forbidden');
  const { rows: [r] } = await pool.query('UPDATE business_appointment_crew SET task_note=$3 WHERE appointment_id=$1 AND user_id::text=$2 RETURNING *', [appt.id, String(memberId), note]);
  if (!r) fail(404, 'not_found');
  return r;
}
// 270
async function respondAttendance(businessId, userId, appointmentId, body) {
  if (!['confirm', 'decline', 'check_in'].includes(body?.response)) invalid('response');
  const { appt } = await workedAppointment(pool, businessId, appointmentId, userId);
  if (['completed', 'cancelled', 'no_show'].includes(appt.status)) fail(409, 'invalid_status_transition');
  if (body.response === 'check_in' && new Date(appt.start_time) - Date.now() > 2 * 36e5) fail(409, 'too_early_to_check_in');
  const value = { confirm: 'confirmed', decline: 'declined', check_in: 'checked_in' }[body.response];
  const { rows: [r] } = await pool.query('UPDATE business_appointment_crew SET attendance=$3, responded_at=NOW() WHERE appointment_id=$1 AND user_id=$2 RETURNING *', [appt.id, userId, value]);
  if (!r) fail(404, 'not_found');
  if (value === 'declined') await notify(appt.staff_id || await routeTarget(pool, businessId, userId), 'business_crew_declined', { businessId }, `crew-decl:${appt.id}:${userId}`, myWorkUrl(businessId));
  return r;
}
// 268: invited subcontractors only see their own assignments.
const SUBCONTRACTOR_DENY = ['jobs.view_all', 'calendar.view_all', 'calendar.manage_all', 'customers.view_all', 'customers.export', 'messages.view_all', 'team.view',
  'invoices.view', 'payments.view', 'payouts.view', 'analytics.view_summary', 'analytics.view_ops', 'analytics.view_financial', 'statements.view', 'documents.view'];
async function applySubcontractorScope(db, membershipId, actorId, companyName) {
  await db.query("UPDATE business_members SET member_type='subcontractor', company_name=$2 WHERE id=$1", [membershipId, companyName || null]);
  await db.query(`INSERT INTO membership_permission_overrides(membership_id, permission_id, effect, reason, granted_by_user_id)
    SELECT $1, p.id, 'deny', 'subcontractor_scope', $2 FROM team_permissions p WHERE p.code = ANY($3::text[])
    ON CONFLICT (membership_id, permission_id) DO UPDATE SET effect='deny', reason='subcontractor_scope', expires_at=NULL`, [membershipId, actorId, SUBCONTRACTOR_DENY]);
}
// 269
async function documents(businessId, userId, ctx, appointmentId) {
  const { appt } = await readable(pool, businessId, appointmentId, userId, ctx);
  const { rows } = await pool.query(`SELECT d.id, d.title, d.body, d.url, d.created_at, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS uploaded_by_name
    FROM business_appointment_documents d LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.appointment_id=$1 ORDER BY d.created_at DESC`, [appt.id]);
  return { documents: rows };
}
async function addDocument(businessId, actorId, appointmentId, body) {
  const title = text(body?.title, 120);
  const docBody = text(body.body, 5000, { required: false });
  const url = body.url ? (typeof body.url === 'string' && /^https:\/\/[^\s]+$/.test(body.url) && body.url.length <= 500 ? body.url : invalid('url')) : null;
  if (!docBody && !url) invalid('body');
  const { rows: [a] } = await pool.query('SELECT id FROM business_appointments WHERE id::text=$1 AND business_id=$2', [String(appointmentId), businessId]);
  if (!a) fail(404, 'not_found');
  const { rows: [row] } = await pool.query('INSERT INTO business_appointment_documents(appointment_id,business_id,title,body,url,uploaded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [a.id, businessId, title, docBody, url, actorId]);
  return row;
}
async function removeDocument(businessId, documentId) {
  const id = int(documentId, { min: 1, field: 'document' });
  const { rowCount } = await pool.query('DELETE FROM business_appointment_documents WHERE id=$1 AND business_id=$2', [id, businessId]);
  if (!rowCount) fail(404, 'not_found');
  return { deleted: true };
}

// 264 (G5-17): the manager's work report for a date range: appointments by
// status, progress-record updates with author and service, open exceptions,
// and in-progress appointments stalled (no progress in 48h). Appointments
// only: the OxSteed-job (helper_job_work) half is out of scope (D-462).
function parseReportDate(value, fallback) {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid('from');
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw invalid('from');
  return value;
}
async function workReport(businessId, query = {}) {
  const to = parseReportDate(query.to, new Date().toISOString().slice(0, 10));
  const fromDate = new Date(`${to}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - 6);
  const from = parseReportDate(query.from, fromDate.toISOString().slice(0, 10));
  if (from > to) throw invalid('from');
  const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > 90) throw invalid('from');
  const [byStatus, updates, openExceptions, stalled] = await Promise.all([
    pool.query(`SELECT status, COUNT(*)::int AS n FROM business_appointments
      WHERE business_id=$1 AND start_time >= $2::date AND start_time < ($3::date + INTERVAL '1 day')
      GROUP BY status ORDER BY status`, [businessId, from, to]),
    pool.query(`SELECT p.percent, p.note, p.created_at, s.name AS service_name, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS author
      FROM business_appointment_progress p JOIN business_appointments a ON a.id=p.appointment_id
      LEFT JOIN business_services s ON s.id=a.service_id
      LEFT JOIN users u ON u.id=p.author_id
      WHERE a.business_id=$1 AND p.created_at >= $2::date AND p.created_at < ($3::date + INTERVAL '1 day')
      ORDER BY p.created_at DESC LIMIT 100`, [businessId, from, to]),
    pool.query("SELECT COUNT(*)::int AS n FROM business_work_exceptions WHERE business_id=$1 AND status IN ('open','acknowledged')", [businessId]),
    pool.query(`SELECT a.id, s.name AS service_name, a.start_time, MAX(p.created_at) AS last_progress
      FROM business_appointments a LEFT JOIN business_appointment_progress p ON p.appointment_id=a.id
      LEFT JOIN business_services s ON s.id=a.service_id
      WHERE a.business_id=$1 AND a.status='in_progress' AND a.start_time <= NOW()
      GROUP BY a.id, s.name, a.start_time
      HAVING MAX(p.created_at) IS NULL OR MAX(p.created_at) < NOW() - INTERVAL '48 hours'
      ORDER BY a.start_time LIMIT 50`, [businessId]),
  ]);
  return { range: { from, to }, appointments: { byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])), total: byStatus.rows.reduce((s, r) => s + r.n, 0) },
    progressUpdates: { count: updates.rows.length, items: updates.rows }, openExceptions: openExceptions.rows[0].n, stalled: stalled.rows };
}

module.exports = { board, checklist, addChecklistItem, setChecklistItem, setServiceChecklist, serviceChecklists, addProgress, progress,
  raiseException, myExceptions, exceptionQueue, updateException, escalate, KINDS, crews, saveCrew, appointmentCrew, allocateCrew, setCrewTask,
  respondAttendance, applySubcontractorScope, SUBCONTRACTOR_DENY, documents, addDocument, removeDocument, workReport };
