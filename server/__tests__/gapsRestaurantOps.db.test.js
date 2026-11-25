'use strict';
// Gaps batch (356/394/416/418/431, D-436..D-440): menu CSV import screen,
// emergency-closure open-order cleanup, package label, driver arrivals,
// station queue filter. Proves each read path the new screens call returns
// the right data to the right caller, and that the 394 pause refuses without
// per-order disposition + customer notice and proceeds once both are recorded.
//
// Runs ONLY against the disposable gaps DB; the env guard refuses anything
// else. Never run against the shared credit_statement_test DB.
const raw = process.env.GAPS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/credit_statement_test_gaps') throw new Error('Disposable gaps database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); };
  return { authenticate, requireAuth: authenticate };
});
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const { sendNotification } = require('../services/notificationService');
const describeDb = raw ? describe : describe.skip;
const owner = crypto.randomUUID(), cook = crypto.randomUUID(), stranger = crypto.randomUUID(), customer = crypto.randomUUID();
let app, bizId, rid, locA, locB, itemId;
const as = (u) => ({ 'x-user': u });
const sent = (type) => sendNotification.mock.calls.filter(c => c[0].type === type).map(c => c[0].userId);

describeDb('Gaps: restaurant ops panels (356/394/416/418/431)', () => {
  beforeAll(async () => {
    for (const id of [owner, cook, stranger, customer]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Gap','User','customer',TRUE,TRUE,'555-0100')", [id, `gapops-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Gap Ops Diner','service',TRUE,'UTC') RETURNING id", [owner]));
    await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,'employee','active',NOW())", [bizId, owner, cook, `gapops-${cook}@x.invalid`]);
    ({ rows: [{ id: rid }] } = await pool.query("INSERT INTO food_restaurants(business_id,owner_user_id,display_name,timezone,slug,status) VALUES($1,$2,'Gap Ops Diner','UTC',$3,'active') RETURNING id", [bizId, owner, `gapops-${bizId}`]));
    ({ rows: [{ id: locA } = {}] } = await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary', [rid]));
    if (!locA) ({ rows: [{ id: locA }] } = await pool.query("INSERT INTO restaurant_locations(restaurant_id,name,is_primary,status,latitude,longitude) VALUES($1,'Main',TRUE,'active',40.0,-83.0) RETURNING id", [rid]));
    await pool.query('UPDATE restaurant_locations SET status=$2, latitude=40.0, longitude=-83.0 WHERE id=$1', [locA, 'active']);
    ({ rows: [{ id: locB }] } = await pool.query("INSERT INTO restaurant_locations(restaurant_id,name,status) VALUES($1,'Annex','active') RETURNING id", [rid]));
    ({ rows: [{ id: itemId }] } = await pool.query("INSERT INTO food_menu_items(restaurant_id,name,price_cents) VALUES($1,'Burger',1000) RETURNING id", [rid]));
    for (const name of ['Grill', 'Fry']) await pool.query('INSERT INTO restaurant_kitchen_stations(restaurant_id,location_id,name,is_active) VALUES($1,$2,$3,TRUE) ON CONFLICT DO NOTHING', [rid, locA, name]);
    app = express(); app.use(express.json());
    app.use('/api/restaurants', require('../routes/restaurantPersona'));
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code, message: err.message })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM food_restaurants WHERE id=$1', [rid]).catch(() => {}); await pool.end(); });
  const O = () => `/api/restaurants/${rid}/ops`; const S = () => `/api/restaurants/${rid}/shift`;
  const mkOrder = (extra = {}) => pool.query(`INSERT INTO food_orders(restaurant_id,business_id,order_source,fulfillment_type,status,subtotal_cents,total_cents,location_id,customer_id,guest_name,queue_number)
    VALUES($1,$2,'web','pickup',$3,1000,1000,$4,$5,$6,floor(random()*900+100)::int) RETURNING *`,
  [rid, bizId, extra.status || 'accepted', extra.loc || locA, extra.customer_id || null, extra.guest_name || 'Gap Guest']).then(r => r.rows[0]);
  const mkItem = (orderId, name, station) => pool.query(`INSERT INTO food_order_items(order_id,menu_item_id,item_name,quantity,unit_price_cents,line_total_cents,station_label)
    VALUES($1,$2,$3,1,1000,1000,$4) RETURNING *`, [orderId, itemId, name, station]).then(r => r.rows[0]);

  test('356: menu CSV import dry-run preview, confirm lands drafts; stranger gets nothing', async () => {
    // Preview: one new row, one duplicate of the existing Burger, one error row.
    const preview = (await request(app).post(`${O()}/menu/import`).set(as(owner)).send({ csv: 'name,price,category\nFries,3.50,Sides\nBurger,9,Mains\n,2,x' }).expect(200)).body;
    expect(preview).toMatchObject({ dry_run: true, create: 1, skipped: 2 });
    expect(preview.rows).toHaveLength(3);
    expect(preview.rows[0]).toMatchObject({ name: 'Fries', status: 'new', price_cents: 350 });
    expect(preview.rows[1]).toMatchObject({ name: 'Burger', status: 'duplicate' });
    expect(preview.rows[2]).toMatchObject({ status: 'error', errors: ['name'] });
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM food_menu_items WHERE restaurant_id=$1 AND name='Fries'", [rid])).rows[0].n).toBe(0);
    // Confirm: the new row lands as a draft, nothing goes live before review.
    const done = (await request(app).post(`${O()}/menu/import`).set(as(owner)).send({ csv: 'name,price,category\nFries,3.50,Sides', dry_run: false }).expect(200)).body;
    expect(done).toMatchObject({ dry_run: false, created: 1 });
    const { rows: [fries] } = await pool.query("SELECT publication_status FROM food_menu_items WHERE restaurant_id=$1 AND name='Fries'", [rid]);
    expect(fries.publication_status).toBe('draft');
    // A caller with no restaurant access cannot import (404, no existence leak).
    await request(app).post(`${O()}/menu/import`).set(as(stranger)).send({ csv: 'name,price\nSoup,4' }).expect(404);
    // A bad header is a 400 with the import path's error state visible.
    await request(app).post(`${O()}/menu/import`).set(as(owner)).send({ csv: 'dish,cost\nSoup,4' }).expect(400);
  });

  test('394: pause refuses without dispositions + notice, proceeds with both; stranger cannot close', async () => {
    const o1 = await mkOrder({ status: 'ready', customer_id: customer, guest_name: 'Ana Ready' });
    const o2 = await mkOrder({ status: 'preparing', customer_id: customer, guest_name: 'Ben Prep' });
    // The close form reads the open orders before any pause exists.
    const before = (await request(app).get(`${O()}/locations/${locA}/closure`).set(as(owner)).expect(200)).body;
    expect(before.closure).toBeNull();
    expect(before.open_orders.map(o => Number(o.id))).toEqual(expect.arrayContaining([Number(o1.id), Number(o2.id)]));
    const locStatus = async () => (await pool.query('SELECT status FROM restaurant_locations WHERE id=$1', [locA])).rows[0].status;
    const closureCount = async () => (await pool.query('SELECT COUNT(*)::int AS n FROM restaurant_location_closures WHERE location_id=$1', [locA])).rows[0].n;
    // Neither leg: refused, store still running, nothing written.
    await request(app).post(`${O()}/emergency-closures`).set(as(owner)).send({ location_id: locA, reason: 'power' }).expect(409);
    expect(await locStatus()).toBe('active');
    expect(await closureCount()).toBe(0);
    // Dispositions only: refused. Notice only: refused.
    const disps = [{ order_id: o1.id, disposition: 'hand_off' }, { order_id: o2.id, disposition: 'finish' }];
    await request(app).post(`${O()}/emergency-closures`).set(as(owner)).send({ location_id: locA, reason: 'power', dispositions: disps }).expect(409);
    expect(await closureCount()).toBe(0);
    await request(app).post(`${O()}/emergency-closures`).set(as(owner)).send({ location_id: locA, reason: 'power', customer_notice: 'We closed for a power cut.' }).expect(409);
    expect(await closureCount()).toBe(0);
    // A disposition for an order that is not open is refused, not silently stored.
    await request(app).post(`${O()}/emergency-closures`).set(as(owner)).send({ location_id: locA, reason: 'power', customer_notice: 'We closed.', dispositions: [...disps, { order_id: 987654321, disposition: 'cancel' }] }).expect(400);
    expect(await closureCount()).toBe(0);
    // A stranger cannot disposition or pause (404 either way).
    await request(app).post(`${O()}/emergency-closures`).set(as(stranger)).send({ location_id: locA, reason: 'power', customer_notice: 'x', dispositions: disps }).expect(404);
    // Both legs: the pause proceeds, dispositions + notice are recorded,
    // the store pauses, and the affected customer is notified.
    const closed = (await request(app).post(`${O()}/emergency-closures`).set(as(owner)).send({ location_id: locA, reason: 'power', customer_notice: 'We closed for a power cut. Come back tomorrow.', dispositions: disps }).expect(201)).body;
    expect(closed.closure.reason).toBe('power');
    expect(closed.closure.customer_notice_message).toBe('We closed for a power cut. Come back tomorrow.');
    expect(closed.closure.customer_notice_at).toBeTruthy();
    expect(closed.dispositions).toHaveLength(2);
    expect(await locStatus()).toBe('paused');
    expect((await pool.query('SELECT disposition FROM restaurant_closure_order_dispositions WHERE closure_id=$1 ORDER BY order_id', [closed.closure.id])).rows.map(r => r.disposition).sort()).toEqual(['finish', 'hand_off']);
    // A disposition is a record only: the orders themselves are untouched
    // (no status change, no cancel, no refund).
    expect((await pool.query('SELECT status FROM food_orders WHERE id=$1', [o1.id])).rows[0].status).toBe('ready');
    expect(sent('restaurant_closure_customer_notice')).toContain(customer);
    // The closure read now shows the recorded dispositions.
    const after = (await request(app).get(`${O()}/locations/${locA}/closure`).set(as(owner)).expect(200)).body;
    expect(after.closure.id).toBe(closed.closure.id);
    expect(after.dispositions).toHaveLength(2);
    // Reopen still works through the four checks (D-249 untouched).
    const ops = require('../services/restaurantPersona/ownerService');
    await request(app).post(`${O()}/locations/${locA}/reopen`).set(as(owner)).expect(409);
    for (const k of ops.REOPEN_KEYS) await request(app).post(`${O()}/locations/${locA}/closure/checks/${k}`).set(as(owner)).send({ done: true }).expect(200);
    await request(app).post(`${O()}/locations/${locA}/reopen`).set(as(owner)).expect(200);
    expect(await locStatus()).toBe('active');
    // With no open orders, a close proceeds without dispositions or notice.
    const empty = (await request(app).post(`${O()}/emergency-closures`).set(as(owner)).send({ location_id: locB, reason: 'weather' }).expect(201)).body;
    expect(empty.dispositions).toEqual([]);
    for (const k of ops.REOPEN_KEYS) await request(app).post(`${O()}/locations/${locB}/closure/checks/${k}`).set(as(owner)).send({ done: true }).expect(200);
    await request(app).post(`${O()}/locations/${locB}/reopen`).set(as(owner)).expect(200);
  });

  test('416: package label carries pickup code, items, customer, time; stranger gets 404', async () => {
    const o = await mkOrder({ status: 'ready', guest_name: 'Cara Label' });
    await mkItem(o.id, 'Burger', 'Grill');
    expect(o.pickup_code).toMatch(/^\d{4}$/);
    const label = (await request(app).get(`${S()}/orders/${o.id}/label`).set(as(owner)).expect(200)).body;
    expect(label).toMatchObject({ order_id: String(o.id), queue_number: o.queue_number, fulfillment_type: 'pickup', pickup_code: o.pickup_code });
    expect(label.customer).toMatch(/Cara/);
    expect(label.items).toHaveLength(1);
    expect(label.items[0]).toMatchObject({ name: 'Burger', quantity: 1 });
    expect(label.item_count).toBe(1);
    // Team members on the shift read path can load the label too.
    expect((await request(app).get(`${S()}/orders/${o.id}/label`).set(as(cook)).expect(200)).body.pickup_code).toBe(o.pickup_code);
    await request(app).get(`${S()}/orders/${o.id}/label`).set(as(stranger)).expect(404);
    await request(app).get(`${S()}/orders/987654321/label`).set(as(owner)).expect(404);
  });

  test('418: driver arrivals list for the location; stranger gets 404', async () => {
    const o = await mkOrder({ status: 'accepted', guest_name: 'Dan Delivery' });
    const o2 = await mkOrder({ status: 'accepted', guest_name: 'Eve Delivery' });
    await pool.query(`INSERT INTO restaurant_runner_tasks(restaurant_id,location_id,food_order_id,order_reference,stop_name,task_type,status,assigned_to,pickup_eta_at,last_latitude,last_longitude,last_location_at)
      VALUES($1,$2,$3,'GAP-1','Gap Diner','Delivery','Ready',$4,NOW() + INTERVAL '5 minutes',40.0004,-83.0,NOW())`,
    [rid, locA, o.id, cook]);
    await pool.query(`INSERT INTO restaurant_runner_tasks(restaurant_id,location_id,food_order_id,order_reference,stop_name,task_type,status,assigned_to,pickup_eta_at,last_latitude,last_longitude,last_location_at)
      VALUES($1,$2,$3,'GAP-2','Gap Diner','Delivery','Assigned',$4,NOW() + INTERVAL '20 minutes',41.0,-84.0,NOW())`,
    [rid, locA, o2.id, cook]);
    // A task at the other location is not in this location's list.
    await pool.query(`INSERT INTO restaurant_runner_tasks(restaurant_id,location_id,food_order_id,order_reference,stop_name,task_type,status,assigned_to)
      VALUES($1,$2,NULL,'GAP-3','Gap Diner','Delivery','Ready',$3)`, [rid, locB, cook]);
    const list = (await request(app).get(`${S()}/driver-arrivals?location_id=${locA}`).set(as(owner)).expect(200)).body;
    expect(list.location_id).toBe(String(locA));
    expect(list.drivers).toHaveLength(2);
    const near = list.drivers.find(d => d.order_reference === 'GAP-1');
    const far = list.drivers.find(d => d.order_reference === 'GAP-2');
    expect(near).toMatchObject({ arrived: true, order_status: 'accepted' });
    expect(near.distance_m).toBeLessThanOrEqual(150);
    expect(far.arrived).toBe(false);
    expect(far.distance_m).toBeGreaterThan(150);
    expect(typeof near.eta_minutes).toBe('number');
    await request(app).get(`${S()}/driver-arrivals?location_id=${locA}`).set(as(stranger)).expect(404);
  });

  test('431: station queue filter; ticket owner/handoff/pack/batch print still work (D-250)', async () => {
    const t1 = await mkOrder({ status: 'preparing', guest_name: 'Ticket Grill' });
    await mkItem(t1.id, 'Burger', 'Grill');
    await mkItem(t1.id, 'Fries', 'Fry');
    const t2 = await mkOrder({ status: 'received', guest_name: 'Ticket Plain' });
    await mkItem(t2.id, 'Salad', null);
    const all = (await request(app).get(`${O()}/tickets?location_id=${locA}`).set(as(owner)).expect(200)).body;
    expect(all.stations.map(s => s.name)).toEqual(expect.arrayContaining(['Grill', 'Fry']));
    expect(all.tickets.map(t => Number(t.id))).toEqual(expect.arrayContaining([Number(t1.id), Number(t2.id)]));
    const grillTicket = all.tickets.find(t => Number(t.id) === Number(t1.id));
    expect(grillTicket.items.map(i => i.station_label).sort()).toEqual(['Fry', 'Grill']);
    // Station filter narrows to tickets with an item at that station.
    const grill = (await request(app).get(`${O()}/tickets?location_id=${locA}&station=Grill`).set(as(owner)).expect(200)).body;
    expect(grill.tickets.map(t => Number(t.id))).toEqual(expect.arrayContaining([Number(t1.id)]));
    expect(grill.tickets.map(t => Number(t.id))).not.toContain(Number(t2.id));
    const fry = (await request(app).get(`${O()}/tickets?location_id=${locA}&station=Fry`).set(as(owner)).expect(200)).body;
    expect(fry.tickets.map(t => Number(t.id))).toEqual(expect.arrayContaining([Number(t1.id)]));
    expect(fry.tickets.map(t => Number(t.id))).not.toContain(Number(t2.id));
    // Unassigned shows only tickets with an unlabelled item.
    const un = (await request(app).get(`${O()}/tickets?location_id=${locA}&station=unassigned`).set(as(owner)).expect(200)).body;
    expect(un.tickets.map(t => Number(t.id))).toEqual(expect.arrayContaining([Number(t2.id)]));
    expect(un.tickets.map(t => Number(t.id))).not.toContain(Number(t1.id));
    // An unknown station is a 404, not an empty list pretending to be fine.
    await request(app).get(`${O()}/tickets?location_id=${locA}&station=Nope`).set(as(owner)).expect(404);
    await request(app).get(`${O()}/tickets?location_id=${locA}`).set(as(stranger)).expect(404);
    // D-250 legs on the same tickets are untouched: owner, handoff record,
    // pack checklist, batch print.
    const hist = (await request(app).get(`${S()}/orders/${t1.id}/ticket`).set(as(owner)).expect(200)).body;
    expect(Array.isArray(hist.pack_checklist)).toBe(true);
    expect(hist.pack_checklist).toHaveLength(5);
    await request(app).post(`${S()}/orders/${t1.id}/handoff`).set(as(cook)).send({ kind: 'station', to_station: 'Grill', note: 'Move to grill' }).expect(201);
    const histAfter = (await request(app).get(`${S()}/orders/${t1.id}/ticket`).set(as(owner)).expect(200)).body;
    expect(histAfter.handoffs).toHaveLength(1);
    expect(histAfter.handoffs[0]).toMatchObject({ kind: 'station', to_station: 'Grill' });
    expect((await request(app).post(`${S()}/orders/${t1.id}/pack/sealed`).set(as(cook)).send({ done: true }).expect(200)).body.items.find(i => i.key === 'sealed').done).toBe(true);
    expect((await request(app).post(`${S()}/print-batch`).set(as(cook)).send({ order_ids: [t1.id, t2.id] }).expect(200)).body.orders).toBe(2);
  });

  test('notification type: closure customer notice has a non-empty title in all five locales', () => {
    const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');
    expect(NOTIFICATION_TYPES.map(e => e.type)).toContain('restaurant_closure_customer_notice');
    const { businessTeamNotifications } = require('../utils/businessTeamNotificationTemplates');
    const copy = businessTeamNotifications.restaurant_closure_customer_notice;
    for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
      expect(typeof copy.title[locale]).toBe('string');
      expect(copy.title[locale].length).toBeGreaterThan(0);
      expect(copy.body[locale]).toContain('{queue}');
    }
  });
});
