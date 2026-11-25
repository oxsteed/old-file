'use strict';
// Groups 5-6 items 217 (open assignments), 218 (schedule heatmap),
// 220 (handoff timeline), 222 (repeat service records), 225 (service issues).
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, uuid, int, notify } = require('./common');

const OPEN_STATUSES = ['pending', 'confirmed', 'in_progress'];

// 217: upcoming open work with nobody (or a departed member) assigned.
async function openAssignments(businessId) {
  const { rows } = await pool.query(`SELECT a.id, a.start_time, a.end_time, a.status, a.customer_name, a.staff_id, s.name AS service_name,
      CASE WHEN a.staff_id IS NULL THEN 'unassigned' ELSE 'assignee_inactive' END AS reason,
      (SELECT COALESCE(json_agg(json_build_object('id', ss.staff_id, 'name', TRIM(CONCAT(u.first_name,' ',u.last_name)))), '[]')
         FROM business_service_staff ss JOIN users u ON u.id=ss.staff_id
        WHERE ss.service_id=a.service_id AND ss.is_available IS NOT FALSE
          AND (ss.staff_id=b.user_id OR EXISTS (SELECT 1 FROM business_members m WHERE m.business_id=a.business_id AND m.member_id=ss.staff_id AND m.status='active'))) AS eligible
    FROM business_appointments a JOIN businesses b ON b.id=a.business_id LEFT JOIN business_services s ON s.id=a.service_id
    WHERE a.business_id=$1 AND a.status = ANY($2) AND a.end_time > NOW()
      AND (a.staff_id IS NULL OR (a.staff_id <> b.user_id AND NOT EXISTS (SELECT 1 FROM business_members m WHERE m.business_id=a.business_id AND m.member_id=a.staff_id AND m.status='active'
           AND (m.access_valid_until IS NULL OR m.access_valid_until > NOW()))))
    ORDER BY a.start_time LIMIT 200`, [businessId, OPEN_STATUSES]);
  return { appointments: rows };
}

// 218: booked appointments per weekday x hour in the business time zone,
// next `weeks` weeks (or past when `range=past`), against staffed hours.
async function heatmap(businessId, { range = 'upcoming', weeks = 4 } = {}) {
  if (!['upcoming', 'past'].includes(range)) invalid('range');
  const w = int(weeks, { min: 1, max: 26, field: 'weeks' });
  const window = range === 'upcoming' ? "a.start_time >= NOW() AND a.start_time < NOW() + make_interval(weeks => $2)" : "a.start_time < NOW() AND a.start_time >= NOW() - make_interval(weeks => $2)";
  const { rows: [b] } = await pool.query("SELECT COALESCE(NULLIF(timezone,''),'America/New_York') AS tz FROM businesses WHERE id=$1", [businessId]);
  const { rows: booked } = await pool.query(`SELECT EXTRACT(DOW FROM a.start_time AT TIME ZONE $3)::int AS dow, EXTRACT(HOUR FROM a.start_time AT TIME ZONE $3)::int AS hour, COUNT(*)::int AS n
    FROM business_appointments a WHERE a.business_id=$1 AND a.status <> 'cancelled' AND ${window} GROUP BY 1,2`, [businessId, w, b.tz]);
  const { rows: staffed } = await pool.query(`SELECT day_of_week AS dow, h AS hour, COUNT(DISTINCT user_id)::int AS n
    FROM business_staff_availability, generate_series(0,23) h
    WHERE business_id=$1 AND make_time(h,0,0) >= start_time AND make_time(h,0,0) < end_time GROUP BY 1,2`, [businessId]);
  const cells = Array.from({ length: 7 }, (_, dow) => Array.from({ length: 24 }, (_, hour) => ({ dow, hour, booked: 0, staffed: 0 })));
  for (const r of booked) cells[r.dow][r.hour].booked = r.n;
  for (const r of staffed) if (cells[r.dow]) cells[r.dow][r.hour].staffed = r.n;
  const peak = Math.max(0, ...booked.map(r => r.n));
  return { timezone: b.tz, range, weeks: w, peak, cells: cells.flat() };
}

