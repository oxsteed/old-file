'use strict';
// Group 8 items 351-450: restaurant owner/manager ops and team shift tools.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/(credit_statement_test|pa_g\d+|g56)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); };
  return { authenticate, requireAuth: authenticate, optionalAuth: (req, res, next) => next() };
});
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const describeDb = raw ? describe : describe.skip;
const owner = crypto.randomUUID(), cook = crypto.randomUUID(), cook2 = crypto.randomUUID();
let app, bizId, rid, locA, locB, itemId;
const as = (u) => ({ 'x-user': u });

describeDb('Group 8: restaurant persona', () => {
  beforeAll(async () => {
    for (const id of [owner, cook, cook2]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified) VALUES($1,$2,'x','Rest','User','customer',TRUE,TRUE)", [id, `g8-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name) VALUES($1,'G8 Diner') RETURNING id", [owner]));
    for (const id of [cook, cook2]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,'employee','active',NOW())", [bizId, owner, id, `g8-${id}@x.invalid`]);
    ({ rows: [{ id: rid }] } = await pool.query("INSERT INTO food_restaurants(business_id,owner_user_id,display_name,timezone,slug,status) VALUES($1,$2,'G8 Diner','UTC',$3,'active') RETURNING id", [bizId, owner, `g8-${bizId}`]));
    ({ rows: [{ id: locA } = {}] } = await pool.query("SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary", [rid]));
    if (!locA) ({ rows: [{ id: locA }] } = await pool.query("INSERT INTO restaurant_locations(restaurant_id,name,is_primary,status) VALUES($1,'Main',TRUE,'active') RETURNING id", [rid]));
    await pool.query("UPDATE restaurant_locations SET status='active' WHERE id=$1", [locA]);
    ({ rows: [{ id: locB }] } = await pool.query("INSERT INTO restaurant_locations(restaurant_id,name,status) VALUES($1,'Annex','active') RETURNING id", [rid]));
    ({ rows: [{ id: itemId }] } = await pool.query("INSERT INTO food_menu_items(restaurant_id,name,price_cents) VALUES($1,'Burger',1000) RETURNING id", [rid]));
    app = express(); app.use(express.json());
    app.use('/api/restaurants', require('../routes/restaurantPersona'));
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code, message: err.message })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM food_restaurants WHERE id=$1', [rid]).catch(() => {}); await pool.end(); });
  const O = () => `/api/restaurants/${rid}/ops`; const S = () => `/api/restaurants/${rid}/shift`;
  const mkOrder = (extra = {}) => pool.query(`INSERT INTO food_orders(restaurant_id,business_id,order_source,fulfillment_type,status,subtotal_cents,total_cents,location_id,promised_at,ready_at,queue_number)
    VALUES($1,$2,'web','pickup',$3,1000,1000,$4,$5,$6,floor(random()*900+100)::int) RETURNING *`, [rid, bizId, extra.status || 'accepted', extra.loc || locA, extra.promised_at || null, extra.ready_at || null]).then(r => r.rows[0]);

  test('353-397 owner ops: readiness, settings, holiday hours, slots, menu import/schedule/history, closure', async () => {
    const rd = (await request(app).get(`${O()}/locations/${locA}/readiness`).set(as(owner)).expect(200)).body;
    expect(rd.ready).toBe(false); expect(rd.checks.find(c => c.key === 'menu').done).toBe(true);
    await request(app).post(`${O()}/locations/${locA}/launch`).set(as(owner)).expect(409);
    await request(app).post(`${O()}/locations/${locA}/readiness/staff_trained`).set(as(cook)).send({ done: true }).expect(403);
    await request(app).patch(`${O()}/locations/${locA}/settings`).set(as(owner)).send({ pickup_area_label: 'Shelf by door', substitution_policy: 'contact_customer', scheduled_slot_max_orders: 1 }).expect(200);
    expect((await request(app).post(`${O()}/locations/${locB}/copy-settings`).set(as(owner)).send({ from_location_id: locA, groups: ['pickup'] }).expect(200)).body.columns).toBe(5);
    expect((await request(app).get(`/api/restaurants/${rid}/locations/${locB}/pickup-info`).expect(200)).body.pickup_area_label).toBe('Shelf by door');
    const today = new Date().toISOString().slice(0, 10);
    await request(app).put(`${O()}/locations/${locA}/special-hours`).set(as(owner)).send({ on_date: today, closed: true, label: 'Holiday' }).expect(200);
    const ops = require('../services/restaurantPersona/ownerService');
    await expect(ops.assertOrderAllowed(pool, { restaurantId: rid, locationId: locA, timezone: 'UTC' })).rejects.toMatchObject({ code: 'restaurant_closed' });
    await pool.query('DELETE FROM restaurant_location_special_hours WHERE location_id=$1', [locA]);
    const later = new Date(Date.now() + 3 * 36e5).toISOString();
    await pool.query("INSERT INTO food_orders(restaurant_id,business_id,order_source,fulfillment_type,status,subtotal_cents,total_cents,location_id,scheduled_for,queue_number) VALUES($1,$2,'web','pickup','received',1,1,$3,$4,7)", [rid, bizId, locA, later]);
    await expect(ops.assertOrderAllowed(pool, { restaurantId: rid, locationId: locA, scheduledFor: later, timezone: 'UTC' })).rejects.toMatchObject({ code: 'pickup_slot_full' });
    const imp = (await request(app).post(`${O()}/menu/import`).set(as(owner)).send({ csv: 'name,price,category\nFries,3.50,Sides\nBurger,9,Mains\n,2,x' }).expect(200)).body;
    expect(imp).toMatchObject({ dry_run: true, create: 1, skipped: 2 });
    expect((await request(app).post(`${O()}/menu/import`).set(as(owner)).send({ csv: 'name,price,category\nFries,3.50,Sides', dry_run: false }).expect(200)).body.created).toBe(1);
    const ch = (await request(app).post(`${O()}/menu/scheduled`).set(as(owner)).send({ menu_item_id: itemId, price_cents: 1200, effective_at: new Date(Date.now() + 60000).toISOString() }).expect(201)).body;
    await pool.query("UPDATE restaurant_scheduled_menu_changes SET effective_at=NOW() - INTERVAL '1 second' WHERE id=$1", [ch.id]);
    expect((await ops.applyDueMenuChanges({ restaurantId: rid })).applied).toBe(1);
    const hist = (await request(app).get(`${O()}/menu/history?menu_item_id=${itemId}`).set(as(owner)).expect(200)).body.changes;
    expect(hist[0]).toMatchObject({ field: 'price_cents', old_value: '1000', new_value: '1200', source: 'scheduled' });
    const cl = (await request(app).post(`${O()}/emergency-closures`).set(as(owner)).send({ location_id: locB, reason: 'power' }).expect(201)).body;
    expect(cl.closure.reason).toBe('power');
    await expect(ops.assertOrderAllowed(pool, { restaurantId: rid, locationId: locB })).rejects.toMatchObject({ code: 'location_emergency_closed' });
    await request(app).post(`${O()}/locations/${locB}/reopen`).set(as(owner)).expect(409);
    for (const k of ops.REOPEN_KEYS) await request(app).post(`${O()}/locations/${locB}/closure/checks/${k}`).set(as(owner)).send({ done: true }).expect(200);
    await request(app).post(`${O()}/locations/${locB}/reopen`).set(as(owner)).expect(200);
    for (const p of ['dispatch-delays', 'prep-trends', 'unavailability', 'peak-load', 'repeat-issues']) await request(app).get(`${O()}/reports/${p}`).set(as(owner)).expect(200);
    expect((await request(app).get(`${O()}/reports/capacity-forecast?location_id=${locA}`).set(as(owner)).expect(200)).body.hours.length).toBe(24);
  });

  test('391, 392, 372: downtime 86s items and restores; transfer; unclaimed', async () => {
    const d = (await request(app).post(`${O()}/downtime`).set(as(owner)).send({ location_id: locA, equipment: 'Fryer', affected_item_ids: [itemId] }).expect(201)).body;
    expect((await pool.query('SELECT is_available FROM restaurant_store_menu_overrides WHERE location_id=$1 AND menu_item_id=$2', [locA, itemId])).rows[0].is_available).toBe(false);
    await request(app).post(`${O()}/downtime/${d.id}/restore`).set(as(owner)).send({ checks: { cleaned: true } }).expect(409);
    expect((await request(app).post(`${O()}/downtime/${d.id}/restore`).set(as(owner)).send({ checks: { cleaned: true, tested: true, temperature_ok: true } }).expect(200)).body.items_restored).toBe(1);
    const o = await mkOrder();
    const t = (await request(app).post(`${O()}/transfers`).set(as(owner)).send({ order_id: o.id, to_location_id: locB }).expect(201)).body;
    await request(app).post(`${O()}/transfers/${t.id}/decision`).set(as(owner)).send({ decision: 'accepted' }).expect(200);
    expect(Number((await pool.query('SELECT location_id FROM food_orders WHERE id=$1', [o.id])).rows[0].location_id)).toBe(Number(locB));
    await mkOrder({ status: 'ready', ready_at: new Date(Date.now() - 2 * 36e5).toISOString() });
    expect((await request(app).get(`${O()}/unclaimed-pickups`).set(as(owner)).expect(200)).body.orders.length).toBe(1);
  });

  test('401-450 team: shift start, readiness, pickup code, issues, stock notice, tickets, end of shift', async () => {
    await request(app).post(`${S()}/readiness`).set(as(cook)).send({ items: {} }).expect(409);
    expect((await request(app).post(`${S()}/start`).set(as(cook)).send({ location_id: locA }).expect(200)).body.started).toBe(true);
    await request(app).post(`${S()}/start`).set(as(cook)).send({ location_id: locB }).expect(409);
    await request(app).post(`${S()}/start`).set(as(cook2)).send({ location_id: locA }).expect(200);
    const items = Object.fromEntries(require('../services/restaurantPersona/teamService').READINESS.map(k => [k, true]));
    expect((await request(app).post(`${S()}/readiness`).set(as(cook)).send({ items }).expect(200)).body.readiness_ack_at).toBeTruthy();
    const o = await mkOrder({ promised_at: new Date(Date.now() - 60000).toISOString() });
    expect(o.pickup_code).toMatch(/^\d{4}$/);
    const wrong = o.pickup_code === '0000' ? '1111' : '0000';
    expect((await request(app).post(`${S()}/orders/${o.id}/pickup-code`).set(as(cook)).send({ code: wrong }).expect(200)).body.verified).toBe(false);
    expect((await request(app).post(`${S()}/orders/${o.id}/pickup-code`).set(as(cook)).send({ code: o.pickup_code }).expect(200)).body.verified).toBe(true);
    expect((await request(app).get(`${S()}/orders/${o.id}/label`).set(as(cook)).expect(200)).body.order_id).toBe(String(o.id));
    expect((await request(app).get(`${S()}/late-orders`).set(as(cook)).expect(200)).body.orders.map(x => Number(x.id))).toContain(Number(o.id));
    const w = (await request(app).post(`${S()}/orders/${o.id}/issues`).set(as(cook)).send({ kind: 'wrong_order', detail: 'Wrong bag' }).expect(201)).body;
    expect(w.status).toBe('escalated'); expect(w.escalated_to).toBe(owner);
    await request(app).post(`${S()}/stock-notices`).set(as(cook)).send({ location_id: locA, kind: 'low_stock', menu_item_id: itemId }).expect(201);
    await request(app).post(`${S()}/orders/${o.id}/pack/sealed`).set(as(cook)).send({ done: true }).expect(200);
    await request(app).post(`${S()}/orders/${o.id}/handoff`).set(as(cook)).send({ kind: 'owner', to_user_id: cook2 }).expect(201);
    await pool.query('UPDATE food_orders SET kitchen_owner_user_id=$1 WHERE id=$2', [cook, o.id]);
    await request(app).post(`${S()}/break/start`).set(as(cook)).expect(200);
    expect((await request(app).post(`${S()}/break/end`).set(as(cook)).expect(200)).body).toHaveProperty('open_orders');
    const incR = await request(app).post(`${S()}/incidents`).set(as(cook)).send({ category: 'food_service', title: 'Undercooked complaint', location_id: locA }); const inc = incR.body;
    expect(inc.assigned_to_user_id).toBe(owner);
    expect((await request(app).get(`${S()}/end`).set(as(cook)).expect(200)).body.needs_handoff).toBe(true);
    await request(app).post(`${S()}/end`).set(as(cook)).send({}).expect(409);
    expect((await request(app).post(`${S()}/end`).set(as(cook)).send({ handoff_to_user_id: cook2, note: 'Fryer slow' }).expect(200)).body.summary.handed_off_tickets).toBe(1);
    await pool.query("UPDATE business_members SET status='revoked' WHERE member_id=$1 AND business_id=$2", [cook2, bizId]);
    expect((await request(app).get('/api/restaurants/me/shift-access').set(as(cook2)).expect(200)).body.lost_access.length).toBe(1);
    expect((await request(app).post('/api/restaurants/me/shift-access/recover').set(as(cook2)).expect(200)).body.recovered).toBe(1);
  });
});
