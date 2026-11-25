'use strict';
// Groups 5-6 items 273-275, 277, 280: participant handoff summary (with
// acknowledgment, 284), team mentions, the unread work inbox, shift coverage
// requests, and the daily workload view.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, uuid, int, notify } = require('./common');
const { tz, isStaff, workedAppointment, canManage, routeTarget, storeBoundary } = require('./teamCommon');

const myWorkUrl = id => `/business/${id}/workspace/my-work`;
const readable = (db, b, a, u, ctx) => workedAppointment(db, b, a, u, { allowManager: canManage(ctx.role, ctx.permissions, 'jobs.view_all') });

// 273 + 284: everything the next person needs before touching the job.
async function handoff(businessId, userId, ctx, appointmentId) {
  const { appt } = await readable(pool, businessId, appointmentId, userId, ctx);
  const [notes, checklist, progress, exceptions, docs, crew, ack, booking] = await Promise.all([
    pool.query(`SELECT n.id, n.note_type, n.content, n.is_pinned, n.created_at, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS author
      FROM business_appointment_notes n LEFT JOIN users u ON u.id=n.created_by_id WHERE n.appointment_id=$1 ORDER BY n.is_pinned DESC, n.created_at DESC LIMIT 20`, [appt.id]),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE done_at IS NOT NULL)::int AS done,
      COUNT(*) FILTER (WHERE required AND done_at IS NULL)::int AS required_open FROM business_appointment_checklist_items WHERE appointment_id=$1`, [appt.id]),
    pool.query('SELECT percent, note, created_at FROM business_appointment_progress WHERE appointment_id=$1 ORDER BY created_at DESC LIMIT 1', [appt.id]),
    pool.query("SELECT id, kind, category, severity, status, description FROM business_work_exceptions WHERE appointment_id=$1 AND status IN ('open','acknowledged') ORDER BY created_at", [appt.id]),
    pool.query('SELECT COUNT(*)::int AS n FROM business_appointment_documents WHERE appointment_id=$1', [appt.id]),
    pool.query(`SELECT c.user_id, c.role, c.task_note, c.attendance, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name FROM business_appointment_crew c JOIN users u ON u.id=c.user_id
      WHERE c.appointment_id=$1 ORDER BY c.role, u.first_name`, [appt.id]),
    pool.query('SELECT acknowledged_at FROM business_handoff_acknowledgments WHERE user_id=$1 AND appointment_id=$2 AND handover_id IS NULL', [userId, appt.id]),
    // D-461 (262, G5-25): the booking behind this appointment, so the
    // detail view can show the booking's visit checklist to the provider.
    pool.query('SELECT id FROM booking_requests WHERE business_appointment_id = $1 LIMIT 1', [appt.id]),
  ]);
  return {
    appointment: { id: appt.id, service_name: appt.service_name, start_time: appt.start_time, end_time: appt.end_time, status: appt.status,
      customer_name: appt.customer_name, customer_notes: appt.customer_notes || appt.notes || null, staff_id: appt.staff_id,
      booking_id: booking.rows[0]?.id || null },
    notes: notes.rows, checklist: checklist.rows[0], latest_progress: progress.rows[0] || null, open_exceptions: exceptions.rows,
    document_count: docs.rows[0].n, crew: crew.rows, acknowledged_at: ack.rows[0]?.acknowledged_at || null,
  };
}
async function acknowledgeHandoff(businessId, userId, appointmentId) {
  const { appt } = await workedAppointment(pool, businessId, appointmentId, userId);
  await pool.query(`INSERT INTO business_handoff_acknowledgments(business_id,user_id,appointment_id) VALUES($1,$2,$3)
    ON CONFLICT (user_id, COALESCE(appointment_id::text,''), COALESCE(handover_id,0)) DO NOTHING`, [businessId, userId, appt.id]);
  const { rows: [r] } = await pool.query('SELECT acknowledged_at FROM business_handoff_acknowledgments WHERE user_id=$1 AND appointment_id=$2 AND handover_id IS NULL', [userId, appt.id]);
  return r;
}

// 274: an internal job note that @mentions teammates who can see the job.
async function addNote(businessId, userId, ctx, appointmentId, body) {
  const content = text(body?.content, 4000);
  const mentionIds = Array.isArray(body.mention_user_ids) ? [...new Set(body.mention_user_ids.map(v => uuid(v, 'mention_user_ids')))] : [];
  if (mentionIds.length > 10) invalid('mention_user_ids');
  const out = await withTransaction(pool, async db => {
    const { appt } = await readable(db, businessId, appointmentId, userId, ctx);
    // Only people who can already see this job can be mentioned on it
    // (assignee, crew, managers, owner), so the note never leaks wider.
    for (const m of mentionIds) {
      if (String(m) === String(userId) || !(await isStaff(db, businessId, m))) invalid('mention_user_ids');
      const { rows: [ok] } = await db.query(`SELECT ($3::uuid = $4::uuid) OR EXISTS (SELECT 1 FROM business_appointment_crew WHERE appointment_id=$2 AND user_id=$3)
          OR EXISTS (SELECT 1 FROM businesses WHERE id=$1 AND user_id=$3)
          OR EXISTS (SELECT 1 FROM business_members WHERE business_id=$1 AND member_id=$3 AND status='active' AND role='manager') AS ok`, [businessId, appt.id, m, appt.staff_id]);
      if (!ok.ok) fail(409, 'mention_not_on_job');
    }
    const { rows: [note] } = await db.query("INSERT INTO business_appointment_notes(appointment_id,created_by_id,note_type,content) VALUES($1,$2,'internal',$3) RETURNING *", [appt.id, userId, content]);
    for (const m of mentionIds) {
      await db.query('INSERT INTO business_note_mentions(note_id,user_id,business_id,appointment_id,mentioned_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [note.id, m, businessId, appt.id, userId]);
    }
    return { note, mentioned: mentionIds };
  }, 'business_note_mention');
  for (const m of out.mentioned) await notify(m, 'business_team_mention', { businessId }, `mention:${out.note.id}:${m}`, myWorkUrl(businessId));
  return out;
}

// 275: one unread inbox across the work surfaces, with a last-seen marker.
async function inbox(businessId, userId) {
  const { rows: [st] } = await pool.query('SELECT last_seen_at FROM business_work_inbox_state WHERE business_id=$1 AND user_id=$2', [businessId, userId]);
  const since = st?.last_seen_at || new Date(0);
  const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
  const [mentions, dispatch, crew, exceptions, handovers, coverage] = await Promise.all([
    q(`SELECT m.note_id AS id, 'mention' AS kind, m.appointment_id, m.created_at, n.content AS preview, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS from_name
      FROM business_note_mentions m JOIN business_appointment_notes n ON n.id=m.note_id LEFT JOIN users u ON u.id=m.mentioned_by
      WHERE m.business_id=$1 AND m.user_id=$2 AND m.read_at IS NULL ORDER BY m.created_at DESC LIMIT 50`, [businessId, userId]),
    q(`SELECT a.id, 'dispatch' AS kind, a.id AS appointment_id, a.updated_at AS created_at, s.name AS preview FROM business_appointments a LEFT JOIN business_services s ON s.id=a.service_id
      WHERE a.business_id=$1 AND a.staff_id=$2 AND a.dispatch_status='pending' AND a.status IN ('pending','confirmed') AND a.end_time > NOW() ORDER BY a.start_time LIMIT 50`, [businessId, userId]),
    q(`SELECT a.id, 'crew' AS kind, a.id AS appointment_id, c.allocated_at AS created_at, s.name AS preview FROM business_appointment_crew c JOIN business_appointments a ON a.id=c.appointment_id
      LEFT JOIN business_services s ON s.id=a.service_id WHERE c.business_id=$1 AND c.user_id=$2 AND c.attendance='pending' AND a.status IN ('pending','confirmed') AND a.end_time > NOW() LIMIT 50`, [businessId, userId]),
    q(`SELECT e.id::text AS id, 'exception' AS kind, e.appointment_id, e.updated_at AS created_at, e.description AS preview FROM business_work_exceptions e
      WHERE e.business_id=$1 AND ((e.routed_to=$2 AND e.status='open') OR (e.raised_by=$2 AND e.status IN ('acknowledged','resolved','dismissed') AND e.updated_at > $3)) LIMIT 50`, [businessId, userId, since]),
    q(`SELECT h.id::text AS id, 'handover' AS kind, NULL::uuid AS appointment_id, h.created_at, h.summary AS preview FROM business_shift_handovers h
      WHERE h.business_id=$1 AND h.to_user_id=$2 AND h.acknowledged_at IS NULL LIMIT 50`, [businessId, userId]),
    q(`SELECT r.id::text AS id, 'coverage' AS kind, NULL::uuid AS appointment_id, r.created_at, r.reason AS preview FROM business_shift_coverage_requests r
      WHERE r.business_id=$1 AND r.requester_id=$2 AND r.status IN ('approved','declined') AND COALESCE(r.decided_at, r.created_at) > $3 LIMIT 50`, [businessId, userId, since]),
  ]);
  const items = [...mentions, ...dispatch, ...crew, ...exceptions, ...handovers, ...coverage]
    .map(i => ({ ...i, unread: new Date(i.created_at) > new Date(since) || i.kind === 'mention' }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { items, unread: items.filter(i => i.unread).length, last_seen_at: st?.last_seen_at || null };
}
async function markInboxSeen(businessId, userId, body) {
  if (body?.mention_note_id) {
    await pool.query('UPDATE business_note_mentions SET read_at=NOW() WHERE note_id::text=$1 AND user_id=$2 AND business_id=$3', [String(body.mention_note_id), userId, businessId]);
  } else {
    await pool.query('UPDATE business_note_mentions SET read_at=NOW() WHERE user_id=$1 AND business_id=$2 AND read_at IS NULL', [userId, businessId]);
    await pool.query(`INSERT INTO business_work_inbox_state(business_id,user_id,last_seen_at) VALUES($1,$2,NOW())
      ON CONFLICT (business_id,user_id) DO UPDATE SET last_seen_at=NOW()`, [businessId, userId]);
  }
  return inbox(businessId, userId);
}

// 277: ask a teammate to cover a shift; a manager approves before it moves.
const COVER_SELECT = `SELECT r.*, s.shift_date, s.start_time, s.end_time, s.role_label, TRIM(CONCAT(q.first_name,' ',q.last_name)) AS requester_name,
    TRIM(CONCAT(c.first_name,' ',c.last_name)) AS claimed_by_name FROM business_shift_coverage_requests r JOIN business_staff_shifts s ON s.id=r.shift_id
  LEFT JOIN users q ON q.id=r.requester_id LEFT JOIN users c ON c.id=r.claimed_by`;
async function coverage(businessId, userId, ctx) {
  const manager = canManage(ctx.role, ctx.permissions);
  const { rows } = await pool.query(`${COVER_SELECT} WHERE r.business_id=$1 AND (r.status IN ('open','claimed') OR r.requester_id=$2 OR r.claimed_by=$2)
    AND s.shift_date >= CURRENT_DATE - 1 AND ($3 OR r.requester_id=$2 OR ${storeBoundary('s.location_id', '$1', '$2')})
    ORDER BY s.shift_date, s.start_time LIMIT 200`, [businessId, userId, manager]);
  const { rows: myShifts } = await pool.query(`SELECT id, shift_date, start_time, end_time, role_label FROM business_staff_shifts
    WHERE business_id=$1 AND user_id=$2 AND cancelled_at IS NULL AND shift_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 ORDER BY shift_date, start_time LIMIT 60`, [businessId, userId]);
  return {
    my_shifts: myShifts,
    mine: rows.filter(r => String(r.requester_id) === String(userId)),
    available: rows.filter(r => r.status === 'open' && String(r.requester_id) !== String(userId)),
    awaiting_approval: manager ? rows.filter(r => r.status === 'claimed') : [],
  };
}
async function shiftFor(db, businessId, shiftId, lock) {
  const { rows: [s] } = await db.query(`SELECT * FROM business_staff_shifts WHERE id=$1 AND business_id=$2 AND cancelled_at IS NULL ${lock ? 'FOR UPDATE' : ''}`, [shiftId, businessId]);
  if (!s) fail(404, 'not_found');
  return s;
}
const shiftStart = (s, zone) => pool.query('SELECT ($1::date + $2::time) AT TIME ZONE $3 AS at', [s.shift_date, s.start_time, zone]).then(r => r.rows[0].at);
async function requestCoverage(businessId, userId, shiftId, body) {
  const id = int(shiftId, { min: 1, field: 'shift' });
  const reason = text(body?.reason, 300, { required: false });
  const zone = await tz(pool, businessId);
  const row = await withTransaction(pool, async db => {
    const s = await shiftFor(db, businessId, id, true);
    if (String(s.user_id) !== String(userId)) fail(404, 'not_found');
    if (new Date(await shiftStart(s, zone)) <= new Date()) fail(409, 'shift_started');
    try {
      const { rows: [r] } = await db.query('INSERT INTO business_shift_coverage_requests(business_id,shift_id,requester_id,reason) VALUES($1,$2,$3,$4) RETURNING *', [businessId, s.id, userId, reason]);
      return r;
    } catch (e) { if (e.code === '23505') fail(409, 'coverage_open'); throw e; }
  }, 'business_coverage_request');
  return row;
}
async function claimCoverage(businessId, userId, requestId) {
  const id = int(requestId, { min: 1, field: 'request' });
  const row = await withTransaction(pool, async db => {
    const { rows: [r] } = await db.query('SELECT * FROM business_shift_coverage_requests WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, businessId]);
    if (!r) fail(404, 'not_found');
    if (String(r.requester_id) === String(userId)) fail(409, 'own_request');
    if (r.status !== 'open') fail(409, 'invalid_transition');
    const s = await shiftFor(db, businessId, r.shift_id);
    const { rows: [vis] } = await db.query(`SELECT ${storeBoundary('$3::bigint', '$1', '$2')} AS ok`, [businessId, userId, s.location_id]);
    if (!vis.ok) fail(404, 'not_found');
    const { rows: overlap } = await db.query(`SELECT 1 FROM business_staff_shifts WHERE business_id=$1 AND user_id=$2 AND shift_date=$3 AND cancelled_at IS NULL
      AND start_time < $5 AND end_time > $4`, [businessId, userId, s.shift_date, s.start_time, s.end_time]);
    if (overlap.length) fail(409, 'schedule_conflict');
    const { rows: off } = await db.query("SELECT 1 FROM business_time_off_requests WHERE business_id=$1 AND user_id=$2 AND status='approved' AND $3::date BETWEEN start_date AND end_date", [businessId, userId, s.shift_date]);
    if (off.length) fail(409, 'time_off');
    const { rows: [u] } = await db.query("UPDATE business_shift_coverage_requests SET status='claimed', claimed_by=$2, claimed_at=NOW() WHERE id=$1 RETURNING *", [id, userId]);
    return u;
  }, 'business_coverage_claim');
  await notify(await routeTarget(pool, businessId, row.requester_id), 'business_coverage_claimed', { businessId }, `cov-claim:${row.id}:${userId}`, myWorkUrl(businessId));
  return row;
}
async function decideCoverage(businessId, actorId, requestId, body) {
  const id = int(requestId, { min: 1, field: 'request' });
  if (!['approve', 'decline'].includes(body?.decision)) invalid('decision');
  const row = await withTransaction(pool, async db => {
    const { rows: [r] } = await db.query('SELECT * FROM business_shift_coverage_requests WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, businessId]);
    if (!r) fail(404, 'not_found');
    if (r.status !== 'claimed') fail(409, 'invalid_transition');
    if ([String(r.requester_id), String(r.claimed_by)].includes(String(actorId))) fail(403, 'self_review');
    if (body.decision === 'approve') {
      if (!(await isStaff(db, businessId, r.claimed_by))) fail(409, 'claimer_inactive');
      const { rowCount } = await db.query('UPDATE business_staff_shifts SET user_id=$2 WHERE id=$1 AND user_id=$3 AND cancelled_at IS NULL', [r.shift_id, r.claimed_by, r.requester_id]);
      if (!rowCount) fail(409, 'shift_changed');
    }
    const { rows: [u] } = await db.query('UPDATE business_shift_coverage_requests SET status=$2, decided_by=$3, decided_at=NOW() WHERE id=$1 RETURNING *',
      [id, body.decision === 'approve' ? 'approved' : 'declined', actorId]);
    return u;
  }, 'business_coverage_decide');
  for (const u of [row.requester_id, row.claimed_by]) await notify(u, 'business_coverage_decided', { businessId, decision: row.status }, `cov-dec:${row.id}:${u}`, myWorkUrl(businessId));
  return row;
}
async function cancelCoverage(businessId, userId, requestId) {
  const id = int(requestId, { min: 1, field: 'request' });
  const { rows: [r] } = await pool.query("UPDATE business_shift_coverage_requests SET status='cancelled' WHERE id=$1 AND business_id=$2 AND requester_id=$3 AND status IN ('open','claimed') RETURNING *", [id, businessId, userId]);
  if (!r) fail(404, 'not_found');
  return r;
}

// Teammates a member can hand work to (active staff, never contact details).
async function teammates(businessId, userId) {
  const { STAFF_SQL } = require('./teamCommon');
  const { rows } = await pool.query(`SELECT u.id, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name FROM (${STAFF_SQL}) s JOIN users u ON u.id=s.user_id
    WHERE u.id <> $2 ORDER BY u.first_name, u.last_name LIMIT 500`, [businessId, userId]);
  return { teammates: rows };
}

// 280: one day's work in the business time zone.
async function day(businessId, userId, query) {
  const zone = await tz(pool, businessId);
  const { rows: [{ d }] } = await pool.query('SELECT COALESCE($1::date, timezone($2, NOW())::date) AS d', [/^\d{4}-\d{2}-\d{2}$/.test(query?.date || '') ? query.date : null, zone]);
  const [appts, shifts, tasks] = await Promise.all([
    pool.query(`SELECT a.id, a.start_time, a.end_time, a.status, a.customer_name, s.name AS service_name, a.staff_id=$2 AS is_assignee,
        EXTRACT(EPOCH FROM (a.end_time - a.start_time))/60 AS minutes
      FROM business_appointments a LEFT JOIN business_services s ON s.id=a.service_id
      WHERE a.business_id=$1 AND a.status IN ('pending','confirmed','in_progress','completed') AND timezone($3, a.start_time)::date=$4
        AND (a.staff_id=$2 OR EXISTS (SELECT 1 FROM business_appointment_crew c WHERE c.appointment_id=a.id AND c.user_id=$2 AND c.attendance <> 'declined'))
      ORDER BY a.start_time`, [businessId, userId, zone, d]),
    pool.query(`SELECT id, start_time, end_time, role_label, EXTRACT(EPOCH FROM (end_time - start_time))/60 AS minutes FROM business_staff_shifts
      WHERE business_id=$1 AND user_id=$2 AND shift_date=$3 AND cancelled_at IS NULL ORDER BY start_time`, [businessId, userId, d]),
    pool.query("SELECT id, title, kind, due_at, status FROM business_team_tasks WHERE business_id=$1 AND assignee_id=$2 AND timezone($3, due_at)::date=$4 ORDER BY due_at", [businessId, userId, zone, d]),
  ]);
  const booked = appts.rows.reduce((n, a) => n + Number(a.minutes), 0);
  const scheduled = shifts.rows.reduce((n, s) => n + Number(s.minutes), 0);
  return {
    date: d, timezone: zone, appointments: appts.rows, shifts: shifts.rows, tasks: tasks.rows,
    totals: { booked_minutes: Math.round(booked), shift_minutes: Math.round(scheduled), open_tasks: tasks.rows.filter(t => t.status === 'open').length,
      load: scheduled ? (booked > scheduled ? 'over' : booked >= scheduled * 0.85 ? 'full' : 'ok') : (booked ? 'unscheduled' : 'free') },
  };
}

module.exports = { teammates, handoff, acknowledgeHandoff, addNote, inbox, markInboxSeen, coverage, requestCoverage, claimCoverage, decideCoverage, cancelCoverage, day };
