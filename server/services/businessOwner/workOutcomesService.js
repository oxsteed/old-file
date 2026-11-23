'use strict';
// Groups 5-6 items 281-283, 285: job completion records (optionally required
// before a visit can be marked completed), material usage notes, the
// assignment audit trail a worker can see, and low-rating feedback routing.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, int, notify } = require('./common');
const { workedAppointment, canManage, routeTarget } = require('./teamCommon');
const { policyRow } = require('./policyService');

const consoleUrl = id => `/business/${id}/workspace/owner-console`;
const readable = (db, b, a, u, ctx, code = 'jobs.view_all') => workedAppointment(db, b, a, u, { allowManager: canManage(ctx.role, ctx.permissions, code) });

// 281
async function completion(businessId, userId, ctx, appointmentId) {
  const { appt } = await readable(pool, businessId, appointmentId, userId, ctx);
  const { rows: [r] } = await pool.query(`SELECT c.*, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS recorded_by_name FROM business_appointment_completions c
    LEFT JOIN users u ON u.id=c.recorded_by WHERE c.appointment_id=$1`, [appt.id]);
  const policy = await policyRow(pool, businessId);
  return { record: r || null, required: !!policy.require_completion_record };
}
async function saveCompletion(businessId, userId, ctx, appointmentId, body) {
  const summary = text(body?.summary, 2000, { min: 5 });
  const followUp = body.follow_up_needed === true;
  const followNote = text(body.follow_up_note, 1000, { required: followUp });
  const signoff = text(body.customer_signoff_name, 120, { required: false });
  const row = await withTransaction(pool, async db => {
    const { appt, assignee, crewRole, manager } = await readable(db, businessId, appointmentId, userId, ctx, 'jobs.edit');
    if (!assignee && crewRole !== 'lead' && !manager) fail(403, 'forbidden');
    if (['cancelled', 'no_show'].includes(appt.status)) fail(409, 'invalid_status_transition');
    const { rows: [cur] } = await db.query('SELECT version FROM business_appointment_completions WHERE appointment_id=$1 FOR UPDATE', [appt.id]);
    if (cur && body.expectedVersion != null && Number(body.expectedVersion) !== cur.version) fail(409, 'conflict');
    const { rows: [r] } = await db.query(`INSERT INTO business_appointment_completions(appointment_id,business_id,summary,follow_up_needed,follow_up_note,customer_signoff_name,recorded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (appointment_id) DO UPDATE SET summary=EXCLUDED.summary, follow_up_needed=EXCLUDED.follow_up_needed,
        follow_up_note=EXCLUDED.follow_up_note, customer_signoff_name=EXCLUDED.customer_signoff_name, recorded_by=EXCLUDED.recorded_by,
        version=business_appointment_completions.version+1, updated_at=NOW() RETURNING *`, [appt.id, businessId, summary, followUp, followNote, signoff, userId]);
    return r;
  }, 'business_completion_save');
  if (row.follow_up_needed && row.version === 1) await notify(await routeTarget(pool, businessId, userId), 'business_job_follow_up', { businessId }, `follow:${row.appointment_id}`, consoleUrl(businessId));
  return row;
}
// Called inside the status transaction (businessAppointmentsController).
async function assertCompletionRecord(db, businessId, appointmentId) {
  const policy = await policyRow(db, businessId);
  if (!policy.require_completion_record) return;
  const { rows } = await db.query('SELECT 1 FROM business_appointment_completions WHERE appointment_id=$1', [appointmentId]);
  if (!rows.length) fail(409, 'completion_record_required', 'Add a completion record before marking this visit completed');
}

