'use strict';
// Shared helpers for the Groups 5-6 team member services (items 252-300).
const { fail } = require('./common');

const ACTIVE_MEMBER = `status='active' AND member_id IS NOT NULL AND (access_valid_until IS NULL OR access_valid_until > NOW()) AND (expires_at IS NULL OR expires_at > NOW())`;
// Owner + active members of business $1.
const STAFF_SQL = `SELECT user_id FROM businesses WHERE id=$1 UNION SELECT member_id FROM business_members WHERE business_id=$1 AND ${ACTIVE_MEMBER}`;
const OPEN_STATUSES = ['pending', 'confirmed', 'in_progress'];
const MANAGER_RANK = { owner: 5, manager: 4 };

async function tz(db, businessId) {
  const { rows: [b] } = await db.query("SELECT COALESCE(NULLIF(timezone,''),'America/New_York') AS tz FROM businesses WHERE id=$1", [businessId]);
  return b?.tz || 'America/New_York';
}
async function isStaff(db, businessId, userId) {
  const { rows } = await db.query(`SELECT 1 FROM (${STAFF_SQL}) s WHERE s.user_id=$2`, [businessId, userId]);
  return rows.length > 0;
}
// The appointment, if the user works on it (assignee or crew) — else 404.
async function workedAppointment(db, businessId, appointmentId, userId, { lock = false, allowManager = null } = {}) {
  const { rows: [a] } = await db.query(`SELECT a.*, s.name AS service_name FROM business_appointments a LEFT JOIN business_services s ON s.id=a.service_id
    WHERE a.id::text=$1 AND a.business_id=$2 ${lock ? 'FOR UPDATE OF a' : ''}`, [String(appointmentId), businessId]);
  if (!a) fail(404, 'not_found');
  if (String(a.staff_id) === String(userId)) return { appt: a, assignee: true };
  const { rows: crew } = await db.query('SELECT role FROM business_appointment_crew WHERE appointment_id=$1 AND user_id=$2', [a.id, userId]);
  if (crew.length) return { appt: a, assignee: false, crewRole: crew[0].role };
  if (allowManager) return { appt: a, assignee: false, manager: true };
  fail(404, 'not_found');
}
const canManage = (role, perms, code) => role === 'owner' || (MANAGER_RANK[role] && (!code || (perms && perms.has && perms.has(code))));

// People who should hear about something at this business, closest first:
// the location manager for the person's location, then managers, then owner.
async function routeTarget(db, businessId, aboutUserId) {
  if (aboutUserId) {
    const { rows: [l] } = await db.query(`SELECT l.manager_user_id FROM business_service_location_members m JOIN business_service_locations l ON l.id=m.location_id
      WHERE m.user_id=$2 AND l.business_id=$1 AND l.status IN ('active','paused') AND l.manager_user_id IS NOT NULL AND l.manager_user_id <> $2 ORDER BY l.id LIMIT 1`, [businessId, aboutUserId]);
    if (l) return l.manager_user_id;
  }
  const { rows: [m] } = await db.query(`SELECT member_id FROM business_members WHERE business_id=$1 AND role='manager' AND ${ACTIVE_MEMBER}
    AND ($2::uuid IS NULL OR member_id <> $2) ORDER BY accepted_at NULLS LAST, id LIMIT 1`, [businessId, aboutUserId || null]);
  if (m) return m.member_id;
  const { rows: [b] } = await db.query('SELECT user_id FROM businesses WHERE id=$1', [businessId]);
  return b.user_id;
}

// Fit of each user for an appointment window: qualified, scheduled, free, not on leave.
async function fitFor(db, businessId, userIds, appt) {
  if (!userIds.length) return [];
  const zone = await tz(db, businessId);
  const { rows } = await db.query(`WITH u AS (SELECT unnest($2::uuid[]) AS user_id),
      w AS (SELECT timezone($3, $4::timestamptz) AS ls, timezone($3, $5::timestamptz) AS le)
    SELECT u.user_id,
      EXISTS (SELECT 1 FROM business_service_staff ss WHERE ss.service_id=$6 AND ss.staff_id=u.user_id AND ss.is_available) AS qualified,
      EXISTS (SELECT 1 FROM business_staff_shifts s, w WHERE s.business_id=$1 AND s.user_id=u.user_id AND s.cancelled_at IS NULL AND s.shift_date=w.ls::date) AS has_shift,
      EXISTS (SELECT 1 FROM business_staff_shifts s, w WHERE s.business_id=$1 AND s.user_id=u.user_id AND s.cancelled_at IS NULL AND s.shift_date=w.ls::date
        AND w.ls::date = w.le::date AND s.start_time <= w.ls::time AND s.end_time >= w.le::time) AS shift_fit,
      EXISTS (SELECT 1 FROM business_staff_availability v, w WHERE v.business_id=$1 AND v.user_id=u.user_id AND v.day_of_week=EXTRACT(DOW FROM w.ls)
        AND w.ls::date = w.le::date AND v.start_time <= w.ls::time AND v.end_time >= w.le::time) AS avail_fit,
      EXISTS (SELECT 1 FROM business_time_off_requests t, w WHERE t.business_id=$1 AND t.user_id=u.user_id AND t.status='approved' AND w.ls::date BETWEEN t.start_date AND t.end_date) AS time_off,
      EXISTS (SELECT 1 FROM business_appointments o WHERE o.business_id=$1 AND o.id::text <> $7 AND o.status IN ('pending','confirmed','in_progress')
        AND (o.staff_id=u.user_id OR EXISTS (SELECT 1 FROM business_appointment_crew c WHERE c.appointment_id=o.id AND c.user_id=u.user_id AND c.attendance <> 'declined'))
        AND o.start_time < $5 AND o.end_time > $4) AS conflict,
      (SELECT COUNT(*)::int FROM business_appointments o, w WHERE o.business_id=$1 AND o.staff_id=u.user_id AND o.status IN ('pending','confirmed','in_progress')
        AND (timezone($3, o.start_time))::date = w.ls::date) AS same_day
    FROM u`, [businessId, userIds, zone, appt.start_time, appt.end_time, appt.service_id, String(appt.id || '')]);
  return rows.map(r => ({ ...r, available: r.has_shift ? r.shift_fit : r.avail_fit }));
}

module.exports = { ACTIVE_MEMBER, STAFF_SQL, OPEN_STATUSES, tz, isStaff, workedAppointment, canManage, routeTarget, fitFor };