// 220: who took over what, from authoritative rows.
async function handoffTimeline(businessId, { limit = 100 } = {}) {
  const lim = int(limit, { min: 1, max: 200, field: 'limit' });
  const { rows } = await pool.query(`SELECT * FROM (
      SELECT e.created_at AS at, 'assignment' AS kind, e.source AS event, e.appointment_id::text AS ref, e.from_staff_id AS from_user, e.to_staff_id AS to_user, e.actor_id, e.reason AS detail
        FROM business_appointment_assignment_events e WHERE e.business_id=$1
      UNION ALL
      SELECT m.accepted_at, 'membership', 'joined', m.id::text, NULL, m.member_id, m.owner_id, m.role FROM business_members m WHERE m.business_id=$1 AND m.accepted_at IS NOT NULL
      UNION ALL
      SELECT m.role_updated_at, 'membership', 'role_changed', m.id::text, NULL, m.member_id, m.role_updated_by, m.role FROM business_members m WHERE m.business_id=$1 AND m.role_updated_at IS NOT NULL
      UNION ALL
      SELECT r.removed_at, 'membership', 'offboarded', r.id::text, r.user_id, NULL, NULL, r.reason FROM staff_offboarding_records r WHERE r.business_id=$1
      UNION ALL
      SELECT x.decided_at, 'shift', 'swap_approved', x.shift_id::text, x.requester_user_id, x.target_user_id, x.decided_by, NULL FROM business_shift_swap_requests x WHERE x.business_id=$1 AND x.status='approved'
    ) t WHERE at IS NOT NULL ORDER BY at DESC LIMIT $2`, [businessId, lim]);
  const ids = [...new Set(rows.flatMap(r => [r.from_user, r.to_user, r.actor_id]).filter(Boolean))];
  const { rows: users } = ids.length ? await pool.query("SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name FROM users WHERE id = ANY($1::uuid[])", [ids]) : { rows: [] };
  const names = Object.fromEntries(users.map(u => [u.id, u.name]));
  return { events: rows.map(r => ({ ...r, from_name: names[r.from_user] || null, to_name: names[r.to_user] || null, actor_name: names[r.actor_id] || null })) };
}

// 222: customers with two or more completed visits, newest first.
async function repeatRecords(businessId) {
  const { rows } = await pool.query(`SELECT COALESCE(a.customer_id::text, LOWER(a.customer_email)) AS customer_key, MAX(a.customer_name) AS customer_name,
      COUNT(*)::int AS visits, MIN(a.start_time) AS first_visit, MAX(a.start_time) AS last_visit,
      SUM(COALESCE(a.final_price_cents, a.base_price_cents, 0))::bigint AS lifetime_cents,
      ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL) AS services,
      ROUND(AVG(a.feedback_rating)::numeric, 2) AS avg_rating,
      (EXTRACT(EPOCH FROM (MAX(a.start_time) - MIN(a.start_time))) / 86400 / NULLIF(COUNT(*) - 1, 0))::int AS avg_days_between
    FROM business_appointments a LEFT JOIN business_services s ON s.id=a.service_id
    WHERE a.business_id=$1 AND a.status='completed' AND (a.customer_id IS NOT NULL OR a.customer_email IS NOT NULL)
    GROUP BY 1 HAVING COUNT(*) >= 2 ORDER BY MAX(a.start_time) DESC LIMIT 200`, [businessId]);
  return { customers: rows };
}