// 282
async function materials(businessId, userId, ctx, appointmentId) {
  const { appt } = await readable(pool, businessId, appointmentId, userId, ctx);
  const { rows } = await pool.query(`SELECT m.*, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS recorded_by_name FROM business_appointment_materials m
    LEFT JOIN users u ON u.id=m.recorded_by WHERE m.appointment_id=$1 ORDER BY m.created_at`, [appt.id]);
  return { materials: rows, total_cost_cents: rows.reduce((n, r) => n + Number(r.cost_cents || 0), 0) };
}
async function addMaterial(businessId, userId, ctx, appointmentId, body) {
  const name = text(body?.name, 120);
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e6) invalid('quantity');
  const unit = text(body.unit, 20, { required: false });
  const cost = body.cost_cents == null || body.cost_cents === '' ? null : int(body.cost_cents, { min: 0, max: 1e9, field: 'cost_cents' });
  const note = text(body.note, 300, { required: false });
  const { appt } = await readable(pool, businessId, appointmentId, userId, ctx, 'jobs.edit');
  if (['cancelled', 'no_show'].includes(appt.status)) fail(409, 'invalid_status_transition');
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM business_appointment_materials WHERE appointment_id=$1', [appt.id]);
  if (n >= 200) fail(409, 'materials_limit');
  const { rows: [r] } = await pool.query(`INSERT INTO business_appointment_materials(appointment_id,business_id,name,quantity,unit,cost_cents,note,recorded_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [appt.id, businessId, name, quantity, unit, cost, note, userId]);
  return r;
}
async function removeMaterial(businessId, userId, ctx, materialId) {
  const id = int(materialId, { min: 1, field: 'material' });
  const { rows: [m] } = await pool.query('SELECT * FROM business_appointment_materials WHERE id=$1 AND business_id=$2', [id, businessId]);
  if (!m) fail(404, 'not_found');
  if (String(m.recorded_by) !== String(userId) && !canManage(ctx.role, ctx.permissions, 'jobs.edit')) fail(403, 'forbidden');
  await pool.query('DELETE FROM business_appointment_materials WHERE id=$1', [id]);
  return { deleted: true };
}

// 283: who held the job, who moved it, and when.
async function assignmentHistory(businessId, userId, ctx, appointmentId) {
  const { appt } = await readable(pool, businessId, appointmentId, userId, ctx);
  const { rows } = await pool.query(`SELECT * FROM (
      SELECT e.created_at AS at, e.source AS event, e.from_staff_id AS from_user, e.to_staff_id AS to_user, e.actor_id, e.reason AS detail
        FROM business_appointment_assignment_events e WHERE e.appointment_id=$1
      UNION ALL SELECT c.allocated_at, 'crew_added', NULL, c.user_id, c.allocated_by, c.role FROM business_appointment_crew c WHERE c.appointment_id=$1
      UNION ALL SELECT c.responded_at, 'crew_' || c.attendance, NULL, c.user_id, c.user_id, NULL FROM business_appointment_crew c WHERE c.appointment_id=$1 AND c.responded_at IS NOT NULL
      UNION ALL SELECT a.dispatch_responded_at, 'dispatch_' || a.dispatch_status, NULL, a.staff_id, a.staff_id, a.dispatch_note FROM business_appointments a WHERE a.id=$1 AND a.dispatch_responded_at IS NOT NULL
    ) t ORDER BY at`, [appt.id]);
  const ids = [...new Set(rows.flatMap(r => [r.from_user, r.to_user, r.actor_id]).filter(Boolean).map(String))];
  const { rows: users } = ids.length ? await pool.query("SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name FROM users WHERE id = ANY($1::uuid[])", [ids]) : { rows: [] };
  const name = Object.fromEntries(users.map(u => [String(u.id), u.name]));
  return { events: rows.map(r => ({ ...r, from_name: name[r.from_user] || null, to_name: name[r.to_user] || null, actor_name: name[r.actor_id] || null })) };
}

// 285: 1-3 star visit feedback becomes a follow-up for the closest manager.
async function syncFeedback(businessId) {
  const { rows } = await pool.query(`INSERT INTO business_feedback_followups(business_id,appointment_id,rating,staff_id)
    SELECT a.business_id, a.id, COALESCE(f.rating, a.feedback_rating), a.staff_id FROM business_appointments a
    LEFT JOIN LATERAL (SELECT rating FROM appointment_feedback WHERE appointment_id=a.id ORDER BY created_at DESC LIMIT 1) f ON TRUE
    WHERE a.business_id=$1 AND COALESCE(f.rating, a.feedback_rating) BETWEEN 1 AND 3 AND a.updated_at > NOW() - INTERVAL '180 days'
    ON CONFLICT (appointment_id) DO NOTHING RETURNING *`, [businessId]);
  for (const r of rows) {
    const to = await routeTarget(pool, businessId, r.staff_id);
    await pool.query('UPDATE business_feedback_followups SET routed_to=$2 WHERE id=$1', [r.id, to]);
    await notify(to, 'business_feedback_follow_up', { businessId }, `fb:${r.id}`, consoleUrl(businessId));
  }
  return rows.length;
}
const FB_SELECT = `SELECT f.*, a.start_time, a.customer_name, s.name AS service_name, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS staff_name,
    (SELECT feedback_text FROM appointment_feedback x WHERE x.appointment_id=f.appointment_id ORDER BY created_at DESC LIMIT 1) AS feedback_text
  FROM business_feedback_followups f JOIN business_appointments a ON a.id=f.appointment_id LEFT JOIN business_services s ON s.id=a.service_id
  LEFT JOIN users u ON u.id=f.staff_id`;
async function feedbackQueue(businessId, userId, ctx, query) {
  await syncFeedback(businessId);
  const status = query?.status === 'closed' ? ['resolved'] : ['open', 'contacted'];
  const all = canManage(ctx.role, ctx.permissions, 'jobs.view_all');
  const { rows } = await pool.query(`${FB_SELECT} WHERE f.business_id=$1 AND f.status = ANY($2::text[]) AND ($3 OR f.routed_to=$4) ORDER BY f.rating, f.created_at LIMIT 200`,
    [businessId, status, all, userId]);
  return { followups: rows };
}
// The worker sees feedback on their own visits (no customer contact details).
async function myFeedback(businessId, userId) {
  const { rows } = await pool.query(`SELECT a.id AS appointment_id, a.start_time, s.name AS service_name, COALESCE(f.rating, a.feedback_rating) AS rating, f.feedback_text,
      fu.status AS follow_up_status FROM business_appointments a LEFT JOIN business_services s ON s.id=a.service_id
    LEFT JOIN LATERAL (SELECT rating, feedback_text FROM appointment_feedback WHERE appointment_id=a.id ORDER BY created_at DESC LIMIT 1) f ON TRUE
    LEFT JOIN business_feedback_followups fu ON fu.appointment_id=a.id
    WHERE a.business_id=$1 AND a.staff_id=$2 AND COALESCE(f.rating, a.feedback_rating) IS NOT NULL ORDER BY a.start_time DESC LIMIT 100`, [businessId, userId]);
  return { feedback: rows };
}
async function updateFollowup(businessId, userId, ctx, followupId, body) {
  const id = int(followupId, { min: 1, field: 'followup' });
  if (!['contacted', 'resolved'].includes(body?.status)) invalid('status');
  const note = text(body.note, 1000, { required: body.status === 'resolved' });
  const { rows: [f] } = await pool.query('SELECT * FROM business_feedback_followups WHERE id=$1 AND business_id=$2', [id, businessId]);
  if (!f) fail(404, 'not_found');
  if (String(f.routed_to) !== String(userId) && !canManage(ctx.role, ctx.permissions, 'jobs.view_all')) fail(403, 'forbidden');
  if (String(f.staff_id) === String(userId)) fail(403, 'self_review');
  if (f.status === 'resolved') fail(409, 'invalid_transition');
  const { rows: [r] } = await pool.query('UPDATE business_feedback_followups SET status=$2, note=COALESCE($3,note), handled_by=$4, handled_at=NOW() WHERE id=$1 RETURNING *', [id, body.status, note, userId]);
  return r;
}

module.exports = { completion, saveCompletion, assertCompletionRecord, materials, addMaterial, removeMaterial, assignmentHistory, syncFeedback, feedbackQueue, myFeedback, updateFollowup };
