'use strict';
// Group 8 items 401-450 (restaurant team member): shift start, tickets and
// stations, stock notices, pickup, order issues, incidents, end of shift.
const crypto = require('crypto');
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { resolveRestaurantAccess } = require('../scopeModel');
const { assertLocationAccess } = require('../restaurantLocationAccessService');
const { fail, invalid, posInt, str, oneOf, iso, can, need, storeIds, location, order, storeManagers, notify } = require('./access');
const owner = require('./ownerService');

const READINESS = ['uniform_ready', 'hands_washed', 'station_stocked', 'handoff_read'];
const PACK = ['items_verified', 'sauces_utensils', 'drinks', 'sealed', 'label_applied'];
const OPEN_ORDER = `('received','accepted','preparing','ready')`;
const url = (r, tab = 'shift') => `/restaurants/${r}/manage?tab=${tab}`;

async function openCheckin(c, db = pool, { lock = false } = {}) {
  const { rows: [k] } = await db.query(`SELECT * FROM restaurant_shift_checkins WHERE restaurant_id=$1 AND user_id=$2 AND ended_at IS NULL ${lock ? 'FOR UPDATE' : ''}`, [c.restaurantId, c.userId]);
  return k || null;
}
async function requireCheckin(c, db, opts) { const k = await openCheckin(c, db, opts); if (!k) fail(409, 'shift_not_started'); return k; }
// 401 location confirmation
async function startShift(c, body) {
  const l = await location(c, body?.location_id);
  const shiftId = body.shift_id ? posInt(body.shift_id, 'shift_id') : null;
  const existing = await openCheckin(c);
  if (existing) { if (Number(existing.location_id) !== l.id) fail(409, 'shift_open_elsewhere'); return brief(c); }
  await pool.query('INSERT INTO restaurant_shift_checkins(restaurant_id, location_id, user_id, shift_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [c.restaurantId, l.id, c.userId, shiftId]);
  return brief(c);
}
// 402-404 shift brief: tasks, station, unread handoff
async function brief(c) {
  const k = await openCheckin(c);
  if (!k) {
    const { rows: locs } = await pool.query(`SELECT id, name FROM restaurant_locations WHERE restaurant_id=$1 AND status<>'closed' AND ($2::bigint[] IS NULL OR id = ANY($2)) ORDER BY is_primary DESC, name`, [c.restaurantId, storeIds(c)]);
    const { rows: shifts } = await pool.query(`SELECT id, location_id, start_time, end_time, role_label FROM business_staff_shifts WHERE restaurant_id=$1 AND user_id=$2 AND shift_date=CURRENT_DATE AND cancelled_at IS NULL ORDER BY start_time`, [c.restaurantId, c.userId]);
    return { started: false, locations: locs, todays_shifts: shifts };
  }
  const { rows: [prev] } = await pool.query('SELECT MAX(ended_at) AS at FROM restaurant_shift_checkins WHERE restaurant_id=$1 AND user_id=$2 AND ended_at IS NOT NULL', [c.restaurantId, c.userId]);
  const since = prev?.at || new Date(Date.now() - 864e5);
  const q = (sql, args) => pool.query(sql, args).then(r => r.rows);
  const [loc, station, tasks, checklists, logbook, announcements, notices, downtime] = await Promise.all([
    q('SELECT id, name FROM restaurant_locations WHERE id=$1', [k.location_id]),
    k.station_id ? q('SELECT id, name FROM restaurant_kitchen_stations WHERE id=$1', [k.station_id]) : [],
    q(`SELECT id, title, priority, status, due_at FROM restaurant_crew_tasks WHERE restaurant_id=$1 AND assigned_to=$2 AND status IN ('not_started','in_progress') AND (location_id IS NULL OR location_id=$3) ORDER BY priority='urgent' DESC, priority='high' DESC, due_at NULLS LAST LIMIT 50`, [c.restaurantId, c.userId, k.location_id]),
    q(`SELECT c.id, c.name, c.checklist_type, r.id AS run_id, r.status AS run_status, r.completed_tasks, r.total_tasks FROM restaurant_checklists c
        LEFT JOIN restaurant_checklist_runs r ON r.checklist_id=c.id AND r.business_day=CURRENT_DATE AND (r.location_id IS NULL OR r.location_id=$2)
       WHERE c.restaurant_id=$1 AND c.is_active AND c.archived_at IS NULL ORDER BY c.sort_order, c.name`, [c.restaurantId, k.location_id]),
    q(`SELECT e.id, e.body, e.created_at, NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),'') AS author FROM restaurant_logbook_entries e LEFT JOIN users u ON u.id=e.author_user_id
       WHERE e.restaurant_id=$1 AND e.created_at > $2 ORDER BY e.created_at DESC LIMIT 30`, [c.restaurantId, since]),
    q(`SELECT a.id, a.title, a.body, a.created_at FROM restaurant_announcements a WHERE a.restaurant_id=$1 AND NOT EXISTS (SELECT 1 FROM restaurant_announcement_acks x WHERE x.announcement_id=a.id AND x.user_id=$2) ORDER BY a.created_at DESC LIMIT 20`, [c.restaurantId, c.userId]),
    q(`SELECT n.id, n.kind, n.note, i.name AS item_name, n.created_at FROM restaurant_stock_notices n LEFT JOIN food_menu_items i ON i.id=n.menu_item_id WHERE n.location_id=$1 AND n.status<>'resolved' ORDER BY n.created_at DESC LIMIT 30`, [k.location_id]),
    q(`SELECT id, equipment, started_at FROM restaurant_equipment_downtime WHERE location_id=$1 AND status='down'`, [k.location_id]),
  ]);
  return { started: true, checkin: k, location: loc[0], station: station[0] || null, tasks, checklists,
    handoff: { since, logbook, announcements, stock_notices: notices, equipment_down: downtime, unread: k.handoff_seen_at ? 0 : logbook.length + announcements.length },
    readiness_items: READINESS, ready: Boolean(k.readiness_ack_at) };
}
// 403 station assignment (self with kitchen.update, or a manager for anyone)
async function assignStation(c, body) {
  const target = body?.user_id && String(body.user_id) !== String(c.userId) ? String(body.user_id) : null;
  if (target) need(c, 'kitchen.manage'); else need(c, 'kitchen.update');
  return withTransaction(pool, async db => {
    const { rows: [k] } = await db.query('SELECT * FROM restaurant_shift_checkins WHERE restaurant_id=$1 AND user_id=$2 AND ended_at IS NULL FOR UPDATE', [c.restaurantId, target || c.userId]);
    if (!k) fail(409, 'shift_not_started');
    await location(c, k.location_id, db);
    const station = body.station_id == null ? null : posInt(body.station_id, 'station_id');
    if (station) { const { rows } = await db.query('SELECT 1 FROM restaurant_kitchen_stations WHERE id=$1 AND restaurant_id=$2 AND location_id=$3 AND is_active', [station, c.restaurantId, k.location_id]); if (!rows.length) fail(404, 'not_found'); }
    const { rows: [out] } = await db.query('UPDATE restaurant_shift_checkins SET station_id=$2, station_assigned_by=$3 WHERE id=$1 RETURNING *', [k.id, station, c.userId]);
    return out;
  });
}
// 405 readiness acknowledgment (also marks the handoff read)
async function acknowledgeReadiness(c, body) {
  const items = body?.items || {};
  const missing = READINESS.filter(k => items[k] !== true);
  if (missing.length) fail(409, 'readiness_incomplete', missing.join(','));
  const k = await requireCheckin(c);
  const { rows: [out] } = await pool.query(`UPDATE restaurant_shift_checkins SET readiness_ack_at=NOW(), handoff_seen_at=COALESCE(handoff_seen_at, NOW()), readiness_items=$2 WHERE id=$1 RETURNING *`, [k.id, JSON.stringify(items)]);
  return out;
}
// 409 batch print
async function batchPrint(c, body) {
  need(c, 'kitchen.update');
  const ids = Array.isArray(body?.order_ids) ? [...new Set(body.order_ids.map(x => posInt(x, 'order_ids')))] : [];
  if (!ids.length || ids.length > 25) invalid('order_ids');
  const { enqueueKitchenPrinterJobs } = require('../restaurantKitchenPrinterService');
  let jobs = 0;
  for (const id of ids) {
    const o = await order(c, id);
    if (!['received', 'accepted', 'preparing', 'ready'].includes(o.status)) continue;
    const out = await withTransaction(pool, db => enqueueKitchenPrinterJobs(db, { restaurantId: c.restaurantId, orderId: o.id, createdBy: c.userId }));
    jobs += Array.isArray(out) ? out.length : (out?.jobs?.length || out?.count || 0);
  }
  return { orders: ids.length, jobs };
}
// 432, 434, 437 ticket handoffs
async function handoff(c, orderId, body) {
  const kind = oneOf(body?.kind, ['owner', 'station', 'prep'], 'kind');
  need(c, 'kitchen.update');
  const out = await withTransaction(pool, async db => {
    const o = await order(c, orderId, db, { lock: true });
    if (!['received', 'accepted', 'preparing', 'ready'].includes(o.status)) fail(409, 'order_closed');
    const note = str(body.note, 1000, { required: false });
    let toUser = null; let toStation = null; let itemIds = null; let fromStation = null;
    if (kind === 'owner') {
      toUser = String(body.to_user_id || ''); if (!toUser) invalid('to_user_id');
      const { rows } = await db.query('SELECT 1 FROM restaurant_shift_checkins WHERE restaurant_id=$1 AND user_id=$2 AND location_id=$3 AND ended_at IS NULL', [c.restaurantId, toUser, o.location_id]);
      if (!rows.length) fail(409, 'teammate_not_on_shift');
      await db.query('UPDATE food_orders SET kitchen_owner_user_id=$2, screen_revision=COALESCE(screen_revision,0)+1, updated_at=NOW() WHERE id=$1', [o.id, toUser]);
    } else if (kind === 'station') {
      toStation = str(body.to_station, 80);
      if (o.location_id) { const { rows } = await db.query('SELECT 1 FROM restaurant_kitchen_stations WHERE restaurant_id=$1 AND location_id=$2 AND name=$3 AND is_active', [c.restaurantId, o.location_id, toStation]); if (!rows.length) fail(404, 'station_not_found'); }
      itemIds = Array.isArray(body.order_item_ids) && body.order_item_ids.length ? body.order_item_ids.map(x => posInt(x, 'order_item_ids')) : null;
      const { rows: moved } = await db.query(`UPDATE food_order_items SET station_label=$3, screen_revision=COALESCE(screen_revision,0)+1, updated_at=NOW() WHERE order_id=$1 AND ($2::bigint[] IS NULL OR id = ANY($2))
        AND kitchen_status NOT IN ('ready','bumped','cancelled') RETURNING id`, [o.id, itemIds, toStation]);
      if (!moved.length) fail(409, 'nothing_to_move');
      itemIds = moved.map(m => m.id);
      await db.query('UPDATE food_orders SET screen_revision=COALESCE(screen_revision,0)+1 WHERE id=$1', [o.id]);
    } else {
      fromStation = str(body.from_station, 80, { required: false }); toStation = str(body.to_station, 80, { required: false });
      if (!note) invalid('note');
    }
    const { rows: [h] } = await db.query(`INSERT INTO restaurant_ticket_handoffs(restaurant_id, order_id, kind, from_user_id, to_user_id, from_station, to_station, order_item_ids, note, created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$4) RETURNING *`,
      [c.restaurantId, o.id, kind, c.userId, toUser, fromStation, toStation, itemIds, note]);
    return { handoff: h, order: o };
  });
  if (kind === 'owner') await notify(out.handoff.to_user_id, 'restaurant_ticket_transferred', { queue: String(out.order.queue_number || out.order.id) }, `restaurant_ticket_transferred:${out.handoff.id}`, url(c.restaurantId, 'kitchen'));
  return out.handoff;
}
async function ticketHistory(c, orderId) {
  const o = await order(c, orderId);
  const { rows } = await pool.query(`SELECT h.*, NULLIF(TRIM(CONCAT(f.first_name,' ',f.last_name)),'') AS from_name, NULLIF(TRIM(CONCAT(t.first_name,' ',t.last_name)),'') AS to_name FROM restaurant_ticket_handoffs h
    LEFT JOIN users f ON f.id=h.from_user_id LEFT JOIN users t ON t.id=h.to_user_id WHERE h.order_id=$1 ORDER BY h.created_at`, [o.id]);
  return { order_id: o.id, kitchen_owner_user_id: o.kitchen_owner_user_id, handoffs: rows, pack_checklist: packView(o.pack_checklist) };
}
// 435 shared order checklist
const packView = v => PACK.map(key => ({ key, done: Boolean(v?.[key]?.done), by: v?.[key]?.by || null, at: v?.[key]?.at || null }));
async function setPack(c, orderId, key, body) {
  if (!PACK.includes(key)) fail(404, 'not_found');
  const o = await order(c, orderId);
  const { rows: [r] } = await pool.query(`UPDATE food_orders SET pack_checklist = COALESCE(pack_checklist,'{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb) WHERE id=$1 RETURNING pack_checklist`,
    [o.id, key, JSON.stringify({ done: Boolean(body?.done), by: c.userId, at: new Date().toISOString() })]);
  const items = packView(r.pack_checklist);
  return { order_id: o.id, items, complete: items.every(i => i.done) };
}
// 438 break start / return summary
async function startBreak(c) {
  const k = await requireCheckin(c);
  if (k.break_started_at) fail(409, 'already_on_break');
  const { rows: owned } = await pool.query(`SELECT id, queue_number FROM food_orders WHERE kitchen_owner_user_id=$1 AND restaurant_id=$2 AND status IN ${OPEN_ORDER}`, [c.userId, c.restaurantId]);
  await pool.query('UPDATE restaurant_shift_checkins SET break_started_at=NOW() WHERE id=$1', [k.id]);
  return { on_break: true, owned_open_tickets: owned };
}
async function endBreak(c) {
  const k = await requireCheckin(c);
  if (!k.break_started_at) fail(409, 'not_on_break');
  const since = k.break_started_at;
  const q = (sql, a) => pool.query(sql, a).then(r => r.rows);
  const [[counts], handoffs, notes, notices, downtime, issues] = await Promise.all([
    q(`SELECT COUNT(*) FILTER (WHERE created_at > $2)::int AS new_orders, COUNT(*) FILTER (WHERE ready_at > $2)::int AS ready_orders, COUNT(*) FILTER (WHERE status IN ${OPEN_ORDER})::int AS open_orders FROM food_orders WHERE location_id=$1`, [k.location_id, since]),
    q(`SELECT h.order_id, h.kind, h.to_station, h.note, h.created_at FROM restaurant_ticket_handoffs h WHERE h.restaurant_id=$1 AND h.created_at > $2 AND (h.to_user_id=$3 OR h.from_user_id=$3)`, [c.restaurantId, since, c.userId]),
    q('SELECT id, body, created_at FROM restaurant_logbook_entries WHERE restaurant_id=$1 AND created_at > $2 ORDER BY created_at DESC LIMIT 20', [c.restaurantId, since]),
    q(`SELECT id, kind, note FROM restaurant_stock_notices WHERE location_id=$1 AND created_at > $2`, [k.location_id, since]),
    q(`SELECT id, equipment, status FROM restaurant_equipment_downtime WHERE location_id=$1 AND (started_at > $2 OR restored_at > $2)`, [k.location_id, since]),
    q(`SELECT id, kind, status, order_id FROM restaurant_order_issues WHERE location_id=$1 AND created_at > $2`, [k.location_id, since]),
  ]);
  await pool.query('UPDATE restaurant_shift_checkins SET break_started_at=NULL, last_break_ended_at=NOW() WHERE id=$1', [k.id]);
  return { break_started_at: since, ...counts, handoffs, logbook: notes, stock_notices: notices, equipment: downtime, order_issues: issues };
}
// 413-415, 448 stock notices
async function createStockNotice(c, body) {
  const kind = oneOf(body?.kind, ['low_stock', 'substitution', 'menu_correction'], 'kind');
  const l = await location(c, body.location_id);
  const item = body.menu_item_id ? posInt(body.menu_item_id, 'menu_item_id') : null;
  if (item) { const { rows } = await pool.query('SELECT 1 FROM food_menu_items WHERE id=$1 AND restaurant_id=$2', [item, c.restaurantId]); if (!rows.length) fail(404, 'not_found'); } else if (kind !== 'menu_correction') invalid('menu_item_id');
  const subs = kind === 'substitution' ? (Array.isArray(body.substitutes) && body.substitutes.length && body.substitutes.length <= 10 ? body.substitutes.map(s => str(s, 120)) : invalid('substitutes')) : [];
  const note = str(body.note, 1000, { required: kind === 'menu_correction' });
  const { rows: [n] } = await pool.query(`INSERT INTO restaurant_stock_notices(restaurant_id, location_id, menu_item_id, kind, note, substitutes, created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [c.restaurantId, l.id, item, kind, note, JSON.stringify(subs), c.userId]);
  for (const m of (await storeManagers(c, l.id)).filter(x => String(x) !== String(c.userId))) await notify(m, 'restaurant_stock_notice', { location: l.name }, `restaurant_stock_notice:${n.id}:${m}`, url(c.restaurantId, 'menu'));
  return n;
}
async function stockNotices(c, { location_id: loc, status } = {}) {
  const { rows } = await pool.query(`SELECT n.*, i.name AS item_name, l.name AS location_name, NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),'') AS created_by_name FROM restaurant_stock_notices n
    LEFT JOIN food_menu_items i ON i.id=n.menu_item_id JOIN restaurant_locations l ON l.id=n.location_id LEFT JOIN users u ON u.id=n.created_by
    WHERE n.restaurant_id=$1 AND ($2::bigint[] IS NULL OR n.location_id = ANY($2)) AND ($3::bigint IS NULL OR n.location_id=$3) AND ($4::text IS NULL OR n.status=$4) ORDER BY n.status='resolved', n.created_at DESC LIMIT 200`,
  [c.restaurantId, storeIds(c), loc ? posInt(loc, 'location_id') : null, ['open', 'acknowledged', 'resolved'].includes(status) ? status : null]);
  return { notices: rows };
}
async function updateStockNotice(c, id, body) {
  if (!(can(c, 'menu.manage') || can(c, 'kitchen.manage') || can(c, 'inventory.manage'))) fail(403, 'permission_required');
  const st = oneOf(body?.status, ['acknowledged', 'resolved'], 'status');
  const { rows: [n] } = await pool.query('SELECT * FROM restaurant_stock_notices WHERE id=$1 AND restaurant_id=$2', [posInt(id, 'id'), c.restaurantId]);
  if (!n) fail(404, 'not_found');
  await location(c, n.location_id);
  const { rows: [out] } = await pool.query(`UPDATE restaurant_stock_notices SET status=$2, resolution=COALESCE($3, resolution), resolved_by=CASE WHEN $2='resolved' THEN $4::uuid ELSE resolved_by END, resolved_at=CASE WHEN $2='resolved' THEN NOW() ELSE resolved_at END WHERE id=$1 RETURNING *`,
    [n.id, st, str(body.resolution, 1000, { required: false }), c.userId]);
  return out;
}
// 416 package label
async function packageLabel(c, orderId) {
  const o = await order(c, orderId);
  const { rows: items } = await pool.query(`SELECT oi.item_name, oi.quantity, oi.special_instructions, mi.allergens FROM food_order_items oi LEFT JOIN food_menu_items mi ON mi.id=oi.menu_item_id WHERE oi.order_id=$1 ORDER BY oi.id`, [o.id]);
  const { rows: [r] } = await pool.query('SELECT display_name FROM food_restaurants WHERE id=$1', [c.restaurantId]);
  const name = String(o.pickup_contact_name || o.guest_name || '').trim();
  const short = name ? name.split(/\s+/).map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(' ') : null;
  return { order_id: o.id, restaurant: r?.display_name, queue_number: o.queue_number, customer: short, fulfillment_type: o.fulfillment_type, scheduled_for: o.scheduled_for, table_label: o.table_label,
    item_count: items.reduce((t, i) => t + i.quantity, 0), items: items.map(i => ({ name: i.item_name, quantity: i.quantity, note: i.special_instructions, allergens: i.allergens || [] })),
    allergens: [...new Set(items.flatMap(i => i.allergens || []))], printed_at: new Date().toISOString() };
}
// 417 pickup code confirmation (5 tries, then manager override only)
async function verifyPickupCode(c, orderId, body) {
  const code = String(body?.code || '').trim();
  if (!/^\d{4,6}$/.test(code)) invalid('code');
  return withTransaction(pool, async db => {
    const o = await order(c, orderId, db, { lock: true });
    if (o.fulfillment_type !== 'pickup' || !o.pickup_code) fail(409, 'no_pickup_code');
    const tries = Number(o.metadata?.pickupCodeAttempts || 0);
    if (tries >= 5) fail(429, 'pickup_code_locked');
    const ok = crypto.timingSafeEqual(Buffer.from(code.padEnd(6)), Buffer.from(String(o.pickup_code).padEnd(6)));
    if (!ok) {
      await db.query(`UPDATE food_orders SET metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('pickupCodeAttempts', $2::int) WHERE id=$1`, [o.id, tries + 1]);
      return { verified: false, attempts_left: 4 - tries };
    }
    await db.query('UPDATE food_orders SET pickup_code_verified_at=NOW() WHERE id=$1', [o.id]);
    return { verified: true };
  });
}
// 418 driver arrival list
const meters = (a, b, c2, d) => { const R = 6371000; const r = x => x * Math.PI / 180; const dl = r(c2 - a); const dn = r(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c2)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
async function driverArrivals(c, { location_id: loc } = {}) {
  const l = await location(c, loc);
  const { rows } = await pool.query(`SELECT t.id, t.order_reference, t.food_order_id, t.status, t.pickup_eta_at, t.last_latitude, t.last_longitude, t.last_location_at, o.queue_number, o.status AS order_status,
      NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),'') AS driver_name
    FROM restaurant_runner_tasks t LEFT JOIN food_orders o ON o.id=t.food_order_id LEFT JOIN users u ON u.id=t.assigned_to
    WHERE t.restaurant_id=$1 AND t.location_id=$2 AND t.task_type='Delivery' AND t.status IN ('Assigned','Ready') ORDER BY t.pickup_eta_at NULLS LAST`, [c.restaurantId, l.id]);
  return { location_id: l.id, drivers: rows.map(r => {
    const fresh = r.last_location_at && Date.now() - new Date(r.last_location_at).getTime() < 10 * 60000;
    const dist = fresh && l.latitude != null && r.last_latitude != null ? Math.round(meters(Number(l.latitude), Number(l.longitude), Number(r.last_latitude), Number(r.last_longitude))) : null;
    return { ...r, last_latitude: undefined, last_longitude: undefined, distance_m: dist, arrived: dist != null && dist <= 150, eta_minutes: r.pickup_eta_at ? Math.round((new Date(r.pickup_eta_at) - Date.now()) / 60000) : null };
  }) };
}
// 421-425 order issues
async function reportIssue(c, orderId, body) {
  const kind = oneOf(body?.kind, ['missing_item', 'substitution', 'wrong_order', 'late'], 'kind');
  const out = await withTransaction(pool, async db => {
    const o = await order(c, orderId, db, { lock: true });
    const itemId = body.order_item_id ? posInt(body.order_item_id, 'order_item_id') : null;
    if (itemId) { const { rows } = await db.query('SELECT 1 FROM food_order_items WHERE id=$1 AND order_id=$2', [itemId, o.id]); if (!rows.length) fail(404, 'not_found'); }
    const { rows: [l] } = o.location_id ? await db.query('SELECT substitution_policy FROM restaurant_locations WHERE id=$1', [o.location_id]) : { rows: [{ substitution_policy: 'contact_customer' }] };
    let response = null; let status = 'open'; let escalatedTo = null; let substitute = null;
    if (kind === 'substitution') {
      if (!itemId) invalid('order_item_id');
      if (['refund_item', 'cancel_order'].includes(l.substitution_policy)) fail(409, 'substitution_not_allowed', l.substitution_policy);
      substitute = str(body.proposed_substitute, 160);
      response = l.substitution_policy === 'substitute_similar' ? 'accepted' : 'pending';
    }
    if (kind === 'late' && ['ready', 'completed', 'cancelled', 'refunded'].includes(o.status)) fail(409, 'order_not_late');
    if (kind === 'wrong_order') { status = 'escalated'; escalatedTo = (await storeManagers(c, o.location_id, db)).find(x => String(x) !== String(c.userId)) || null; }
    const { rows: [i] } = await db.query(`INSERT INTO restaurant_order_issues(restaurant_id, location_id, order_id, order_item_id, kind, detail, proposed_substitute, customer_response, customer_responded_at, status, escalated_to, created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8::varchar='accepted' THEN NOW() END,$9,$10,$11) RETURNING *`, [c.restaurantId, o.location_id, o.id, itemId, kind, str(body.detail, 1000, { required: kind !== 'substitution' && kind !== 'late' }), substitute, response, status, escalatedTo, c.userId]);
    return { issue: i, order: o };
  });
  const { issue: i, order: o } = out;
  const q = String(o.queue_number || o.id);
  if (i.kind === 'substitution' && o.customer_id) await notify(o.customer_id, 'restaurant_substitution_request', { item: i.proposed_substitute }, `restaurant_substitution_request:${i.id}`, `/food/orders/${o.id}`);
  if (i.escalated_to) await notify(i.escalated_to, 'restaurant_order_issue_escalated', { queue: q }, `restaurant_order_issue_escalated:${i.id}`, url(c.restaurantId, 'orders'));
  if (i.kind === 'late') for (const m of (await storeManagers(c, o.location_id)).filter(x => String(x) !== String(c.userId))) await notify(m, 'restaurant_order_late', { queue: q }, `restaurant_order_late:${i.id}:${m}`, url(c.restaurantId, 'orders'));
  return i;
}
const NO_RESPONSE_MIN = 10;
const issueView = i => ({ ...i, customer_response: i.customer_response === 'pending' && Date.now() - new Date(i.created_at).getTime() > NO_RESPONSE_MIN * 60000 ? 'no_response' : i.customer_response });
async function issues(c, { order_id: orderId, status } = {}) {
  const oid = orderId ? (await order(c, orderId)).id : null;
  const { rows } = await pool.query(`SELECT i.*, o.queue_number, oi.item_name, NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),'') AS escalated_to_name FROM restaurant_order_issues i JOIN food_orders o ON o.id=i.order_id
    LEFT JOIN food_order_items oi ON oi.id=i.order_item_id LEFT JOIN users u ON u.id=i.escalated_to
    WHERE i.restaurant_id=$1 AND ($2::bigint[] IS NULL OR i.location_id = ANY($2)) AND ($3::bigint IS NULL OR i.order_id=$3) AND ($4::text IS NULL OR i.status=$4) ORDER BY i.status='resolved', i.created_at DESC LIMIT 200`,
  [c.restaurantId, storeIds(c), oid, ['open', 'escalated', 'resolved'].includes(status) ? status : null]);
  return { issues: rows.map(issueView) };
}
async function issueFor(c, id, db = pool) {
  const { rows: [i] } = await db.query('SELECT * FROM restaurant_order_issues WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [posInt(id, 'id'), c.restaurantId]);
  if (!i) fail(404, 'not_found');
  if (i.location_id) await assertLocationAccess(c.restaurant, c.userId, i.location_id, db).catch(() => fail(404, 'not_found'));
  return i;
}
async function escalateIssue(c, id) {
  const out = await withTransaction(pool, async db => {
    const i = await issueFor(c, id, db);
    if (i.status !== 'open') fail(409, 'issue_not_open');
    const to = (await storeManagers(c, i.location_id, db)).find(x => String(x) !== String(c.userId)) || null;
    const { rows: [r] } = await db.query(`UPDATE restaurant_order_issues SET status='escalated', escalated_to=$2 WHERE id=$1 RETURNING *`, [i.id, to]);
    return r;
  });
  if (out.escalated_to) await notify(out.escalated_to, 'restaurant_order_issue_escalated', { queue: String(out.order_id) }, `restaurant_order_issue_escalated:${out.id}`, url(c.restaurantId, 'orders'));
  return issueView(out);
}
async function resolveIssue(c, id, body) {
  return withTransaction(pool, async db => {
    const i = await issueFor(c, id, db);
    if (i.status === 'resolved') fail(409, 'issue_resolved');
    if (i.status === 'escalated' && !can(c, 'orders.manage') && String(i.escalated_to) !== String(c.userId)) fail(403, 'permission_required');
    const { rows: [r] } = await db.query(`UPDATE restaurant_order_issues SET status='resolved', resolution=$2, resolved_by=$3, resolved_at=NOW() WHERE id=$1 RETURNING *`, [i.id, str(body?.resolution, 1000), c.userId]);
    return issueView(r);
  });
}
// 423 late orders at my stores
async function lateOrders(c) {
  const { rows } = await pool.query(`SELECT o.id, o.queue_number, o.status, o.promised_at, o.location_id, ROUND(EXTRACT(EPOCH FROM NOW()-o.promised_at)/60)::int AS late_minutes,
      EXISTS (SELECT 1 FROM restaurant_order_issues i WHERE i.order_id=o.id AND i.kind='late' AND i.status<>'resolved') AS flagged
    FROM food_orders o WHERE o.restaurant_id=$1 AND o.status IN ('received','accepted','preparing') AND o.promised_at < NOW() AND ($2::bigint[] IS NULL OR o.location_id = ANY($2)) ORDER BY o.promised_at LIMIT 100`, [c.restaurantId, storeIds(c)]);
  return { orders: rows };
}
// 425 customer answers a substitution question (signed-in owner of the order, or tracking token)
async function customerRespond({ userId = null, trackingTokenHash = null }, issueId, body) {
  const response = oneOf(body?.response, ['accepted', 'declined'], 'response');
  return withTransaction(pool, async db => {
    const { rows: [i] } = await db.query(`SELECT i.*, o.customer_id, o.metadata->>'trackingToken' AS token FROM restaurant_order_issues i JOIN food_orders o ON o.id=i.order_id WHERE i.id=$1 FOR UPDATE OF i`, [posInt(issueId, 'issueId')]);
    const mine = i && ((userId && String(i.customer_id) === String(userId)) || (trackingTokenHash && i.token === trackingTokenHash));
    if (!mine || i.kind !== 'substitution') fail(404, 'not_found');
    if (i.customer_response !== 'pending') fail(409, 'already_answered');
    await db.query('UPDATE restaurant_order_issues SET customer_response=$2, customer_responded_at=NOW() WHERE id=$1', [i.id, response]);
    return { id: i.id, customer_response: response };
  });
}
async function pendingQuestions(orderId) {
  const { rows } = await pool.query(`SELECT i.id, i.proposed_substitute, oi.item_name, i.created_at FROM restaurant_order_issues i LEFT JOIN food_order_items oi ON oi.id=i.order_item_id
    WHERE i.order_id=$1 AND i.kind='substitution' AND i.customer_response='pending'`, [orderId]);
  return rows;
}
// 441, 444, 445 incidents (help requests with category, owner, follow-up)
const CATEGORIES = ['food_service', 'equipment', 'safety', 'guest', 'other'];
async function createIncident(c, body) {
  const category = oneOf(body?.category, CATEGORIES, 'category');
  const l = await location(c, body.location_id);
  const urgency = oneOf(body.urgency, ['Low', 'Medium', 'High'], 'urgency', 'Medium');
  const orderId = body.order_id ? (await order(c, body.order_id)).id : null;
  const ownerId = (await storeManagers(c, l.id)).find(x => String(x) !== String(c.userId)) || c.userId;
  const followHours = category === 'food_service' || category === 'safety' ? 24 : 72;
  const { rows: [h] } = await pool.query(`INSERT INTO restaurant_help_requests(restaurant_id, title, detail, urgency, status, linked_location, created_by, updated_by, category, assigned_to_user_id, follow_up_at, location_id, order_id)
    VALUES($1,$2,$3,$4,'open',$5,$6,$6,$7,$8,NOW() + make_interval(hours => $9),$10,$11) RETURNING *`, [c.restaurantId, str(body.title, 160), str(body.detail, 4000, { required: false }) || '', urgency, l.name, c.userId, category, ownerId, followHours, l.id, orderId]);
  if (String(ownerId) !== String(c.userId)) await notify(ownerId, 'restaurant_incident_assigned', { title: h.title }, `restaurant_incident_assigned:${h.id}`, url(c.restaurantId, 'help'));
  return h;
}
async function incidents(c, { mine } = {}) {
  const { rows } = await pool.query(`SELECT h.id, h.title, h.detail, h.urgency, h.status, h.category, h.location_id, h.order_id, h.follow_up_at, h.resolution_note, h.created_at, h.assigned_to_user_id,
      NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),'') AS owner_name, (h.status<>'resolved' AND h.follow_up_at < NOW()) AS follow_up_overdue
    FROM restaurant_help_requests h LEFT JOIN users u ON u.id=h.assigned_to_user_id
    WHERE h.restaurant_id=$1 AND h.category<>'general' AND ($2::bigint[] IS NULL OR h.location_id = ANY($2)) AND (NOT $3::boolean OR h.created_by=$4 OR h.assigned_to_user_id=$4)
    ORDER BY h.status='resolved', h.follow_up_at NULLS LAST LIMIT 200`, [c.restaurantId, storeIds(c), Boolean(mine), c.userId]);
  return { incidents: rows };
}
async function updateIncident(c, id, body) {
  const { rows: [h] } = await pool.query(`SELECT * FROM restaurant_help_requests WHERE id=$1 AND restaurant_id=$2 AND category<>'general'`, [posInt(id, 'id'), c.restaurantId]);
  if (!h) fail(404, 'not_found');
  if (h.location_id) await location(c, h.location_id);
  const isOwner = String(h.assigned_to_user_id) === String(c.userId);
  if (!isOwner && !can(c, 'support.manage') && !can(c, 'orders.manage')) fail(403, 'permission_required');
  const f = {};
  if (body?.status !== undefined) f.status = oneOf(body.status, ['open', 'in_progress', 'resolved'], 'status');
  if (body?.resolution_note !== undefined) f.resolution_note = str(body.resolution_note, 2000, { required: false });
  if (body?.follow_up_at !== undefined) f.follow_up_at = body.follow_up_at ? iso(body.follow_up_at, 'follow_up_at') : null;
  if (body?.assigned_to_user_id !== undefined) {
    const to = String(body.assigned_to_user_id || '');
    const { rows } = await pool.query(`SELECT 1 FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active' UNION SELECT 1 FROM businesses WHERE id=$1 AND user_id=$2`, [c.restaurant.business_id, to]);
    if (!rows.length) invalid('assigned_to_user_id');
    f.assigned_to_user_id = to;
  }
  if (f.status === 'resolved' && !(f.resolution_note || h.resolution_note)) fail(409, 'resolution_required');
  const k = Object.keys(f); if (!k.length) invalid();
  const { rows: [out] } = await pool.query(`UPDATE restaurant_help_requests SET ${k.map((x, i) => `${x}=$${i + 2}`).join(', ')}, updated_by=$${k.length + 2}, updated_at=NOW() WHERE id=$1 RETURNING *`, [h.id, ...k.map(x => f[x]), c.userId]);
  if (f.assigned_to_user_id && f.assigned_to_user_id !== String(c.userId)) await notify(f.assigned_to_user_id, 'restaurant_incident_assigned', { title: out.title }, `restaurant_incident_assigned:${out.id}:${f.assigned_to_user_id}`, url(c.restaurantId, 'help'));
  return out;
}
// 446-449 end of shift
async function endShiftPreview(c) {
  const k = await requireCheckin(c);
  const { rows: [st] } = k.station_id ? await pool.query('SELECT name FROM restaurant_kitchen_stations WHERE id=$1', [k.station_id]) : { rows: [] };
  const q = (sql, a) => pool.query(sql, a).then(r => r.rows);
  const [owned, stationOpen, pickup, notices, myIssues, teammates] = await Promise.all([
    q(`SELECT id, queue_number, status FROM food_orders WHERE kitchen_owner_user_id=$1 AND restaurant_id=$2 AND status IN ${OPEN_ORDER}`, [c.userId, c.restaurantId]),
    st ? q(`SELECT DISTINCT o.id, o.queue_number, o.status FROM food_orders o JOIN food_order_items oi ON oi.order_id=o.id WHERE o.location_id=$1 AND oi.station_label=$2 AND oi.kitchen_status NOT IN ('ready','bumped','cancelled') AND o.status IN ${OPEN_ORDER}`, [k.location_id, st.name]) : [],
    owner.unclaimed(c, { location_id: k.location_id }).then(r => r.orders),
    q(`SELECT id, kind, note, status FROM restaurant_stock_notices WHERE location_id=$1 AND status<>'resolved'`, [k.location_id]),
    q(`SELECT id, kind, status, order_id FROM restaurant_order_issues WHERE created_by=$1 AND restaurant_id=$2 AND status<>'resolved'`, [c.userId, c.restaurantId]),
    q(`SELECT k.user_id, NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),'') AS name FROM restaurant_shift_checkins k JOIN users u ON u.id=k.user_id WHERE k.location_id=$1 AND k.ended_at IS NULL AND k.user_id<>$2`, [k.location_id, c.userId]),
  ]);
  return { checkin_id: k.id, owned_tickets: owned, station_open_tickets: stationOpen, pickup_exceptions: pickup, stock_notices: notices, my_open_issues: myIssues, teammates_on_shift: teammates, needs_handoff: owned.length > 0 };
}
async function endShift(c, body) {
  const preview = await endShiftPreview(c);
  const to = body?.handoff_to_user_id ? String(body.handoff_to_user_id) : null;
  if (preview.needs_handoff && !to) fail(409, 'handoff_required');
  if (to && !preview.teammates_on_shift.some(t => String(t.user_id) === to)) fail(409, 'teammate_not_on_shift');
  const note = str(body?.note, 2000, { required: false });
  const out = await withTransaction(pool, async db => {
    const k = await requireCheckin(c, db, { lock: true });
    if (to && preview.owned_tickets.length) {
      await db.query(`UPDATE food_orders SET kitchen_owner_user_id=$1, screen_revision=COALESCE(screen_revision,0)+1 WHERE kitchen_owner_user_id=$2 AND restaurant_id=$3 AND status IN ${OPEN_ORDER}`, [to, c.userId, c.restaurantId]);
      for (const o of preview.owned_tickets) await db.query(`INSERT INTO restaurant_ticket_handoffs(restaurant_id, order_id, kind, from_user_id, to_user_id, note, created_by) VALUES($1,$2,'owner',$3,$4,$5,$3)`, [c.restaurantId, o.id, c.userId, to, 'end_of_shift']);
    }
    const summary = { handed_off_tickets: to ? preview.owned_tickets.length : 0, handoff_to: to, station_open_tickets: preview.station_open_tickets.length, pickup_exceptions: preview.pickup_exceptions.length, open_stock_notices: preview.stock_notices.length, open_issues: preview.my_open_issues.length, note };
    if (note || summary.station_open_tickets || summary.pickup_exceptions || summary.open_stock_notices) {
      const body2 = [note, `open tickets ${summary.station_open_tickets} · pickup exceptions ${summary.pickup_exceptions} · stock notices ${summary.open_stock_notices}`].filter(Boolean).join('\n');
      await db.query('INSERT INTO restaurant_logbook_entries(restaurant_id, author_user_id, body) VALUES($1,$2,$3)', [c.restaurantId, c.userId, body2.slice(0, 4000)]);
    }
    await db.query(`UPDATE restaurant_shift_checkins SET ended_at=NOW(), end_summary=$2, break_started_at=NULL WHERE id=$1`, [k.id, JSON.stringify(summary)]);
    return summary;
  });
  if (to && out.handed_off_tickets) await notify(to, 'restaurant_ticket_transferred', { queue: String(out.handed_off_tickets) }, `restaurant_ticket_transferred:eos:${preview.checkin_id}`, url(c.restaurantId, 'kitchen'));
  return { ended: true, summary: out };
}
// 450 access change recovery: open check-ins where the user lost store access
async function accessStatus(userId) {
  const { rows } = await pool.query(`SELECT k.id, k.restaurant_id, k.location_id, l.name AS location_name, r.display_name AS restaurant_name FROM restaurant_shift_checkins k
    JOIN restaurant_locations l ON l.id=k.location_id JOIN food_restaurants r ON r.id=k.restaurant_id WHERE k.user_id=$1 AND k.ended_at IS NULL`, [userId]);
  const lost = [];
  for (const k of rows) {
    let ok = false;
    try { const restaurant = await resolveRestaurantAccess(userId, Number(k.restaurant_id)); await assertLocationAccess(restaurant, userId, k.location_id); ok = true; } catch { ok = false; }
    if (!ok) {
      const { rows: owned } = await pool.query(`SELECT id, queue_number FROM food_orders WHERE kitchen_owner_user_id=$1 AND restaurant_id=$2 AND status IN ${OPEN_ORDER}`, [userId, k.restaurant_id]);
      lost.push({ checkin_id: k.id, restaurant_id: k.restaurant_id, restaurant_name: k.restaurant_name, location_name: k.location_name, owned_open_tickets: owned.length });
    }
  }
  return { lost_access: lost };
}
async function recoverAccess(userId) {
  const { lost_access: lost } = await accessStatus(userId);
  for (const k of lost) {
    const managers = await withTransaction(pool, async db => {
      await db.query(`UPDATE food_orders SET kitchen_owner_user_id=NULL, screen_revision=COALESCE(screen_revision,0)+1 WHERE kitchen_owner_user_id=$1 AND restaurant_id=$2 AND status IN ${OPEN_ORDER}`, [userId, k.restaurant_id]);
      await db.query(`UPDATE restaurant_shift_checkins SET ended_at=NOW(), end_summary=jsonb_build_object('ended_by','access_change','released_tickets',$2::int) WHERE id=$1`, [k.checkin_id, k.owned_open_tickets]);
      const { rows: [r] } = await db.query('SELECT business_id FROM food_restaurants WHERE id=$1', [k.restaurant_id]);
      const { rows: m } = await db.query(`SELECT user_id FROM businesses WHERE id=$1 UNION SELECT member_id FROM business_members WHERE business_id=$1 AND role='manager' AND status='active' AND member_id IS NOT NULL`, [r.business_id]);
      return m.map(x => x.user_id);
    });
    for (const m of managers.filter(x => String(x) !== String(userId))) await notify(m, 'restaurant_access_change_handoff', { location: k.location_name }, `restaurant_access_change_handoff:${k.checkin_id}:${m}`, `/restaurants/${k.restaurant_id}/manage?tab=kitchen`);
  }
  return { recovered: lost.length };
}
module.exports = { READINESS, PACK, startShift, brief, assignStation, acknowledgeReadiness, batchPrint, handoff, ticketHistory, setPack, startBreak, endBreak,
  createStockNotice, stockNotices, updateStockNotice, packageLabel, verifyPickupCode, driverArrivals, reportIssue, issues, escalateIssue, resolveIssue, lateOrders,
  customerRespond, pendingQuestions, createIncident, incidents, updateIncident, endShiftPreview, endShift, accessStatus, recoverAccess };
