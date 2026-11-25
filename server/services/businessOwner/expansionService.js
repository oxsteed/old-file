'use strict';
// Groups 5-6 items 236-240: service locations + launch checklist, territory
// overview, capacity planning and a seasonal staffing forecast.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, int, uuid, ownerOf, activeMember } = require('./common');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_LOCATIONS = 50;
const TARGET_UTILIZATION = 0.8;

// Active staff: owner + active, unexpired members.
const STAFF = `SELECT user_id FROM businesses WHERE id=$1
  UNION SELECT member_id FROM business_members WHERE business_id=$1 AND status='active' AND member_id IS NOT NULL
    AND (access_valid_until IS NULL OR access_valid_until > NOW()) AND (expires_at IS NULL OR expires_at > NOW())`;

function normHours(hours) {
  if (hours == null) return {};
  if (typeof hours !== 'object' || Array.isArray(hours)) invalid('hours');
  const out = {};
  for (const [day, span] of Object.entries(hours)) {
    if (!DAYS.includes(day) || !Array.isArray(span) || span.length !== 2 || !span.every(v => HHMM.test(v)) || span[0] >= span[1]) invalid('hours');
    out[day] = span;
  }
  return out;
}
function normTz(tz) {
  if (tz == null || tz === '') return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { invalid('timezone'); }
  return tz;
}

async function assertServiceBusiness(db, businessId) {
  const { rows: [b] } = await db.query('SELECT business_kind FROM businesses WHERE id=$1', [businessId]);
  if (b?.business_kind === 'restaurant') fail(409, 'use_restaurant_locations');
}

async function checklist(db, businessId, loc) {
  const [{ rows: [counts] }, { rows: items }] = await Promise.all([
    db.query(`SELECT (SELECT COUNT(*)::int FROM business_service_location_members m WHERE m.location_id=$1 AND m.user_id IN (${STAFF.replace(/\$1/g, '$2')})) AS staff,
      (SELECT COUNT(*)::int FROM business_service_location_services ls JOIN business_services s ON s.id=ls.service_id WHERE ls.location_id=$1 AND s.is_active AND s.deleted_at IS NULL) AS services,
      (SELECT COUNT(*)::int FROM (${STAFF.replace(/\$1/g, '$2')}) st WHERE st.user_id=$3) AS manager_ok`, [loc.id, businessId, loc.manager_user_id]),
    db.query('SELECT id, label, required, done_at, done_by FROM business_location_checklist_items WHERE location_id=$1 ORDER BY id', [loc.id]),
  ]);
  const computed = [
    { key: 'address', done: !!(loc.address_street && loc.address_city && loc.address_state && loc.address_zip) },
    { key: 'timezone', done: !!loc.timezone },
    { key: 'hours', done: Object.keys(loc.hours || {}).length > 0 },
    { key: 'manager', done: !!loc.manager_user_id && counts.manager_ok > 0 },
    { key: 'staff', done: counts.staff > 0 },
    { key: 'services', done: counts.services > 0 },
  ];
  const ready = computed.every(c => c.done) && items.every(i => !i.required || i.done_at);
  return { computed, items, ready, staff_count: counts.staff, service_count: counts.services };
}

async function listLocations(businessId) {
  const { rows } = await pool.query(`SELECT l.*, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS manager_name,
      COALESCE((SELECT array_agg(user_id::text) FROM business_service_location_members WHERE location_id=l.id), '{}') AS member_ids,
      COALESCE((SELECT array_agg(service_id) FROM business_service_location_services WHERE location_id=l.id), '{}') AS service_ids
    FROM business_service_locations l LEFT JOIN users u ON u.id=l.manager_user_id WHERE l.business_id=$1 ORDER BY l.status='closed', LOWER(l.name)`, [businessId]);
  const out = [];
  for (const l of rows) out.push({ ...l, checklist: await checklist(pool, businessId, l) });
  const { rows: staff } = await pool.query(`SELECT u.id, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name FROM users u WHERE u.id IN (${STAFF}) ORDER BY 2`, [businessId]);
  const { rows: services } = await pool.query('SELECT id, name FROM business_services WHERE business_id=$1 AND is_active AND deleted_at IS NULL ORDER BY name', [businessId]);
  return { locations: out, staff, services };
}

