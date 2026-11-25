'use strict';
// Gaps batch (450, D-441): access-change recovery. Proves end to end that
// losing access releases the person's tickets and notifies store managers,
// that the recovery read paths return the released tickets + handoff /
// reassignment state + notification state to the right caller, and that a
// reassignment through the screen's path (the real handoff route) actually
// moves a released ticket. The D-250 legs (handoff record, pack checklist)
// are re-proved on the same ticket.
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
const owner = crypto.randomUUID(), cook = crypto.randomUUID(), cook2 = crypto.randomUUID(), stranger = crypto.randomUUID(), customer = crypto.randomUUID();
let app, bizId, rid, locA, itemId, orderId, queueNo;
const as = (u) => ({ 'x-user': u });
const sent = (type) => sendNotification.mock.calls.filter(c => c[0].type === type).map(c => c[0].userId);

describeDb('Gaps: shift access-change recovery (450)', () => {
  beforeAll(async () => {
    for (const id of [owner, cook, cook2, stranger, customer]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Gap','User','customer',TRUE,TRUE,'555-0100')", [id, `gaprec-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Gap Recovery Diner','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const id of [cook, cook2]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,'employee','active',NOW())", [bizId, owner, id, `gaprec-${id}@x.invalid`]);
    ({ rows: [{ id: rid }] } = await pool.query("INSERT INTO food_restaurants(business_id,owner_user_id,display_name,timezone,slug,status) VALUES($1,$2,'Gap Recovery Diner','UTC',$3,'active') RETURNING id", [bizId, owner, `gaprec-${bizId}`]));
    ({ rows: [{ id: locA } = {}] } = await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary', [rid]));
    if (!locA) ({ rows: [{ id: locA }] } = await pool.query("INSERT INTO restaurant_locations(restaurant_id,name,is_primary,status,latitude,longitude) VALUES($1,'Main',TRUE,'active',40.0,-83.0) RETURNING id", [rid]));
    await pool.query('UPDATE restaurant_locations SET status=$2 WHERE id=$1', [locA, 'active']);
    ({ rows: [{ id: itemId }] } = await pool.query("INSERT INTO food_menu_items(restaurant_id,name,price_cents) VALUES($1,'Burger',1000) RETURNING id", [rid]));
    app = express(); app.use(express.json());
    app.use('/api/restaurants', require('../routes/restaurantPersona'));
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code, message: err.message })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM food_restaurants WHERE id=$1', [rid]).catch(() => {}); await pool.end(); });
  const S = () => `/api/restaurants/${rid}/shift`;

  test('450: access loss releases tickets, notifies managers, recovery reads show it, reassign moves the ticket', async () => {
    // Both cooks on shift at the same store; the order is owned by cook.
    expect((await request(app).post(`${S()}/start`).set(as(cook)).send({ location_id: locA }).expect(200)).body.started).toBe(true);
    expect((await request(app).post(`${S()}/start`).set(as(cook2)).send({ location_id: locA }).expect(200)).body.started).toBe(true);
    ({ rows: [{ id: orderId, queue_number: queueNo }] } = await pool.query(`INSERT INTO food_orders(restaurant_id,business_id,order_source,fulfillment_type,status,subtotal_cents,total_cents,location_id,customer_id,guest_name,queue_number)
      VALUES($1,$2,'web','pickup','accepted',1000,1000,$3,$4,'Gap Guest',floor(random()*900+100)::int) RETURNING *`, [rid, bizId, locA, customer]));
    await pool.query('UPDATE food_orders SET kitchen_owner_user_id=$1 WHERE id=$2', [cook, orderId]);

    // Still has access: nothing lost, nothing recovered.
    const before = (await request(app).get('/api/restaurants/me/shift-access').set(as(cook)).expect(200)).body;
    expect(before.lost_access).toEqual([]);
    expect(before.recovered).toEqual([]);

    // Access loss: membership revoked.
    await pool.query("UPDATE business_members SET status='revoked' WHERE member_id=$1 AND business_id=$2", [cook, bizId]);
    const lost = (await request(app).get('/api/restaurants/me/shift-access').set(as(cook)).expect(200)).body;
    expect(lost.lost_access.length).toBe(1);
    expect(lost.lost_access[0]).toMatchObject({ restaurant_id: String(rid), owned_open_tickets: 1 });
    expect(lost.lost_access[0].tickets.map(t => Number(t.id))).toContain(Number(orderId));
    expect(lost.lost_access[0].tickets[0]).toMatchObject({ queue_number: queueNo, status: 'accepted' });

    // Recover: tickets released, managers notified.
    const rec = (await request(app).post('/api/restaurants/me/shift-access/recover').set(as(cook)).expect(200)).body;
    expect(rec.recovered).toBe(1);
    expect(rec.releases.length).toBe(1);
    expect(rec.releases[0].released_tickets.map(t => Number(t.order_id))).toContain(Number(orderId));
    expect(rec.releases[0].managers_notified).toContain(owner);
    expect(rec.releases[0].notified_at).toBeTruthy();
    expect(sent('restaurant_access_change_handoff')).toContain(owner);
    expect((await pool.query('SELECT kitchen_owner_user_id FROM food_orders WHERE id=$1', [orderId])).rows[0].kitchen_owner_user_id).toBeNull();
    const checkin = (await pool.query("SELECT ended_at, end_summary FROM restaurant_shift_checkins WHERE restaurant_id=$1 AND user_id=$2", [rid, cook])).rows[0];
    expect(checkin.ended_at).toBeTruthy();
    expect(checkin.end_summary.ended_by).toBe('access_change');
    expect(checkin.end_summary.released_tickets).toBe(1);
    expect(checkin.end_summary.released.map(t => Number(t.order_id))).toContain(Number(orderId));
    expect(checkin.end_summary.managers_notified).toContain(owner);
    const handoffs = (await pool.query("SELECT * FROM restaurant_ticket_handoffs WHERE order_id=$1 AND note='access_change'", [orderId])).rows;
    expect(handoffs.length).toBe(1);
    expect(handoffs[0]).toMatchObject({ kind: 'owner', from_user_id: cook, to_user_id: null });

    // Second recover is a no-op: no duplicate release, no duplicate notice.
    const again = (await request(app).post('/api/restaurants/me/shift-access/recover').set(as(cook)).expect(200)).body;
    expect(again.recovered).toBe(0);
    expect(sent('restaurant_access_change_handoff').length).toBe(1);

    // Self read after recovery: released ticket + notification state.
    const after = (await request(app).get('/api/restaurants/me/shift-access').set(as(cook)).expect(200)).body;
    expect(after.lost_access).toEqual([]);
    expect(after.recovered.length).toBe(1);
    expect(after.recovered[0].released_tickets[0]).toMatchObject({ order_id: Number(orderId), queue_number: queueNo, owner_user_id: null });
    expect(after.recovered[0].managers_notified).toContain(owner);
    expect(after.recovered[0].notified_at).toBeTruthy();

    // Manager/staff recovery view: the release, still unassigned, with a
    // teammate on shift to reassign to.
    const view = (await request(app).get(`${S()}/access-recovery`).set(as(owner)).expect(200)).body;
    expect(view.releases.length).toBe(1);
    expect(view.releases[0].released_tickets[0]).toMatchObject({ order_id: Number(orderId), owner_user_id: null });
    expect(view.releases[0].teammates_on_shift.map(t => t.user_id)).toContain(cook2);
    expect(typeof view.can_reassign).toBe('boolean');

    // Reassignment through the screen's path (the real handoff route) moves it.
    await request(app).post(`${S()}/orders/${orderId}/handoff`).set(as(owner)).send({ kind: 'owner', to_user_id: cook2 }).expect(201);
    expect((await pool.query('SELECT kitchen_owner_user_id FROM food_orders WHERE id=$1', [orderId])).rows[0].kitchen_owner_user_id).toBe(cook2);
    const view2 = (await request(app).get(`${S()}/access-recovery`).set(as(owner)).expect(200)).body;
    expect(view2.releases[0].released_tickets[0]).toMatchObject({ order_id: Number(orderId), owner_user_id: cook2 });
    expect(view2.releases[0].released_tickets[0].owner_name).toBeTruthy();

    // D-250 leg still works on the same ticket: pack checklist.
    expect((await request(app).post(`${S()}/orders/${orderId}/pack/sealed`).set(as(owner)).send({ done: true }).expect(200)).body.items.find(i => i.key === 'sealed').done).toBe(true);
  });

  test('450: a stranger gets nothing; the revoked cook and strangers cannot use the recovery view', async () => {
    // Stranger's own status is empty (no check-ins) and reveals nothing.
    const strangerStatus = (await request(app).get('/api/restaurants/me/shift-access').set(as(stranger)).expect(200)).body;
    expect(strangerStatus.lost_access).toEqual([]);
    expect(strangerStatus.recovered).toEqual([]);
    // Stranger and revoked cook cannot read the restaurant-scoped view.
    for (const u of [stranger, cook]) {
      const res = await request(app).get(`${S()}/access-recovery`).set(as(u));
      expect([403, 404]).toContain(res.status);
    }
    // Unauthenticated callers get 401 on both paths.
    await request(app).get('/api/restaurants/me/shift-access').expect(401);
    await request(app).post('/api/restaurants/me/shift-access/recover').expect(401);
    await request(app).get(`${S()}/access-recovery`).expect(401);
  });
});