// 225: customer reports an issue on their own completed (or no-show) visit.
const CATEGORIES = ['quality', 'incomplete', 'damage', 'late_or_no_show', 'conduct', 'billing', 'other'];
async function reportIssue(userId, businessId, appointmentId, body) {
  const bid = int(businessId, { min: 1, field: 'business' });
  uuid(appointmentId, 'appointment');
  const requestId = uuid(body?.requestId, 'requestId');
  if (!CATEGORIES.includes(body?.category)) invalid('category');
  const description = text(body?.description, 2000, { min: 10 });
  const row = await withTransaction(pool, async db => {
    const { rows: [prior] } = await db.query('SELECT * FROM business_service_issues WHERE reporter_id=$1 AND request_id=$2', [userId, requestId]);
    if (prior) { if (prior.appointment_id !== appointmentId) fail(409, 'idempotency_conflict'); return { prior }; }
    const { rows: [a] } = await db.query('SELECT a.id, a.status, a.staff_id, a.completed_at, a.start_time, b.user_id AS owner_id FROM business_appointments a JOIN businesses b ON b.id=a.business_id WHERE a.id=$1 AND a.business_id=$2 AND a.customer_id=$3 FOR SHARE', [appointmentId, bid, userId]);
    if (!a) fail(404, 'not_found');
    if (!['completed', 'no_show', 'in_progress'].includes(a.status)) fail(409, 'issue_not_reportable');
    // Industry window (D-200): 30 days after the visit.
    if (new Date(a.completed_at || a.start_time).getTime() < Date.now() - 30 * 86400000) fail(409, 'issue_window_closed');
    const { rows: [open] } = await db.query("SELECT id FROM business_service_issues WHERE appointment_id=$1 AND reporter_id=$2 AND status IN ('open','in_review')", [appointmentId, userId]);
    if (open) fail(409, 'issue_already_open');
    const { rows: [created] } = await db.query(`INSERT INTO business_service_issues(business_id,appointment_id,reporter_id,request_id,category,description)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [bid, appointmentId, userId, requestId, body.category, description]);
    return { created, ownerId: a.owner_id };
  }, 'business_service_issue_report');
  if (row.prior) return row.prior;
  await notify(row.ownerId, 'business_service_issue_reported', { issue_id: row.created.id, business_id: bid }, `service-issue:${row.created.id}`, `/business/${bid}/workspace/owner-console`);
  return row.created;
}

async function myIssues(userId, appointmentId) {
  uuid(appointmentId, 'appointment');
  const { rows } = await pool.query('SELECT id, category, description, status, resolution, created_at, resolved_at FROM business_service_issues WHERE reporter_id=$1 AND appointment_id=$2 ORDER BY created_at DESC', [userId, appointmentId]);
  return { issues: rows };
}

// 225 customer view: own recent visits with any issue status.
async function myVisits(userId) {
  const { rows } = await pool.query(`SELECT a.id, a.business_id, b.business_name, s.name AS service_name, a.start_time, a.status, a.completed_at,
      (a.status IN ('completed','no_show','in_progress') AND COALESCE(a.completed_at, a.start_time) > NOW() - INTERVAL '30 days') AS can_report,
      (SELECT json_build_object('id', i.id, 'status', i.status, 'resolution', i.resolution) FROM business_service_issues i
        WHERE i.appointment_id=a.id AND i.reporter_id=$1 ORDER BY i.created_at DESC LIMIT 1) AS issue
    FROM business_appointments a JOIN businesses b ON b.id=a.business_id LEFT JOIN business_services s ON s.id=a.service_id
    WHERE a.customer_id=$1 AND a.start_time > NOW() - INTERVAL '60 days' AND a.start_time < NOW() + INTERVAL '1 day'
    ORDER BY a.start_time DESC LIMIT 50`, [userId]);
  return { visits: rows };
}

async function issueQueue(businessId, { status } = {}) {
  if (status && !['open', 'in_review', 'resolved', 'dismissed'].includes(status)) invalid('status');
  const { rows } = await pool.query(`SELECT i.*, a.start_time, a.customer_name, a.staff_id, s.name AS service_name, TRIM(CONCAT(st.first_name,' ',st.last_name)) AS staff_name
    FROM business_service_issues i JOIN business_appointments a ON a.id=i.appointment_id LEFT JOIN business_services s ON s.id=a.service_id LEFT JOIN users st ON st.id=a.staff_id
    WHERE i.business_id=$1 AND ($2::text IS NULL OR i.status=$2) ORDER BY (i.status IN ('open','in_review')) DESC, i.created_at DESC LIMIT 200`, [businessId, status || null]);
  return { issues: rows };
}

async function updateIssue(businessId, actorId, issueId, body) {
  uuid(issueId, 'issue');
  if (!['in_review', 'resolved', 'dismissed'].includes(body?.status)) invalid('status');
  const resolution = text(body?.resolution, 2000, { required: body.status !== 'in_review' });
  const expected = int(body?.expectedVersion, { field: 'expectedVersion' });
  const { rows: [row] } = await pool.query(`UPDATE business_service_issues SET status=$3, resolution=COALESCE($4,resolution),
      resolved_by=CASE WHEN $3 IN ('resolved','dismissed') THEN $5::uuid ELSE resolved_by END,
      resolved_at=CASE WHEN $3 IN ('resolved','dismissed') THEN NOW() ELSE resolved_at END,
      assigned_to=COALESCE(assigned_to,$5::uuid), version=version+1, updated_at=NOW()
    WHERE id=$1 AND business_id=$2 AND version=$6 AND status IN ('open','in_review') RETURNING *`, [issueId, businessId, body.status, resolution, actorId, expected]);
  if (!row) fail(409, 'conflict');
  if (row.status !== 'in_review') await notify(row.reporter_id, 'business_service_issue_resolved', { issue_id: row.id, business_id: row.business_id, status: row.status }, `service-issue:${row.id}:${row.status}`, '/my-bookings');
  return row;
}

module.exports = { myVisits, openAssignments, heatmap, handoffTimeline, repeatRecords, reportIssue, myIssues, issueQueue, updateIssue };