function locationFields(body) {
  return {
    name: text(body?.name, 80),
    address_street: text(body.address_street, 200, { required: false }),
    address_city: text(body.address_city, 100, { required: false }),
    address_state: body.address_state ? text(body.address_state, 2, { min: 2 }).toUpperCase() : null,
    address_zip: body.address_zip ? (/^\d{5}(-\d{4})?$/.test(String(body.address_zip).trim()) ? String(body.address_zip).trim() : invalid('address_zip')) : null,
    phone: text(body.phone, 30, { required: false }),
    timezone: normTz(body.timezone),
    hours: normHours(body.hours),
    manager_user_id: body.manager_user_id ? uuid(body.manager_user_id, 'manager_user_id') : null,
  };
}

async function setLinks(db, businessId, locationId, body) {
  if (Array.isArray(body.member_ids)) {
    const ids = [...new Set(body.member_ids.map(v => uuid(v, 'member_ids')))];
    const { rows } = await db.query(`SELECT user_id::text FROM (${STAFF}) s WHERE user_id::text = ANY($2::text[])`, [businessId, ids]);
    if (rows.length !== ids.length) invalid('member_ids');
    await db.query('DELETE FROM business_service_location_members WHERE location_id=$1 AND NOT (user_id::text = ANY($2::text[]))', [locationId, ids]);
    for (const id of ids) await db.query('INSERT INTO business_service_location_members(location_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [locationId, id]);
  }
  if (Array.isArray(body.service_ids)) {
    const ids = [...new Set(body.service_ids.map(v => int(v, { min: 1, field: 'service_ids' })))];
    const { rows } = await db.query('SELECT id FROM business_services WHERE business_id=$1 AND deleted_at IS NULL AND id = ANY($2::int[])', [businessId, ids]);
    if (rows.length !== ids.length) invalid('service_ids');
    await db.query('DELETE FROM business_service_location_services WHERE location_id=$1 AND NOT (service_id = ANY($2::int[]))', [locationId, ids]);
    for (const id of ids) await db.query('INSERT INTO business_service_location_services(location_id,service_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [locationId, id]);
  }
}

async function assertManager(db, businessId, userId) {
  if (userId && !(await activeMember(db, businessId, userId))) invalid('manager_user_id');
}

async function createLocation(businessId, actorId, body) {
  const f = locationFields(body);
  return withTransaction(pool, async db => {
    await assertServiceBusiness(db, businessId);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`biz-locations:${businessId}`]);
    const { rows: [c] } = await db.query("SELECT COUNT(*)::int AS n FROM business_service_locations WHERE business_id=$1 AND status<>'closed'", [businessId]);
    if (c.n >= MAX_LOCATIONS) fail(409, 'location_limit');
    await assertManager(db, businessId, f.manager_user_id);
    let row;
    try {
      ({ rows: [row] } = await db.query(`INSERT INTO business_service_locations(business_id,name,address_street,address_city,address_state,address_zip,phone,timezone,hours,manager_user_id,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [businessId, f.name, f.address_street, f.address_city, f.address_state, f.address_zip, f.phone, f.timezone, f.hours, f.manager_user_id, actorId]));
    } catch (e) { if (e.code === '23505') fail(409, 'location_exists'); throw e; }
    await setLinks(db, businessId, row.id, body);
    return row;
  }, 'business_location_create');
}

async function lockLocation(db, businessId, locationId, expectedVersion) {
  const id = int(locationId, { min: 1, field: 'location' });
  const { rows: [l] } = await db.query('SELECT * FROM business_service_locations WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, businessId]);
  if (!l) fail(404, 'not_found');
  if (expectedVersion != null && Number(expectedVersion) !== l.version) fail(409, 'conflict');
  return l;
}

async function updateLocation(businessId, actorId, locationId, body) {
  const f = locationFields(body);
  return withTransaction(pool, async db => {
    const l = await lockLocation(db, businessId, locationId, body.expectedVersion);
    if (l.status === 'closed') fail(409, 'location_closed');
    await assertManager(db, businessId, f.manager_user_id);
    let row;
    try {
      ({ rows: [row] } = await db.query(`UPDATE business_service_locations SET name=$2,address_street=$3,address_city=$4,address_state=$5,address_zip=$6,phone=$7,timezone=$8,hours=$9,manager_user_id=$10,version=version+1,updated_at=NOW()
        WHERE id=$1 RETURNING *`, [l.id, f.name, f.address_street, f.address_city, f.address_state, f.address_zip, f.phone, f.timezone, f.hours, f.manager_user_id]));
    } catch (e) { if (e.code === '23505') fail(409, 'location_exists'); throw e; }
    await setLinks(db, businessId, l.id, body);
    return row;
  }, 'business_location_update');
}

const TRANSITIONS = { launch: ['setup', 'paused'], pause: ['active'], close: ['setup', 'active', 'paused'] };
async function setStatus(businessId, actorId, locationId, action, body) {
  if (!TRANSITIONS[action]) invalid('action');
  return withTransaction(pool, async db => {
    const l = await lockLocation(db, businessId, locationId, body?.expectedVersion);
    if (!TRANSITIONS[action].includes(l.status)) fail(409, 'invalid_transition');
    if (action === 'launch') {
      const c = await checklist(db, businessId, l);
      if (!c.ready) fail(409, 'location_not_ready');
    }
    const status = { launch: 'active', pause: 'paused', close: 'closed' }[action];
    const { rows: [row] } = await db.query(`UPDATE business_service_locations SET status=$2, version=version+1, updated_at=NOW(),
        launched_at = CASE WHEN $2='active' AND launched_at IS NULL THEN NOW() ELSE launched_at END,
        launched_by = CASE WHEN $2='active' AND launched_by IS NULL THEN $3::uuid ELSE launched_by END
      WHERE id=$1 RETURNING *`, [l.id, status, actorId]);
    return row;
  }, 'business_location_status');
}

async function addChecklistItem(businessId, locationId, body) {
  const label = text(body?.label, 120);
  return withTransaction(pool, async db => {
    const l = await lockLocation(db, businessId, locationId);
    const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM business_location_checklist_items WHERE location_id=$1', [l.id]);
    if (c.n >= 50) fail(409, 'checklist_limit');
    const { rows: [row] } = await db.query('INSERT INTO business_location_checklist_items(location_id,label,required) VALUES($1,$2,$3) RETURNING *', [l.id, label, body.required !== false]);
    return row;
  }, 'business_location_checklist_add');
}
async function setChecklistItem(businessId, actorId, locationId, itemId, body) {
  const id = int(itemId, { min: 1, field: 'item' });
  const loc = int(locationId, { min: 1, field: 'location' });
  if (body?.remove === true) {
    const { rowCount } = await pool.query('DELETE FROM business_location_checklist_items i USING business_service_locations l WHERE i.id=$1 AND i.location_id=$2 AND l.id=i.location_id AND l.business_id=$3', [id, loc, businessId]);
    if (!rowCount) fail(404, 'not_found');
    return { deleted: true };
  }
  const { rows: [row] } = await pool.query(`UPDATE business_location_checklist_items i SET done_at = CASE WHEN $4 THEN COALESCE(i.done_at, NOW()) ELSE NULL END, done_by = CASE WHEN $4 THEN $5::uuid ELSE NULL END
    FROM business_service_locations l WHERE i.id=$1 AND i.location_id=$2 AND l.id=i.location_id AND l.business_id=$3 RETURNING i.*`, [id, loc, businessId, body?.done === true, actorId]);
  if (!row) fail(404, 'not_found');
  return row;
}

// 238: where customers are (client records), where the business works.
async function territory(businessId) {
  const { rows: areas } = await pool.query(`WITH v AS (
      SELECT a.id, a.start_time, COALESCE(a.final_price_cents, a.base_price_cents, 0) AS cents,
        COALESCE(c.state, u.state) AS state, LEFT(COALESCE(c.postal_code, u.zip_code), 3) AS zip3
      FROM business_appointments a
      LEFT JOIN LATERAL (SELECT state, postal_code FROM business_clients bc WHERE bc.business_id=a.business_id AND bc.deleted_at IS NULL
          AND ((a.customer_id IS NOT NULL AND bc.customer_id=a.customer_id) OR (a.customer_email IS NOT NULL AND LOWER(bc.email)=LOWER(a.customer_email))) LIMIT 1) c ON TRUE
      LEFT JOIN users u ON u.id=a.customer_id
      WHERE a.business_id=$1 AND a.status='completed' AND a.start_time >= NOW() - INTERVAL '365 days')
    SELECT COALESCE(UPPER(state),'') AS state, COALESCE(zip3,'') AS zip3, COUNT(*)::int AS visits, COALESCE(SUM(cents),0)::bigint AS revenue_cents,
      COUNT(*) FILTER (WHERE start_time >= NOW() - INTERVAL '90 days')::int AS visits_90d
    FROM v GROUP BY 1,2 ORDER BY visits DESC LIMIT 100`, [businessId]);
  const { rows: [base] } = await pool.query('SELECT address_state, address_zip, service_state, service_city, service_radius_miles FROM businesses WHERE id=$1', [businessId]);
  const { rows: locations } = await pool.query("SELECT id, name, address_state, address_zip, status FROM business_service_locations WHERE business_id=$1 AND status<>'closed' ORDER BY name", [businessId]);
  const { rows: rules } = await pool.query("SELECT id, name, region_mode, region_states, region_postal_prefixes FROM business_services WHERE business_id=$1 AND deleted_at IS NULL AND COALESCE(region_mode,'everywhere')<>'everywhere' ORDER BY name", [businessId]);
  const total = areas.reduce((n, a) => n + a.visits, 0);
  return { base, locations, service_rules: rules, areas: areas.map(a => ({ ...a, share: total ? a.visits / total : 0 })), unknown_area_visits: areas.filter(a => !a.state && !a.zip3).reduce((n, a) => n + a.visits, 0) };
}

// 239: per-day capacity (published shifts, else weekly availability) vs booked hours.
async function capacity(businessId, query) {
  const weeks = query?.weeks ? int(query.weeks, { min: 1, max: 12, field: 'weeks' }) : 4;
  const locationId = query?.location_id ? int(query.location_id, { min: 1, field: 'location_id' }) : null;
  const { rows: [b] } = await pool.query("SELECT COALESCE(NULLIF(timezone,''),'America/New_York') AS tz FROM businesses WHERE id=$1", [businessId]);
  const staffSql = locationId
    ? `SELECT s.user_id FROM (${STAFF}) s JOIN business_service_location_members m ON m.user_id=s.user_id JOIN business_service_locations l ON l.id=m.location_id AND l.business_id=$1 WHERE m.location_id=$4`
    : STAFF;
  const params = [businessId, b.tz, weeks * 7];
  if (locationId) params.push(locationId);
  const { rows } = await pool.query(`WITH staff AS (${staffSql}),
    days AS (SELECT (timezone($2, NOW()))::date + g AS d FROM generate_series(0, $3 - 1) g),
    shift AS (SELECT shift_date AS d, user_id, SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0) AS h
      FROM business_staff_shifts WHERE business_id=$1 AND cancelled_at IS NULL AND end_time > start_time AND user_id IN (SELECT user_id FROM staff) GROUP BY 1,2),
    avail AS (SELECT day_of_week, user_id, SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0) AS h
      FROM business_staff_availability WHERE business_id=$1 AND user_id IN (SELECT user_id FROM staff) GROUP BY 1,2),
    cap AS (SELECT days.d, SUM(COALESCE(shift.h, avail.h, 0)) AS h, COUNT(*) FILTER (WHERE COALESCE(shift.h, avail.h, 0) > 0) AS people
      FROM days CROSS JOIN staff LEFT JOIN shift ON shift.d=days.d AND shift.user_id=staff.user_id
      LEFT JOIN avail ON avail.user_id=staff.user_id AND avail.day_of_week=EXTRACT(DOW FROM days.d) GROUP BY days.d),
    booked AS (SELECT (timezone($2, a.start_time))::date AS d,
        SUM(EXTRACT(EPOCH FROM (a.end_time - a.start_time)) / 3600.0) FILTER (WHERE a.staff_id IN (SELECT user_id FROM staff)) AS h,
        SUM(EXTRACT(EPOCH FROM (a.end_time - a.start_time)) / 3600.0) FILTER (WHERE a.staff_id IS NULL) AS unassigned_h
      FROM business_appointments a WHERE a.business_id=$1 AND a.status IN ('pending','confirmed','in_progress')
        AND a.start_time >= timezone($2, (SELECT MIN(d) FROM days)::timestamp) AND a.start_time < timezone($2, ((SELECT MAX(d) FROM days) + 1)::timestamp) GROUP BY 1)
    SELECT to_char(days.d,'YYYY-MM-DD') AS day, ROUND(COALESCE(cap.h,0)::numeric,1)::float AS capacity_hours, COALESCE(cap.people,0)::int AS people,
      ROUND(COALESCE(booked.h,0)::numeric,1)::float AS booked_hours, ROUND(COALESCE(booked.unassigned_h,0)::numeric,1)::float AS unassigned_hours
    FROM days LEFT JOIN cap ON cap.d=days.d LEFT JOIN booked ON booked.d=days.d ORDER BY days.d`, params);
  const withUtil = rows.map(r => {
    const demand = r.booked_hours + (locationId ? 0 : r.unassigned_hours);
    const utilization = r.capacity_hours > 0 ? demand / r.capacity_hours : (demand > 0 ? null : 0);
    return { ...r, utilization, flag: utilization == null ? 'no_capacity' : utilization > 1 ? 'over' : utilization >= 0.85 ? 'tight' : 'ok' };
  });
  const weeksOut = [];
  for (let i = 0; i < withUtil.length; i += 7) {
    const w = withUtil.slice(i, i + 7);
    const cap = w.reduce((n, d) => n + d.capacity_hours, 0);
    const demand = w.reduce((n, d) => n + d.booked_hours + (locationId ? 0 : d.unassigned_hours), 0);
    weeksOut.push({ week_start: w[0].day, capacity_hours: Math.round(cap * 10) / 10, booked_hours: Math.round(demand * 10) / 10, utilization: cap > 0 ? demand / cap : null, open_hours: Math.round((cap - demand) * 10) / 10 });
  }
  return { timezone: b.tz, days: withUtil, weeks: weeksOut, location_id: locationId };
}

// 240: same-month history scaled by recent year-over-year trend.
async function seasonalForecast(businessId) {
  const { rows: [b] } = await pool.query("SELECT COALESCE(NULLIF(timezone,''),'America/New_York') AS tz FROM businesses WHERE id=$1", [businessId]);
  const { rows: hist } = await pool.query(`SELECT to_char(date_trunc('month', timezone($2, start_time)),'YYYY-MM') AS month,
      SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0)::float AS hours, COUNT(*)::int AS visits
    FROM business_appointments WHERE business_id=$1 AND status IN ('completed','confirmed','in_progress','pending')
      AND start_time >= date_trunc('month', NOW()) - INTERVAL '36 months' AND start_time < date_trunc('month', NOW()) GROUP BY 1 ORDER BY 1`, [businessId, b.tz]);
  const { rows: [staff] } = await pool.query(`SELECT COUNT(*)::int AS people,
      COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0) FROM business_staff_availability WHERE business_id=$1 AND user_id IN (${STAFF})), 0)::float AS weekly_hours
    FROM (${STAFF}) s`, [businessId]);
  const byMonth = Object.fromEntries(hist.map(h => [h.month, h.hours]));
  const now = new Date();
  const ym = (y, m) => { const d = new Date(Date.UTC(y, m, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  const Y = now.getUTCFullYear(), M = now.getUTCMonth();
  const recent = [1, 2, 3].map(k => byMonth[ym(Y, M - k)] || 0).reduce((a, c) => a + c, 0);
  const prior = [1, 2, 3].map(k => byMonth[ym(Y - 1, M - k)] || 0).reduce((a, c) => a + c, 0);
  const trend = prior > 0 ? Math.min(2, Math.max(0.5, recent / prior)) : 1;
  const perPersonMonth = staff.people > 0 && staff.weekly_hours > 0 ? (staff.weekly_hours / staff.people) * 4.33 : 140;
  const months = [];
  for (let k = 0; k < 6; k++) {
    const same = [1, 2, 3].map(yb => byMonth[ym(Y - yb, M + k)]).filter(v => v != null);
    const base = same.length ? same.reduce((a, c) => a + c, 0) / same.length : recent / 3;
    const demand = base * (same.length ? trend : 1);
    const needed = demand > 0 ? Math.ceil(demand / (perPersonMonth * TARGET_UTILIZATION)) : 0;
    months.push({ month: ym(Y, M + k), demand_hours: Math.round(demand * 10) / 10, staff_needed: needed, gap: needed - staff.people, basis: same.length ? 'same_month' : (recent > 0 ? 'recent_average' : 'no_history') });
  }
  return { history: hist, trend, current_staff: staff.people, hours_per_person_month: Math.round(perPersonMonth), target_utilization: TARGET_UTILIZATION, months };
}

module.exports = { listLocations, createLocation, updateLocation, setStatus, addChecklistItem, setChecklistItem, territory, capacity, seasonalForecast, ownerOf };
