'use strict';
// Group 8 items 351-400 (restaurant owner/manager): location readiness and
// settings templates, menu import / scheduled changes / history, holiday
// hours, pickup slots, pickup area, substitution policy, ops reports,
// equipment downtime, order transfers, emergency closure and reopening.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, posInt, optInt, str, oneOf, iso, need, storeIds, location, order, storeManagers, notify } = require('./access');

const MANUAL_CHECKS = ['food_safety_inspection', 'staff_trained', 'test_order', 'soft_open'];
const AUTO_CHECKS = ['hours', 'tax', 'menu', 'station', 'staff', 'pickup'];
const REOPEN_KEYS = ['equipment_checked', 'food_safety_checked', 'staff_ready', 'systems_online'];
const CLOSURE_DISPOSITIONS = ['hand_off', 'finish', 'transfer', 'cancel'];
const SUBSTITUTION = ['contact_customer', 'substitute_similar', 'refund_item', 'cancel_order'];
const url = (r, tab = 'operations') => `/restaurants/${r}/manage?tab=${tab}`;
const asMenuActor = async (db, c, source) => { await db.query("SELECT set_config('app.menu_actor', $1, true), set_config('app.menu_source', $2, true)", [String(c.userId), source]); };

// 353, 354, 396 location readiness
async function readiness(c, locationId) {
  const l = await location(c, locationId);
  const q = (sql, args) => pool.query(sql, args).then(r => r.rows[0]);
  const [r, menu, station, staff, saved] = await Promise.all([
    q('SELECT operating_hours, tax_rate_bps FROM food_restaurants WHERE id=$1', [c.restaurantId]),
    q(`SELECT COUNT(*)::int n FROM food_menu_items WHERE restaurant_id=$1 AND is_available AND publication_status='published' AND archived_at IS NULL`, [c.restaurantId]),
    q('SELECT COUNT(*)::int n FROM restaurant_kitchen_stations WHERE restaurant_id=$1 AND location_id=$2 AND is_active', [c.restaurantId, l.id]),
    q(`SELECT COUNT(*)::int n FROM restaurant_location_memberships WHERE restaurant_id=$1 AND location_id=$2 AND status='active'`, [c.restaurantId, l.id]),
    q('SELECT checks, launched_at FROM restaurant_location_readiness WHERE location_id=$1', [l.id]),
  ]);
  const hasHours = h => h && typeof h === 'object' && Object.keys(h).length > 0;
  const auto = { hours: hasHours(l.operating_hours) || hasHours(r.operating_hours), tax: l.tax_rate_bps != null || r.tax_rate_bps != null, menu: menu.n > 0, station: station.n > 0, staff: staff.n > 0, pickup: Boolean(l.pickup_area_label || l.pickup_instructions) };
  const manual = saved?.checks || {};
  const checks = [...AUTO_CHECKS.map(key => ({ key, source: 'auto', done: Boolean(auto[key]) })), ...MANUAL_CHECKS.map(key => ({ key, source: 'manual', done: Boolean(manual[key]?.done), done_at: manual[key]?.at || null }))];
  const done = checks.filter(x => x.done).length;
  return { location_id: l.id, location_name: l.name, status: l.status, checks, done, total: checks.length, ready: done === checks.length, launched_at: saved?.launched_at || null };
}
async function setReadinessCheck(c, locationId, key, body) {
  need(c, 'business.manage_locations');
  if (!MANUAL_CHECKS.includes(key)) fail(404, 'not_found');
  const l = await location(c, locationId);
  const entry = { done: Boolean(body?.done), at: new Date().toISOString(), by: c.userId };
  await pool.query(`INSERT INTO restaurant_location_readiness(location_id, restaurant_id, checks) VALUES($1,$2,jsonb_build_object($3::text,$4::jsonb))
    ON CONFLICT (location_id) DO UPDATE SET checks = restaurant_location_readiness.checks || jsonb_build_object($3::text,$4::jsonb), updated_at=NOW()`, [l.id, c.restaurantId, key, JSON.stringify(entry)]);
  return readiness(c, l.id);
}
async function launch(c, locationId) {
  need(c, 'business.manage_locations');
  const r = await readiness(c, locationId);
  if (!r.ready) fail(409, 'location_not_ready');
  await pool.query(`INSERT INTO restaurant_location_readiness(location_id, restaurant_id, launched_at, launched_by) VALUES($1,$2,NOW(),$3)
    ON CONFLICT (location_id) DO UPDATE SET launched_at=COALESCE(restaurant_location_readiness.launched_at, NOW()), launched_by=COALESCE(restaurant_location_readiness.launched_by, $3), updated_at=NOW()`, [r.location_id, c.restaurantId, c.userId]);
  await pool.query(`UPDATE restaurant_locations SET status='active', updated_at=NOW() WHERE id=$1 AND status<>'active'`, [r.location_id]);
  return readiness(c, r.location_id);
}
// 397 location settings template
const TEMPLATE_GROUPS = {
  hours: ['operating_hours', 'day_start_hour'],
  pacing: ['online_order_pacing_max_per_15_min', 'in_store_order_pacing_max_per_15_min', 'scheduled_slot_minutes', 'scheduled_slot_max_orders'],
  prep: ['prep_time_extension_min', 'prep_time_auto_extend_max_min', 'prep_time_auto_extend_threshold_orders', 'prep_time_auto_extend_per_order_min'],
  tax: ['tax_rate_bps', 'service_fee_bps', 'tax_inclusive', 'tax_jurisdiction', 'service_fee_taxable', 'delivery_fee_taxable'],
  pickup: ['pickup_area_label', 'pickup_instructions', 'pickup_parking_note', 'curbside_enabled', 'unclaimed_pickup_minutes'],
  substitution: ['substitution_policy'],
};
async function copySettings(c, toLocationId, body) {
  need(c, 'business.manage_locations');
  const groups = Array.isArray(body?.groups) && body.groups.length ? body.groups : [...Object.keys(TEMPLATE_GROUPS), 'special_hours'];
  for (const g of groups) if (!TEMPLATE_GROUPS[g] && g !== 'special_hours') invalid('groups');
  const from = await location(c, body?.from_location_id);
  const to = await location(c, toLocationId);
  if (from.id === to.id) invalid('from_location_id');
  const cols = groups.flatMap(g => TEMPLATE_GROUPS[g] || []);
  return withTransaction(pool, async db => {
    if (cols.length) await db.query(`UPDATE restaurant_locations t SET ${cols.map(k => `${k}=f.${k}`).join(', ')}, updated_at=NOW() FROM restaurant_locations f WHERE t.id=$1 AND f.id=$2`, [to.id, from.id]);
    let special = 0;
    if (groups.includes('special_hours')) {
      ({ rowCount: special } = await db.query(`INSERT INTO restaurant_location_special_hours(restaurant_id, location_id, on_date, closed, opens_at, closes_at, label, created_by)
        SELECT restaurant_id, $1, on_date, closed, opens_at, closes_at, label, $3 FROM restaurant_location_special_hours WHERE location_id=$2 AND on_date >= CURRENT_DATE ON CONFLICT (location_id, on_date) DO NOTHING`, [to.id, from.id, c.userId]));
    }
    return { copied: groups, columns: cols.length, special_hours: special };
  });
}
// 370, 372, 374, 377 location ops settings
async function opsSettings(c, locationId) {
  const l = await location(c, locationId);
  const pick = ['scheduled_slot_minutes', 'scheduled_slot_max_orders', 'pickup_area_label', 'pickup_instructions', 'pickup_parking_note', 'curbside_enabled', 'substitution_policy', 'unclaimed_pickup_minutes'];
  return { location_id: l.id, ...Object.fromEntries(pick.map(k => [k, l[k]])), substitution_policies: SUBSTITUTION };
}
async function updateOpsSettings(c, locationId, body) {
  need(c, 'business.manage_locations');
  const l = await location(c, locationId);
  const b = body || {}; const f = {};
  if (b.scheduled_slot_minutes !== undefined) { f.scheduled_slot_minutes = optInt(b.scheduled_slot_minutes, 'scheduled_slot_minutes', { min: 5, max: 120 }) ?? 15; if (60 % f.scheduled_slot_minutes && f.scheduled_slot_minutes % 60) invalid('scheduled_slot_minutes'); }
  if (b.scheduled_slot_max_orders !== undefined) f.scheduled_slot_max_orders = optInt(b.scheduled_slot_max_orders, 'scheduled_slot_max_orders', { min: 0, max: 1000 });
  if (b.unclaimed_pickup_minutes !== undefined) f.unclaimed_pickup_minutes = optInt(b.unclaimed_pickup_minutes, 'unclaimed_pickup_minutes', { min: 5, max: 240 }) ?? 30;
  for (const [k, m] of [['pickup_area_label', 120], ['pickup_instructions', 1000], ['pickup_parking_note', 500]]) if (b[k] !== undefined) f[k] = str(b[k], m, { required: false });
  if (b.curbside_enabled !== undefined) f.curbside_enabled = Boolean(b.curbside_enabled);
  if (b.substitution_policy !== undefined) f.substitution_policy = oneOf(b.substitution_policy, SUBSTITUTION, 'substitution_policy');
  const k = Object.keys(f); if (!k.length) invalid();
  await pool.query(`UPDATE restaurant_locations SET ${k.map((x, i) => `${x}=$${i + 2}`).join(', ')}, updated_at=NOW() WHERE id=$1`, [l.id, ...k.map(x => f[x])]);
  return opsSettings(c, l.id);
}
// 369 holiday hours
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
async function specialHours(c, locationId) {
  const l = await location(c, locationId);
  const { rows } = await pool.query('SELECT * FROM restaurant_location_special_hours WHERE location_id=$1 AND on_date >= CURRENT_DATE - 1 ORDER BY on_date', [l.id]);
  return { location_id: l.id, special_hours: rows };
}
async function setSpecialHours(c, locationId, body) {
  need(c, 'business.manage_hours');
  const l = await location(c, locationId);
  const day = body?.on_date;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))) invalid('on_date');
  const closed = Boolean(body.closed);
  if (!closed && (!TIME.test(body.opens_at || '') || !TIME.test(body.closes_at || '') || body.opens_at === body.closes_at)) invalid('opens_at');
  const { rows: [row] } = await pool.query(`INSERT INTO restaurant_location_special_hours(restaurant_id, location_id, on_date, closed, opens_at, closes_at, label, created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (location_id, on_date) DO UPDATE SET closed=EXCLUDED.closed, opens_at=EXCLUDED.opens_at, closes_at=EXCLUDED.closes_at, label=EXCLUDED.label RETURNING *`,
  [c.restaurantId, l.id, day, closed, closed ? null : body.opens_at, closed ? null : body.closes_at, str(body.label, 80, { required: false }), c.userId]);
  return row;
}
async function deleteSpecialHours(c, id) {
  need(c, 'business.manage_hours');
  const { rows: [row] } = await pool.query('SELECT * FROM restaurant_location_special_hours WHERE id=$1 AND restaurant_id=$2', [posInt(id, 'id'), c.restaurantId]);
  if (!row) fail(404, 'not_found');
  await location(c, row.location_id);
  await pool.query('DELETE FROM restaurant_location_special_hours WHERE id=$1', [row.id]);
  return { deleted: true };
}
// Checkout guard (369, 370, 393), called inside the order-create transaction.
async function assertOrderAllowed(db, { restaurantId, locationId, scheduledFor, timezone }) {
  if (!locationId) return;
  const { rows: [closure] } = await db.query('SELECT id FROM restaurant_location_closures WHERE location_id=$1 AND restaurant_id=$2 AND reopened_at IS NULL', [locationId, restaurantId]);
  if (closure) { const AppError = require('../../utils/appError'); throw new AppError('This store is temporarily closed', 409, 'location_emergency_closed'); }
  const at = scheduledFor ? new Date(scheduledFor) : new Date();
  const tz = timezone || 'UTC';
  const { rows: [sh] } = await db.query(`SELECT closed, opens_at, closes_at, ((($2::timestamptz) AT TIME ZONE $3)::time) AS local_time FROM restaurant_location_special_hours
    WHERE location_id=$1 AND on_date = ((($2::timestamptz) AT TIME ZONE $3)::date)`, [locationId, at.toISOString(), tz]);
  if (sh) {
    const t = sh.local_time; const o = sh.opens_at; const cl = sh.closes_at;
    const open = !sh.closed && (o < cl ? (t >= o && t < cl) : (t >= o || t < cl));
    if (!open) { const AppError = require('../../utils/appError'); throw new AppError('The store has special hours on this day', 409, 'restaurant_closed', { hoursCode: 'special_hours' }); }
  }
  if (scheduledFor) {
    const { rows: [l] } = await db.query('SELECT scheduled_slot_minutes, scheduled_slot_max_orders FROM restaurant_locations WHERE id=$1', [locationId]);
    if (l?.scheduled_slot_max_orders > 0) {
      const slotMs = l.scheduled_slot_minutes * 60000; const start = new Date(Math.floor(at.getTime() / slotMs) * slotMs);
      const { rows: [n] } = await db.query(`SELECT COUNT(*)::int n FROM food_orders WHERE location_id=$1 AND scheduled_for >= $2 AND scheduled_for < $3 AND status NOT IN ('cancelled','refunded')`, [locationId, start.toISOString(), new Date(start.getTime() + slotMs).toISOString()]);
      if (n.n >= l.scheduled_slot_max_orders) { const AppError = require('../../utils/appError'); throw new AppError('That pickup time is full. Choose another time.', 409, 'pickup_slot_full', { slotStart: start.toISOString() }); }
    }
  }
}
// 370 slot availability for a day (customer + staff)
async function slots(restaurantIdRaw, locationIdRaw, dateRaw) {
  const restaurantId = posInt(restaurantIdRaw, 'restaurantId'); const locationId = posInt(locationIdRaw, 'location_id');
  const { rows: [l] } = await pool.query(`SELECT l.id, l.scheduled_slot_minutes, l.scheduled_slot_max_orders, COALESCE(l.timezone, r.timezone, 'UTC') AS tz FROM restaurant_locations l JOIN food_restaurants r ON r.id=l.restaurant_id
    WHERE l.id=$1 AND l.restaurant_id=$2 AND r.status='active'`, [locationId, restaurantId]);
  if (!l) fail(404, 'location_not_found');
  const d = typeof dateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  const { rows } = await pool.query(`WITH bounds AS (SELECT (COALESCE($3::date, (NOW() AT TIME ZONE $2)::date)::timestamp AT TIME ZONE $2) AS s)
    SELECT to_timestamp(floor(extract(epoch FROM scheduled_for) / ($4*60)) * ($4*60)) AS slot_start, COUNT(*)::int AS orders
      FROM food_orders, bounds WHERE location_id=$1 AND scheduled_for >= bounds.s AND scheduled_for < bounds.s + INTERVAL '1 day' AND status NOT IN ('cancelled','refunded') GROUP BY 1 ORDER BY 1`, [l.id, l.tz, d, l.scheduled_slot_minutes]);
  return { location_id: l.id, slot_minutes: l.scheduled_slot_minutes, max_orders: l.scheduled_slot_max_orders, booked: rows.map(r => ({ ...r, full: l.scheduled_slot_max_orders > 0 && r.orders >= l.scheduled_slot_max_orders })) };
}
// 377 public pickup info
async function pickupInfo(restaurantIdRaw, locationIdRaw) {
  const { rows: [l] } = await pool.query(`SELECT l.id, l.name, l.address_street, l.address_city, l.pickup_area_label, l.pickup_instructions, l.pickup_parking_note, l.curbside_enabled, l.substitution_policy
    FROM restaurant_locations l JOIN food_restaurants r ON r.id=l.restaurant_id WHERE l.id=$1 AND l.restaurant_id=$2 AND r.status='active'`, [posInt(locationIdRaw, 'location_id'), posInt(restaurantIdRaw, 'restaurantId')]);
  if (!l) fail(404, 'location_not_found');
  return l;
}
// 356 menu import (CSV or rows)
function parseCsv(textIn) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < textIn.length; i++) {
    const ch = textIn[i];
    if (q) { if (ch === '"') { if (textIn[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && textIn[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
async function importMenu(c, body) {
  need(c, 'menu.manage');
  let rows = body?.rows;
  if (typeof body?.csv === 'string') {
    if (body.csv.length > 500000) invalid('csv');
    const table = parseCsv(body.csv);
    const header = (table.shift() || []).map(h => h.trim().toLowerCase());
    if (!header.includes('name') || !header.includes('price')) fail(400, 'menu_import_header', 'CSV needs name and price columns');
    rows = table.map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) invalid('rows');
  const { rows: existing } = await pool.query('SELECT lower(name) AS n FROM food_menu_items WHERE restaurant_id=$1 AND archived_at IS NULL', [c.restaurantId]);
  const seen = new Set(existing.map(r => r.n));
  const report = rows.map((r, i) => {
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 160) : '';
    const priceNum = Number(String(r.price ?? '').replace(/[^0-9.]/g, ''));
    const errors = [];
    if (!name) errors.push('name');
    if (!Number.isFinite(priceNum) || String(r.price ?? '').trim() === '' || priceNum > 100000) errors.push('price');
    const dup = name && seen.has(name.toLowerCase());
    if (name) seen.add(name.toLowerCase());
    const list = v => (typeof v === 'string' ? v.split(/[|;]/).map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 20) : Array.isArray(v) ? v.map(String).slice(0, 20) : []);
    return { line: i + 2, name, price_cents: Math.round(priceNum * 100), category: typeof r.category === 'string' ? r.category.trim().slice(0, 120) || null : null,
      description: typeof r.description === 'string' ? r.description.trim().slice(0, 2000) || null : null, allergens: list(r.allergens), tags: list(r.tags),
      status: errors.length ? 'error' : dup ? 'duplicate' : 'new', errors };
  });
  const toCreate = report.filter(r => r.status === 'new');
  if (body?.dry_run !== false) return { dry_run: true, rows: report, create: toCreate.length, skipped: report.length - toCreate.length };
  return withTransaction(pool, async db => {
    const { rows: [rest] } = await db.query('SELECT currency_code FROM food_restaurants WHERE id=$1', [c.restaurantId]);
    const cats = new Map();
    for (const r of toCreate) {
      let catId = null;
      if (r.category) {
        const key = r.category.toLowerCase();
        if (!cats.has(key)) {
          const { rows: [found] } = await db.query('SELECT id FROM food_menu_categories WHERE restaurant_id=$1 AND lower(name)=$2 LIMIT 1', [c.restaurantId, key]);
          cats.set(key, found ? found.id : (await db.query('INSERT INTO food_menu_categories(restaurant_id, name) VALUES($1,$2) RETURNING id', [c.restaurantId, r.category])).rows[0].id);
        }
        catId = cats.get(key);
      }
      // Imported items land as drafts so nothing goes live before review.
      await db.query(`INSERT INTO food_menu_items(restaurant_id, category_id, name, description, price_cents, currency_code, allergens, tags, publication_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft')`,
        [c.restaurantId, catId, r.name, r.description, r.price_cents, rest?.currency_code || 'USD', r.allergens, r.tags]);
    }
    return { dry_run: false, created: toCreate.length, skipped: report.length - toCreate.length, rows: report };
  });
}
// 358 effective-date scheduling
async function scheduleMenuChange(c, body) {
  need(c, 'menu.manage');
  const itemId = posInt(body?.menu_item_id, 'menu_item_id');
  const { rows: [item] } = await pool.query('SELECT id FROM food_menu_items WHERE id=$1 AND restaurant_id=$2', [itemId, c.restaurantId]);
  if (!item) fail(404, 'not_found');
  const loc = body.location_id ? (await location(c, body.location_id)).id : null;
  if (!loc && storeIds(c)) fail(403, 'location_scope_forbidden');
  const price = body.price_cents == null ? null : optInt(body.price_cents, 'price_cents', { min: 0, max: 10000000 });
  const avail = body.is_available == null ? null : Boolean(body.is_available);
  if (price == null && avail == null) invalid('price_cents');
  const at = iso(body.effective_at, 'effective_at');
  if (new Date(at) <= new Date()) invalid('effective_at');
  const { rows: [row] } = await pool.query(`INSERT INTO restaurant_scheduled_menu_changes(restaurant_id, location_id, menu_item_id, price_cents, is_available, effective_at, created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [c.restaurantId, loc, itemId, price, avail, at, c.userId]);
  return row;
}
async function scheduledChanges(c) {
  const ids = storeIds(c);
  const { rows } = await pool.query(`SELECT s.*, i.name AS item_name, l.name AS location_name FROM restaurant_scheduled_menu_changes s JOIN food_menu_items i ON i.id=s.menu_item_id LEFT JOIN restaurant_locations l ON l.id=s.location_id
    WHERE s.restaurant_id=$1 AND ($2::bigint[] IS NULL OR s.location_id = ANY($2)) AND (s.status='pending' OR s.created_at > NOW() - INTERVAL '30 days') ORDER BY s.status='pending' DESC, s.effective_at`, [c.restaurantId, ids]);
  return { changes: rows };
}
async function cancelMenuChange(c, id) {
  need(c, 'menu.manage');
  const ids = storeIds(c);
  const { rows: [row] } = await pool.query(`UPDATE restaurant_scheduled_menu_changes SET status='cancelled' WHERE id=$1 AND restaurant_id=$2 AND status='pending' AND ($3::bigint[] IS NULL OR location_id = ANY($3)) RETURNING *`, [posInt(id, 'id'), c.restaurantId, ids]);
  if (!row) fail(404, 'not_found');
  return row;
}
// Applies due changes. Used by the job and by the manager "apply now" call.
async function applyDueMenuChanges({ restaurantId = null, limit = 200 } = {}) {
  return withTransaction(pool, async db => {
    const { rows } = await db.query(`SELECT * FROM restaurant_scheduled_menu_changes WHERE status='pending' AND effective_at <= NOW() AND ($1::bigint IS NULL OR restaurant_id=$1) ORDER BY effective_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [restaurantId, limit]);
    for (const s of rows) {
      await db.query("SELECT set_config('app.menu_actor', $1, true), set_config('app.menu_source', 'scheduled', true)", [String(s.created_by || '')]);
      if (s.location_id) {
        await db.query(`INSERT INTO restaurant_store_menu_overrides(restaurant_id, location_id, menu_item_id, price_cents, is_available, updated_by) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT (restaurant_id, location_id, menu_item_id) DO UPDATE SET price_cents=COALESCE($4, restaurant_store_menu_overrides.price_cents), is_available=COALESCE($5, restaurant_store_menu_overrides.is_available), updated_by=$6, updated_at=NOW()`,
        [s.restaurant_id, s.location_id, s.menu_item_id, s.price_cents, s.is_available, s.created_by]);
      } else {
        await db.query('UPDATE food_menu_items SET price_cents=COALESCE($2, price_cents), is_available=COALESCE($3, is_available), updated_at=NOW() WHERE id=$1', [s.menu_item_id, s.price_cents, s.is_available]);
      }
      await db.query(`UPDATE restaurant_scheduled_menu_changes SET status='applied', applied_at=NOW() WHERE id=$1`, [s.id]);
    }
    return { applied: rows.length };
  });
}
// 360 menu change history
async function menuHistory(c, { menu_item_id: itemId, location_id: loc, limit } = {}) {
  const ids = storeIds(c);
  const { rows } = await pool.query(`SELECT h.*, i.name AS item_name, l.name AS location_name, NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),'') AS changed_by_name
    FROM restaurant_menu_change_log h JOIN food_menu_items i ON i.id=h.menu_item_id LEFT JOIN restaurant_locations l ON l.id=h.location_id LEFT JOIN users u ON u.id=h.changed_by
    WHERE h.restaurant_id=$1 AND ($2::bigint IS NULL OR h.menu_item_id=$2) AND ($3::bigint IS NULL OR h.location_id=$3)
      AND ($4::bigint[] IS NULL OR h.location_id IS NULL OR h.location_id = ANY($4)) ORDER BY h.created_at DESC, h.id DESC LIMIT $5`,
  [c.restaurantId, itemId ? posInt(itemId, 'menu_item_id') : null, loc ? posInt(loc, 'location_id') : null, ids, Math.min(Number(limit) || 100, 500)]);
  return { changes: rows };
}
// Reports ---------------------------------------------------------------
const days = (v, d = 28) => Math.min(Math.max(Number(v) || d, 1), 120);
// 372 unclaimed pickups
async function unclaimed(c, { location_id: loc } = {}) {
  const ids = storeIds(c); const locId = loc ? (await location(c, loc)).id : null;
  const { rows } = await pool.query(`SELECT o.id, o.queue_number, o.guest_name, o.pickup_contact_name, o.pickup_contact_phone, o.ready_at, o.location_id, l.name AS location_name, l.unclaimed_pickup_minutes,
      ROUND(EXTRACT(EPOCH FROM NOW() - o.ready_at)/60)::int AS waiting_minutes, o.unclaimed_alerted_at
    FROM food_orders o JOIN restaurant_locations l ON l.id=o.location_id WHERE o.restaurant_id=$1 AND o.status='ready' AND o.fulfillment_type='pickup' AND o.handed_off_at IS NULL
      AND o.ready_at < NOW() - make_interval(mins => l.unclaimed_pickup_minutes) AND ($2::bigint[] IS NULL OR o.location_id = ANY($2)) AND ($3::bigint IS NULL OR o.location_id=$3) ORDER BY o.ready_at`, [c.restaurantId, ids, locId]);
  return { orders: rows };
}
async function alertUnclaimed(c) {
  need(c, 'orders.view');
  const { orders } = await unclaimed(c);
  let notified = 0;
  for (const o of orders.filter(x => !x.unclaimed_alerted_at)) {
    await pool.query('UPDATE food_orders SET unclaimed_alerted_at=NOW() WHERE id=$1', [o.id]);
    for (const m of await storeManagers(c, o.location_id)) { await notify(m, 'restaurant_pickup_unclaimed', { queue: String(o.queue_number || o.id) }, `restaurant_pickup_unclaimed:${o.id}:${m}`, url(c.restaurantId, 'orders')); notified++; }
  }
  return { orders: orders.length, notified };
}
// 375 cancellation follow-up
async function cancellations(c, { status } = {}) {
  need(c, 'orders.view');
  const ids = storeIds(c);
  const { rows } = await pool.query(`SELECT o.id, o.queue_number, o.guest_name, o.guest_phone, o.guest_email, o.customer_id, o.total_cents, o.currency_code, o.payment_status, o.cancelled_at, o.location_id,
      o.metadata->>'cancelReason' AS cancel_reason, COALESCE(o.cancel_follow_up_status,'pending') AS follow_up_status, o.cancel_follow_up_note, o.cancel_follow_up_at
    FROM food_orders o WHERE o.restaurant_id=$1 AND o.status IN ('cancelled','refunded') AND o.cancelled_at > NOW() - INTERVAL '14 days' AND ($2::bigint[] IS NULL OR o.location_id = ANY($2))
      AND ($3::text IS NULL OR COALESCE(o.cancel_follow_up_status,'pending')=$3) ORDER BY o.cancelled_at DESC LIMIT 200`, [c.restaurantId, ids, ['pending', 'contacted', 'resolved', 'no_action'].includes(status) ? status : null]);
  return { orders: rows, pending: rows.filter(r => r.follow_up_status === 'pending').length };
}
async function followUpCancellation(c, orderId, body) {
  need(c, 'orders.manage');
  const st = oneOf(body?.status, ['contacted', 'resolved', 'no_action'], 'status');
  const o = await order(c, orderId);
  if (!['cancelled', 'refunded'].includes(o.status)) fail(409, 'order_not_cancelled');
  const { rows: [row] } = await pool.query(`UPDATE food_orders SET cancel_follow_up_status=$2, cancel_follow_up_note=$3, cancel_follow_up_by=$4, cancel_follow_up_at=NOW() WHERE id=$1
    RETURNING id, cancel_follow_up_status AS follow_up_status, cancel_follow_up_note, cancel_follow_up_at`, [o.id, st, str(body.note, 1000, { required: false }), c.userId]);
  return row;
}
// 379 dispatch delays
async function dispatchDelays(c, q = {}) {
  need(c, 'runner.update');
  const ids = storeIds(c); const n = days(q.days, 14);
  const { rows } = await pool.query(`SELECT t.location_id, l.name AS location_name, COUNT(*)::int AS tasks,
      ROUND(AVG(EXTRACT(EPOCH FROM COALESCE(t.accepted_at, t.picked_up_at) - t.created_at)/60)::numeric,1) AS avg_assign_minutes,
      ROUND(AVG(GREATEST(0, EXTRACT(EPOCH FROM t.picked_up_at - t.pickup_eta_at)/60)) FILTER (WHERE t.pickup_eta_at IS NOT NULL AND t.picked_up_at IS NOT NULL)::numeric,1) AS avg_pickup_delay_minutes,
      ROUND(AVG(GREATEST(0, EXTRACT(EPOCH FROM t.completed_at - t.delivery_eta_at)/60)) FILTER (WHERE t.delivery_eta_at IS NOT NULL AND t.completed_at IS NOT NULL)::numeric,1) AS avg_delivery_delay_minutes,
      COUNT(*) FILTER (WHERE t.completed_at > t.delivery_eta_at + INTERVAL '5 minutes')::int AS late_deliveries
    FROM restaurant_runner_tasks t LEFT JOIN restaurant_locations l ON l.id=t.location_id
    WHERE t.restaurant_id=$1 AND t.task_type='Delivery' AND t.created_at > NOW() - make_interval(days => $2) AND ($3::bigint[] IS NULL OR t.location_id = ANY($3)) GROUP BY t.location_id, l.name ORDER BY late_deliveries DESC`, [c.restaurantId, n, ids]);
  const { rows: worst } = await pool.query(`SELECT t.id, t.order_reference, t.location_id, t.status, t.delivery_eta_at, t.completed_at, ROUND(EXTRACT(EPOCH FROM COALESCE(t.completed_at, NOW()) - t.delivery_eta_at)/60)::int AS late_minutes
    FROM restaurant_runner_tasks t WHERE t.restaurant_id=$1 AND t.task_type='Delivery' AND t.created_at > NOW() - make_interval(days => $2) AND t.delivery_eta_at IS NOT NULL AND COALESCE(t.completed_at, NOW()) > t.delivery_eta_at + INTERVAL '5 minutes'
      AND ($3::bigint[] IS NULL OR t.location_id = ANY($3)) ORDER BY late_minutes DESC LIMIT 10`, [c.restaurantId, n, ids]);
  return { days: n, locations: rows, worst };
}
// 386 prep time trends
async function prepTrends(c, q = {}) {
  const ids = storeIds(c); const n = days(q.days);
  const base = `FROM food_orders o JOIN food_restaurants r ON r.id=o.restaurant_id WHERE o.restaurant_id=$1 AND o.ready_at IS NOT NULL AND o.created_at > NOW() - make_interval(days => $2) AND ($3::bigint[] IS NULL OR o.location_id = ANY($3))`;
  const mins = `EXTRACT(EPOCH FROM o.ready_at - COALESCE(o.preparation_started_at, o.accepted_at, o.created_at))/60`;
  const [{ rows: byDay }, { rows: byHour }, { rows: byLoc }] = await Promise.all([
    pool.query(`SELECT (o.created_at AT TIME ZONE COALESCE(r.timezone,'UTC'))::date AS day, COUNT(*)::int AS orders, ROUND(AVG(${mins})::numeric,1) AS avg_minutes, ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY ${mins}))::numeric,1) AS p90_minutes ${base} GROUP BY 1 ORDER BY 1`, [c.restaurantId, n, ids]),
    pool.query(`SELECT EXTRACT(HOUR FROM o.created_at AT TIME ZONE COALESCE(r.timezone,'UTC'))::int AS hour, COUNT(*)::int AS orders, ROUND(AVG(${mins})::numeric,1) AS avg_minutes ${base} GROUP BY 1 ORDER BY 1`, [c.restaurantId, n, ids]),
    pool.query(`SELECT o.location_id, COUNT(*)::int AS orders, ROUND(AVG(${mins})::numeric,1) AS avg_minutes ${base} GROUP BY 1 ORDER BY 3 DESC NULLS LAST`, [c.restaurantId, n, ids]),
  ]);
  return { days: n, by_day: byDay, by_hour: byHour, by_location: byLoc };
}
// 387 item unavailability
async function unavailability(c, q = {}) {
  const ids = storeIds(c); const n = days(q.days, 30);
  const { rows } = await pool.query(`SELECT i.id AS menu_item_id, i.name,
      COUNT(h.*) FILTER (WHERE h.new_value='false')::int AS times_unavailable,
      (NOT i.is_available) AS unavailable_everywhere,
      (SELECT array_agg(o.location_id) FROM restaurant_store_menu_overrides o WHERE o.menu_item_id=i.id AND o.restaurant_id=i.restaurant_id AND o.is_available = FALSE AND ($3::bigint[] IS NULL OR o.location_id = ANY($3))) AS unavailable_at,
      (SELECT COUNT(*)::int FROM restaurant_inventory_availability_events e WHERE e.menu_item_id=i.id AND e.next_available = FALSE AND e.created_at > NOW() - make_interval(days => $2)) AS inventory_outages
    FROM food_menu_items i LEFT JOIN restaurant_menu_change_log h ON h.menu_item_id=i.id AND h.field IN ('is_available','store_is_available') AND h.created_at > NOW() - make_interval(days => $2)
      AND ($3::bigint[] IS NULL OR h.location_id IS NULL OR h.location_id = ANY($3))
    WHERE i.restaurant_id=$1 AND i.archived_at IS NULL GROUP BY i.id
    HAVING COUNT(h.*) FILTER (WHERE h.new_value='false') > 0 OR NOT i.is_available OR EXISTS (SELECT 1 FROM restaurant_store_menu_overrides o WHERE o.menu_item_id=i.id AND o.is_available = FALSE)
    ORDER BY times_unavailable DESC, i.name LIMIT 200`, [c.restaurantId, n, ids]);
  return { days: n, items: rows };
}
// 388 peak load comparison
async function peakLoad(c, q = {}) {
  const ids = storeIds(c); const n = days(q.days);
  const { rows } = await pool.query(`SELECT o.location_id, l.name AS location_name, EXTRACT(ISODOW FROM o.created_at AT TIME ZONE COALESCE(l.timezone, r.timezone, 'UTC'))::int AS weekday,
      EXTRACT(HOUR FROM o.created_at AT TIME ZONE COALESCE(l.timezone, r.timezone, 'UTC'))::int AS hour, COUNT(*)::int AS orders
    FROM food_orders o JOIN food_restaurants r ON r.id=o.restaurant_id LEFT JOIN restaurant_locations l ON l.id=o.location_id
    WHERE o.restaurant_id=$1 AND o.status NOT IN ('cancelled','refunded') AND o.created_at > NOW() - make_interval(days => $2) AND ($3::bigint[] IS NULL OR o.location_id = ANY($3))
    GROUP BY 1,2,3,4 ORDER BY 1,3,4`, [c.restaurantId, n, ids]);
  const weeks = Math.max(1, n / 7);
  const byLoc = new Map();
  for (const r of rows) {
    const k = String(r.location_id); if (!byLoc.has(k)) byLoc.set(k, { location_id: r.location_id, location_name: r.location_name, hours: new Array(24).fill(0), total: 0 });
    const e = byLoc.get(k); e.hours[r.hour] += r.orders; e.total += r.orders;
  }
  const locations = [...byLoc.values()].map(e => { const avg = e.hours.map(h => Math.round((h / (weeks * 7)) * 10) / 10); const peak = avg.indexOf(Math.max(...avg)); return { ...e, avg_per_day_by_hour: avg, peak_hour: peak, peak_avg_orders: avg[peak] }; });
  return { days: n, locations, cells: rows };
}
// 389 repeat issues
async function repeatIssues(c, q = {}) {
  const ids = storeIds(c); const n = days(q.days, 30);
  const [{ rows: cases }, { rows: issues }] = await Promise.all([
    pool.query(`SELECT s.issue_type, s.issue_subtype, COUNT(*)::int AS cases, MAX(s.created_at) AS last_at FROM restaurant_support_cases s LEFT JOIN food_orders o ON o.id=s.order_id
      WHERE s.restaurant_id=$1 AND s.created_at > NOW() - make_interval(days => $2) AND ($3::bigint[] IS NULL OR o.location_id = ANY($3)) GROUP BY 1,2 HAVING COUNT(*) >= 2 ORDER BY 3 DESC`, [c.restaurantId, n, ids]),
    pool.query(`SELECT i.kind, i.location_id, COALESCE(oi.item_name, '') AS item_name, COUNT(*)::int AS issues, MAX(i.created_at) AS last_at FROM restaurant_order_issues i LEFT JOIN food_order_items oi ON oi.id=i.order_item_id
      WHERE i.restaurant_id=$1 AND i.created_at > NOW() - make_interval(days => $2) AND ($3::bigint[] IS NULL OR i.location_id = ANY($3)) GROUP BY 1,2,3 HAVING COUNT(*) >= 2 ORDER BY 4 DESC`, [c.restaurantId, n, ids]),
  ]);
  return { days: n, support_cases: cases, order_issues: issues };
}
// 398 staff capacity forecast
async function capacityForecast(c, q = {}) {
  const l = await location(c, q.location_id);
  const day = typeof q.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : null;
  const perStaff = Math.min(Math.max(Number(q.orders_per_staff_hour) || 8, 1), 100);
  const { rows: [{ tz, d }] } = await pool.query(`SELECT COALESCE($2, r.timezone, 'UTC') AS tz, COALESCE($3::date, ((NOW() AT TIME ZONE COALESCE($2, r.timezone, 'UTC'))::date + 1)) AS d FROM food_restaurants r WHERE r.id=$1`, [c.restaurantId, l.timezone, day]);
  const { rows: hist } = await pool.query(`SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE $3)::int AS hour, COUNT(*)::numeric / 4 AS avg_orders FROM food_orders
    WHERE location_id=$1 AND status NOT IN ('cancelled','refunded') AND created_at >= (($2::date - 28)::timestamp AT TIME ZONE $3) AND created_at < ($2::date::timestamp AT TIME ZONE $3)
      AND EXTRACT(ISODOW FROM created_at AT TIME ZONE $3) = EXTRACT(ISODOW FROM $2::date) GROUP BY 1`, [l.id, d, tz]);
  const { rows: shifts } = await pool.query(`SELECT start_time, end_time FROM business_staff_shifts WHERE location_id=$1 AND shift_date=$2 AND cancelled_at IS NULL`, [l.id, d]);
  const hours = Array.from({ length: 24 }, (_, h) => {
    const forecast = Number(hist.find(x => x.hour === h)?.avg_orders || 0);
    const hs = `${String(h).padStart(2, '0')}:00:00`;
    const staff = shifts.filter(s => (s.start_time <= s.end_time ? (s.start_time <= hs && s.end_time > hs) : (s.start_time <= hs || s.end_time > hs))).length;
    const needed = forecast > 0 ? Math.ceil(forecast / perStaff) : 0;
    return { hour: h, forecast_orders: Math.round(forecast * 10) / 10, scheduled_staff: staff, needed_staff: needed, gap: staff - needed, status: staff < needed ? 'under' : (needed && staff > needed + 1 ? 'over' : 'ok') };
  });
  return { location_id: l.id, date: d instanceof Date ? d.toISOString().slice(0, 10) : String(d), orders_per_staff_hour: perStaff, hours, under_hours: hours.filter(h => h.status === 'under').length };
}
// 391 equipment downtime (+ 440 station reopening check, 442 incident note)
const REOPEN_CHECKS = ['cleaned', 'tested', 'temperature_ok'];
async function reportDowntime(c, body) {
  need(c, 'kitchen.view');
  const l = await location(c, body?.location_id);
  const station = body.station_id ? posInt(body.station_id, 'station_id') : null;
  if (station) { const { rows } = await pool.query('SELECT 1 FROM restaurant_kitchen_stations WHERE id=$1 AND restaurant_id=$2 AND location_id=$3', [station, c.restaurantId, l.id]); if (!rows.length) fail(404, 'not_found'); }
  const items = Array.isArray(body.affected_item_ids) ? [...new Set(body.affected_item_ids.map(x => posInt(x, 'affected_item_ids')))] : [];
  if (items.length) {
    if (!(require('./access').can(c, 'kitchen.update') || require('./access').can(c, 'menu.manage'))) fail(403, 'permission_required');
    const { rows } = await pool.query('SELECT id FROM food_menu_items WHERE id = ANY($1::bigint[]) AND restaurant_id=$2', [items, c.restaurantId]);
    if (rows.length !== items.length) fail(404, 'not_found');
  }
  const out = await withTransaction(pool, async db => {
    const { rows: [d] } = await db.query(`INSERT INTO restaurant_equipment_downtime(restaurant_id, location_id, station_id, equipment, note, affected_item_ids, reported_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [c.restaurantId, l.id, station, str(body.equipment, 120), str(body.note, 2000, { required: false }), items, c.userId]);
    if (items.length) {
      await asMenuActor(db, c, 'downtime');
      for (const it of items) await db.query(`INSERT INTO restaurant_store_menu_overrides(restaurant_id, location_id, menu_item_id, is_available, updated_by) VALUES($1,$2,$3,FALSE,$4)
        ON CONFLICT (restaurant_id, location_id, menu_item_id) DO UPDATE SET is_available=FALSE, updated_by=$4, updated_at=NOW()`, [c.restaurantId, l.id, it, c.userId]);
    }
    return d;
  });
  for (const m of (await storeManagers(c, l.id)).filter(x => String(x) !== String(c.userId))) await notify(m, 'restaurant_equipment_down', { equipment: out.equipment }, `restaurant_equipment_down:${out.id}:${m}`, url(c.restaurantId));
  return out;
}
async function downtimeList(c, { location_id: loc, status } = {}) {
  const ids = storeIds(c);
  const { rows } = await pool.query(`SELECT d.*, s.name AS station_name, l.name AS location_name FROM restaurant_equipment_downtime d LEFT JOIN restaurant_kitchen_stations s ON s.id=d.station_id LEFT JOIN restaurant_locations l ON l.id=d.location_id
    WHERE d.restaurant_id=$1 AND ($2::bigint[] IS NULL OR d.location_id = ANY($2)) AND ($3::bigint IS NULL OR d.location_id=$3) AND ($4::text IS NULL OR d.status=$4) ORDER BY d.status, d.started_at DESC LIMIT 100`,
  [c.restaurantId, ids, loc ? posInt(loc, 'location_id') : null, ['down', 'restored'].includes(status) ? status : null]);
  return { downtime: rows, reopen_checks: REOPEN_CHECKS };
}
async function restoreDowntime(c, id, body) {
  need(c, 'kitchen.update');
  const checks = body?.checks || {};
  const missing = REOPEN_CHECKS.filter(k => checks[k] !== true);
  if (missing.length) fail(409, 'reopen_checks_incomplete', missing.join(','));
  return withTransaction(pool, async db => {
    const { rows: [d] } = await db.query(`SELECT * FROM restaurant_equipment_downtime WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`, [posInt(id, 'id'), c.restaurantId]);
    if (!d) fail(404, 'not_found');
    await location(c, d.location_id, db);
    if (d.status !== 'down') fail(409, 'already_restored');
    await db.query(`UPDATE restaurant_equipment_downtime SET status='restored', restored_by=$2, restored_at=NOW(), reopen_checks=$3 WHERE id=$1`, [d.id, c.userId, JSON.stringify({ ...Object.fromEntries(REOPEN_CHECKS.map(k => [k, true])), at: new Date().toISOString() })]);
    let restored = 0;
    if (d.affected_item_ids.length) {
      await asMenuActor(db, c, 'downtime');
      ({ rowCount: restored } = await db.query(`UPDATE restaurant_store_menu_overrides o SET is_available=NULL, updated_by=$4, updated_at=NOW() WHERE o.restaurant_id=$1 AND o.location_id=$2 AND o.menu_item_id = ANY($3::bigint[]) AND o.is_available = FALSE
        AND NOT EXISTS (SELECT 1 FROM restaurant_equipment_downtime x WHERE x.location_id=o.location_id AND x.status='down' AND x.id<>$5 AND o.menu_item_id = ANY(x.affected_item_ids))`, [c.restaurantId, d.location_id, d.affected_item_ids, c.userId, d.id]));
    }
    return { id: d.id, status: 'restored', items_restored: restored };
  });
}
// 392 order transfer between stores
async function requestTransfer(c, body) {
  need(c, 'orders.manage');
  const o = await order(c, body?.order_id);
  if (!['received', 'accepted', 'preparing'].includes(o.status)) fail(409, 'order_not_transferable');
  if (!o.location_id) fail(409, 'order_has_no_store');
  const to = posInt(body.to_location_id, 'to_location_id');
  const { rows: [dest] } = await pool.query(`SELECT id, name, status FROM restaurant_locations WHERE id=$1 AND restaurant_id=$2`, [to, c.restaurantId]);
  if (!dest || dest.id === o.location_id) fail(404, 'location_not_found');
  if (dest.status !== 'active') fail(409, 'location_not_active');
  const { rows: [t] } = await pool.query(`INSERT INTO restaurant_order_transfers(restaurant_id, order_id, from_location_id, to_location_id, reason, requested_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,
    [c.restaurantId, o.id, o.location_id, dest.id, str(body.reason, 500, { required: false }), c.userId]);
  if (!t) fail(409, 'transfer_pending');
  for (const m of (await storeManagers(c, dest.id)).filter(x => String(x) !== String(c.userId))) await notify(m, 'restaurant_order_transfer_requested', { queue: String(o.queue_number || o.id) }, `restaurant_order_transfer_requested:${t.id}:${m}`, url(c.restaurantId, 'orders'));
  return t;
}
async function transfers(c) {
  const ids = storeIds(c);
  const { rows } = await pool.query(`SELECT t.*, o.queue_number, o.status AS order_status, fl.name AS from_location, tl.name AS to_location FROM restaurant_order_transfers t JOIN food_orders o ON o.id=t.order_id
    JOIN restaurant_locations fl ON fl.id=t.from_location_id JOIN restaurant_locations tl ON tl.id=t.to_location_id
    WHERE t.restaurant_id=$1 AND ($2::bigint[] IS NULL OR t.from_location_id = ANY($2) OR t.to_location_id = ANY($2)) AND (t.status='requested' OR t.created_at > NOW() - INTERVAL '7 days') ORDER BY t.status='requested' DESC, t.created_at DESC`, [c.restaurantId, ids]);
  return { transfers: rows };
}
async function decideTransfer(c, id, body) {
  need(c, 'orders.manage');
  const decision = oneOf(body?.decision, ['accepted', 'declined', 'cancelled'], 'decision');
  const out = await withTransaction(pool, async db => {
    const { rows: [t] } = await db.query(`SELECT * FROM restaurant_order_transfers WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`, [posInt(id, 'id'), c.restaurantId]);
    if (!t) fail(404, 'not_found');
    if (t.status !== 'requested') fail(409, 'transfer_closed');
    if (decision === 'cancelled') { await location(c, t.from_location_id, db); if (String(t.requested_by) !== String(c.userId) && c.role !== 'owner') fail(403, 'permission_required'); } else await location(c, t.to_location_id, db);
    if (decision === 'accepted') {
      const { rows: [o] } = await db.query('SELECT id, status, location_id, customer_id, queue_number FROM food_orders WHERE id=$1 FOR UPDATE', [t.order_id]);
      if (!['received', 'accepted', 'preparing'].includes(o.status) || Number(o.location_id) !== Number(t.from_location_id)) fail(409, 'order_not_transferable');
      await db.query(`UPDATE food_orders SET location_id=$2, screen_revision=COALESCE(screen_revision,0)+1, metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('transferredFromLocationId', $3::bigint), updated_at=NOW() WHERE id=$1`, [o.id, t.to_location_id, t.from_location_id]);
      t.order = o;
    }
    await db.query('UPDATE restaurant_order_transfers SET status=$2, decided_by=$3, decided_at=NOW() WHERE id=$1', [t.id, decision, c.userId]);
    return { ...t, status: decision };
  });
  if (out.requested_by && String(out.requested_by) !== String(c.userId)) await notify(out.requested_by, 'restaurant_order_transfer_decided', { queue: String(out.order?.queue_number || out.order_id) }, `restaurant_order_transfer_decided:${out.id}`, url(c.restaurantId, 'orders'));
  if (decision === 'accepted' && out.order?.customer_id) await notify(out.order.customer_id, 'restaurant_order_moved', {}, `restaurant_order_moved:${out.id}`, `/food/orders/${out.order_id}`);
  return { id: out.id, status: out.status, order_id: out.order_id };
}
// 393-395 emergency closure, open order cleanup, reopening checklist
async function openOrders(db, locationId) {
  const { rows } = await db.query(`SELECT id, queue_number, status, fulfillment_type, scheduled_for, guest_name, total_cents, payment_status, customer_id FROM food_orders
    WHERE location_id=$1 AND status IN ('received','accepted','preparing','ready') ORDER BY created_at`, [locationId]);
  return rows.map(o => ({ ...o, suggested: o.status === 'ready' ? 'hand_off' : o.status === 'preparing' ? 'finish_or_transfer' : 'transfer_or_cancel' }));
}
// D-436: the pause refuses (409, fail closed, no silent pause) while open
// orders lack a disposition or the customer notice is missing. Dispositions
// and the notice are recorded in the same transaction as the pause, so a
// refused close leaves the store running and writes nothing. A disposition
// is a coordination record only: it does not change the order's status,
// cancel it, or refund anything — the actual handoff / transfer / cancel
// still goes through the existing order flows. With no open orders there is
// nothing to disposition and the close proceeds as before (a notice supplied
// anyway is recorded).
async function emergencyClose(c, body) {
  need(c, 'orders.manage');
  const l = await location(c, body?.location_id);
  const reason = oneOf(body?.reason, ['power', 'water', 'weather', 'equipment', 'staffing', 'safety', 'other'], 'reason');
  const notice = typeof body?.customer_notice === 'string' ? body.customer_notice.trim().slice(0, 2000) : (typeof body?.customer_notice_message === 'string' ? body.customer_notice_message.trim().slice(0, 2000) : '');
  const supplied = Array.isArray(body?.dispositions) ? body.dispositions : [];
  const out = await withTransaction(pool, async db => {
    const { rows: [open] } = await db.query('SELECT 1 FROM restaurant_location_closures WHERE location_id=$1 AND reopened_at IS NULL', [l.id]);
    if (open) fail(409, 'location_already_closed');
    const openOrdersList = await openOrders(db, l.id);
    let dispositions = [];
    if (openOrdersList.length) {
      if (!notice) fail(409, 'closure_notice_required', 'A customer notice is required while orders are open');
      const byOrder = new Map();
      for (const d of supplied) {
        if (!d || typeof d !== 'object') invalid('dispositions');
        const orderId = posInt(d.order_id, 'order_id');
        const disp = oneOf(d.disposition, CLOSURE_DISPOSITIONS, 'disposition');
        if (byOrder.has(orderId)) invalid('dispositions');
        byOrder.set(orderId, { order_id: orderId, disposition: disp, note: typeof d.note === 'string' ? d.note.trim().slice(0, 1000) || null : null });
      }
      const missing = openOrdersList.filter(o => !byOrder.has(Number(o.id)));
      if (missing.length) fail(409, 'closure_dispositions_required', `Every open order needs a disposition (${missing.length} missing)`);
      const openIds = new Set(openOrdersList.map(o => Number(o.id)));
      if ([...byOrder.keys()].some(id => !openIds.has(id))) invalid('dispositions');
      dispositions = openOrdersList.map(o => byOrder.get(Number(o.id)));
    }
    const { rows: [cl] } = await db.query(`INSERT INTO restaurant_location_closures(restaurant_id, location_id, reason, note, previous_status, closed_by, customer_notice_message, customer_notice_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING *`,
    [c.restaurantId, l.id, reason, str(body.note, 1000, { required: false }), l.status, c.userId, notice || null, notice ? new Date().toISOString() : null]);
    if (!cl) fail(409, 'location_already_closed');
    for (const d of dispositions) {
      await db.query(`INSERT INTO restaurant_closure_order_dispositions(closure_id, order_id, disposition, note, decided_by) VALUES($1,$2,$3,$4,$5)`,
        [cl.id, d.order_id, d.disposition, d.note, c.userId]);
    }
    await db.query(`UPDATE restaurant_locations SET status='paused', updated_at=NOW() WHERE id=$1`, [l.id]);
    return { closure: cl, open_orders: openOrdersList, dispositions };
  });
  const { rows: staff } = await pool.query(`SELECT DISTINCT bm.member_id FROM restaurant_location_memberships lm JOIN business_members bm ON bm.id=lm.membership_id WHERE lm.location_id=$1 AND lm.status='active' AND bm.status='active'`, [l.id]);
  const people = new Set([...staff.map(s => String(s.member_id)), ...(await storeManagers(c, l.id)).map(String)]); people.delete(String(c.userId));
  for (const p of people) await notify(p, 'restaurant_location_emergency_closed', { location: l.name }, `restaurant_location_emergency_closed:${out.closure.id}:${p}`, url(c.restaurantId));
  if (notice) for (const o of out.open_orders) {
    if (o.customer_id && String(o.customer_id) !== String(c.userId)) await notify(o.customer_id, 'restaurant_closure_customer_notice', { queue: String(o.queue_number || o.id), location: l.name, message: notice }, `restaurant_closure_customer_notice:${out.closure.id}:${o.id}`, `/food/orders/${o.id}`);
  }
  return out;
}
async function currentClosure(c, locationId) {
  const l = await location(c, locationId);
  const { rows: [cl] } = await pool.query('SELECT * FROM restaurant_location_closures WHERE location_id=$1 AND reopened_at IS NULL', [l.id]);
  // Open orders are returned whether or not a closure is active, so the
  // close form can show them (and take dispositions + a notice) before the
  // pause is requested; D-436.
  const open = await openOrders(pool, l.id);
  const { rows: dispositions } = cl ? await pool.query(`SELECT d.*, NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),'') AS decided_by_name
    FROM restaurant_closure_order_dispositions d LEFT JOIN users u ON u.id=d.decided_by WHERE d.closure_id=$1 ORDER BY d.decided_at`, [cl.id]) : { rows: [] };
  return { location_id: l.id, closure: cl || null, open_orders: open, dispositions, reopen_keys: REOPEN_KEYS };
}
async function setReopenCheck(c, locationId, key, body) {
  need(c, 'orders.manage');
  if (!REOPEN_KEYS.includes(key)) fail(404, 'not_found');
  const l = await location(c, locationId);
  const { rows: [cl] } = await pool.query(`UPDATE restaurant_location_closures SET reopen_checklist = reopen_checklist || jsonb_build_object($2::text, $3::jsonb) WHERE location_id=$1 AND reopened_at IS NULL RETURNING *`,
    [l.id, key, JSON.stringify({ done: Boolean(body?.done), by: c.userId, at: new Date().toISOString() })]);
  if (!cl) fail(404, 'not_found');
  return cl;
}
async function reopen(c, locationId) {
  need(c, 'orders.manage');
  const l = await location(c, locationId);
  return withTransaction(pool, async db => {
    const { rows: [cl] } = await db.query('SELECT * FROM restaurant_location_closures WHERE location_id=$1 AND reopened_at IS NULL FOR UPDATE', [l.id]);
    if (!cl) fail(404, 'not_found');
    const missing = REOPEN_KEYS.filter(k => !cl.reopen_checklist[k]?.done);
    if (missing.length) fail(409, 'reopen_checks_incomplete', missing.join(','));
    await db.query('UPDATE restaurant_location_closures SET reopened_at=NOW(), reopened_by=$2 WHERE id=$1', [cl.id, c.userId]);
    await db.query(`UPDATE restaurant_locations SET status=$2, updated_at=NOW() WHERE id=$1`, [l.id, cl.previous_status === 'closed' ? 'closed' : 'active']);
    return { location_id: l.id, reopened: true };
  });
}
// D-440 (431): kitchen ticket queue for the ops panel. No ticket-list read
// path existed: the shift panel only looks up one order at a time, and the
// kitchen screen routes are ack/events only. Lists the location's open
// tickets with their items and per-item station labels, the ticket owner,
// and pack progress; `station` narrows to tickets with at least one item at
// that station, `station=unassigned` to tickets with an unlabelled item.
// Read-only: owner, handoff and pack changes still go through the existing
// shift endpoints (D-250), so this list cannot disturb them.
async function kitchenTickets(c, { location_id: loc, station } = {}) {
  const l = await location(c, loc);
  const st = typeof station === 'string' ? station.trim().slice(0, 120) : '';
  if (st && st !== 'unassigned') {
    const { rows } = await pool.query('SELECT 1 FROM restaurant_kitchen_stations WHERE restaurant_id=$1 AND name=$2 AND is_active', [c.restaurantId, st]);
    if (!rows.length) fail(404, 'station_not_found');
  }
  const { rows } = await pool.query(`SELECT o.id, o.queue_number, o.status, o.fulfillment_type, o.scheduled_for, o.created_at, o.kitchen_owner_user_id, o.pack_checklist,
      NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),'') AS owner_name,
      COALESCE(json_agg(json_build_object('id', i.id, 'name', i.item_name, 'quantity', i.quantity, 'station_label', i.station_label, 'kitchen_status', i.kitchen_status) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
    FROM food_orders o LEFT JOIN food_order_items i ON i.order_id=o.id LEFT JOIN users u ON u.id=o.kitchen_owner_user_id
    WHERE o.restaurant_id=$1 AND o.location_id=$2 AND o.status IN ('received','accepted','preparing','ready')
      AND ($3::text IS NULL OR ($3 = 'unassigned' AND EXISTS (SELECT 1 FROM food_order_items x WHERE x.order_id=o.id AND x.station_label IS NULL))
        OR EXISTS (SELECT 1 FROM food_order_items x WHERE x.order_id=o.id AND x.station_label=$3))
    GROUP BY o.id, u.first_name, u.last_name ORDER BY o.created_at`,
  [c.restaurantId, l.id, st || null]);
  const { rows: stations } = await pool.query(`SELECT id, name FROM restaurant_kitchen_stations WHERE restaurant_id=$1 AND location_id=$2 AND is_active ORDER BY name`, [c.restaurantId, l.id]);
  return { location_id: l.id, station: st || null, stations, tickets: rows };
}
module.exports = { MANUAL_CHECKS, REOPEN_KEYS, REOPEN_CHECKS, CLOSURE_DISPOSITIONS, readiness, setReadinessCheck, launch, copySettings, opsSettings, updateOpsSettings, specialHours, setSpecialHours, deleteSpecialHours,
  assertOrderAllowed, slots, pickupInfo, parseCsv, importMenu, scheduleMenuChange, scheduledChanges, cancelMenuChange, applyDueMenuChanges, menuHistory,
  unclaimed, alertUnclaimed, cancellations, followUpCancellation, dispatchDelays, prepTrends, unavailability, peakLoad, repeatIssues, capacityForecast,
  reportDowntime, downtimeList, restoreDowntime, requestTransfer, transfers, decideTransfer, emergencyClose, currentClosure, setReopenCheck, reopen, kitchenTickets };
