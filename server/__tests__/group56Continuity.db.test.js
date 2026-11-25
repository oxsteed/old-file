'use strict';
// Groups 5-6 items 241-245: ownership transfer, deputy, work transition, departed access, closure.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/(credit_statement_test|pa_g\d+|g56)$/.test(parsed.pathname)) throw new Error('Disposable database required');
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
const describeDb = raw ? describe : describe.skip;
const owner = crypto.randomUUID(), manager = crypto.randomUUID(), employee = crypto.randomUUID(), admin = crypto.randomUUID();
let app, bizId, serviceId, otherBiz;
const as = (u) => ({ 'x-user': u });

describeDb('Groups 5-6: continuity', () => {
  let svc;
  beforeAll(async () => {
    for (const id of [owner, manager, employee, admin]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified) VALUES($1,$2,'x','Con','User','customer',TRUE,TRUE)", [id, `g56c-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active) VALUES($1,'Handover Co','service',TRUE) RETURNING id", [owner]));
    ({ rows: [{ id: otherBiz }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,stripe_account_id) VALUES($1,'Paid Co','service',TRUE,'acct_g56_' || md5(random()::text)) RETURNING id", [owner]));
    for (const b of [bizId, otherBiz]) for (const [id, role] of [[manager, 'manager'], [employee, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,$5,'active')", [b, owner, id, `g56c-${id}@x.invalid`, role]);
    ({ rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,base_price_cents,duration_minutes,is_active) VALUES($1,'Fix',10000,60,TRUE) RETURNING id", [bizId]));
    const { router } = require('../routes/businessOwnerConsole');
    svc = require('../services/businessOwner/continuityService');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => {
    // business_audit_log is append-only, so tombstone instead of deleting.
    await pool.query('UPDATE businesses SET deleted_at=NOW(), is_active=FALSE WHERE id = ANY($1)', [[bizId, otherBiz]]);
    await pool.end();
  });

  test('242: deputy gets time-boxed operational codes, never money or ownership codes', async () => {
    const ends = new Date(Date.now() + 7 * 864e5).toISOString();
    expect((await request(app).post(`/api/businesses/${bizId}/owner/deputy`).set(as(manager)).send({ user_id: manager, ends_at: ends })).status).toBe(403);
    expect((await request(app).post(`/api/businesses/${bizId}/owner/deputy`).set(as(owner)).send({ user_id: employee, ends_at: ends })).body.code).toBe('deputy_not_eligible');
    expect((await request(app).post(`/api/businesses/${bizId}/owner/deputy`).set(as(owner)).send({ user_id: manager, ends_at: new Date(Date.now() + 200 * 864e5).toISOString() })).status).toBe(400);
    const d = (await request(app).post(`/api/businesses/${bizId}/owner/deputy`).set(as(owner)).send({ user_id: manager, ends_at: ends }).expect(201)).body;
    expect(d.granted_codes).toContain('jobs.reassign');
    expect(d.granted_codes).not.toContain('payouts.manage');
    expect((await request(app).post(`/api/businesses/${bizId}/owner/deputy`).set(as(owner)).send({ user_id: manager, ends_at: ends })).body.code).toBe('deputy_exists');
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM membership_permission_overrides WHERE reason=$1 AND expires_at IS NOT NULL", [`deputy:${d.id}`]);
    expect(rows[0].n).toBe(d.granted_codes.length);
    await request(app).delete(`/api/businesses/${bizId}/owner/deputy`).set(as(owner)).expect(200);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM membership_permission_overrides WHERE reason=$1', [`deputy:${d.id}`])).rows[0].n).toBe(0);
  });

  test('243: open work moves to another member, skipping conflicts', async () => {
    const at = h => `NOW() + interval '${h} hours'`;
    const mk = (staff, h) => pool.query(`INSERT INTO business_appointments(business_id,service_id,staff_id,start_time,end_time,status) VALUES($1,$2,$3,${at(h)},${at(h + 1)},'confirmed') RETURNING id`, [bizId, serviceId, staff]).then(r => r.rows[0].id);
    await pool.query('INSERT INTO business_service_staff(service_id,staff_id,is_available) VALUES($1,$2,TRUE),($1,$3,TRUE)', [serviceId, employee, manager]);
    const a1 = await mk(employee, 24), a2 = await mk(employee, 48);
    await mk(manager, 48);
    await pool.query("INSERT INTO business_team_tasks(business_id,assignee_id,created_by,request_id,kind,title,status,due_at) VALUES($1,$2,$3,$4,'task','Call back','open',NOW() + interval '1 day')", [bizId, employee, owner, crypto.randomUUID()]);
    const prev = (await request(app).get(`/api/businesses/${bizId}/owner/work-transition?from=${employee}`).set(as(manager)).expect(200)).body;
    expect(prev.appointments).toHaveLength(2); expect(prev.tasks).toHaveLength(1);
    expect((await request(app).post(`/api/businesses/${bizId}/owner/work-transition`).set(as(employee)).send({ from_user_id: employee, to_user_id: manager })).status).toBe(403);
    const r = (await request(app).post(`/api/businesses/${bizId}/owner/work-transition`).set(as(manager)).send({ from_user_id: employee, to_user_id: manager, reason: 'Leave' }).expect(200)).body;
    expect(r.moved).toEqual([a1]); expect(r.skipped).toEqual([{ id: a2, reason: 'conflict' }]); expect(r.tasks).toBe(1);
    expect((await pool.query("SELECT source FROM business_appointment_assignment_events WHERE appointment_id=$1", [a1])).rows[0].source).toBe('transfer');
  });

  test('244: departed staff see only their own records while access lasts', async () => {
    const { rows: [m] } = await pool.query("SELECT id FROM business_members WHERE business_id=$1 AND member_id=$2", [bizId, employee]);
    await pool.query("UPDATE business_members SET status='revoked' WHERE id=$1", [m.id]);
    const { rows: [o] } = await pool.query("INSERT INTO staff_offboarding_records(business_id,membership_id,user_id,removed_by,reason,removed_at,retain_until) VALUES($1,$2,$3,$4,'left',NOW(),CURRENT_DATE + 30) RETURNING id", [bizId, m.id, employee, owner]);
    await pool.query("INSERT INTO business_time_entries(business_id,user_id,entry_date,hours_worked) VALUES($1,$2,CURRENT_DATE,6.5)", [bizId, employee]);
    const list = (await request(app).get(`/api/businesses/${bizId}/owner/departed-members`).set(as(manager)).expect(200)).body.departed;
    expect(list[0]).toMatchObject({ user_id: employee, time_entries: 1 });
    expect(new Date(list[0].access_until).getFullYear()).toBeGreaterThanOrEqual(new Date().getFullYear() + 2);
    const mine = await svc.myFormerWorkplaces(employee);
    expect(mine.workplaces.map(w => w.business_name)).toEqual(['Handover Co']);
    expect(mine.workplaces[0].total_hours).toBe(6.5);
    expect((await request(app).patch(`/api/businesses/${bizId}/owner/departed-members/${o.id}`).set(as(manager)).send({ former_access_until: new Date().toISOString() })).status).toBe(403);
    const r = (await request(app).patch(`/api/businesses/${bizId}/owner/departed-members/${o.id}`).set(as(owner)).send({ former_access_until: new Date().toISOString() }).expect(200)).body;
    expect(new Date(r.former_access_until) > new Date(Date.now() + 2 * 365 * 864e5)).toBe(true);
    expect((await svc.myFormerWorkplaces(manager)).workplaces).toEqual([]);
  });

  test('241: transfer needs the exact name, manager target, acceptance; payout businesses need an admin', async () => {
    const url = `/api/businesses/${bizId}/owner/ownership-transfer`;
    expect((await request(app).post(url).set(as(owner)).send({ to_user_id: manager, confirm_name: 'wrong' })).body.code).toBe('confirm_name_mismatch');
    const t = (await request(app).post(url).set(as(owner)).send({ to_user_id: manager, confirm_name: 'Handover Co' }).expect(201)).body;
    expect((await request(app).post(url).set(as(owner)).send({ to_user_id: manager, confirm_name: 'Handover Co' })).body.code).toBe('transfer_already_open');
    expect((await request(app).get(url).set(as(manager))).body.mine.id).toBe(t.id);
    const done = (await request(app).post(`/api/businesses/${bizId}/ownership-transfer/${t.id}/accept`).set(as(manager)).expect(200)).body;
    expect(done.status).toBe('completed');
    expect((await pool.query('SELECT user_id FROM businesses WHERE id=$1', [bizId])).rows[0].user_id).toBe(manager);
    expect((await pool.query("SELECT role FROM business_members WHERE business_id=$1 AND member_id=$2 AND status='active'", [bizId, owner])).rows[0].role).toBe('manager');
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM business_members WHERE business_id=$1 AND owner_id<>$2", [bizId, manager])).rows[0].n).toBe(0);

    const t2 = (await request(app).post(`/api/businesses/${otherBiz}/owner/ownership-transfer`).set(as(owner)).send({ to_user_id: manager, confirm_name: 'Paid Co' }).expect(201)).body;
    expect((await request(app).post(`/api/businesses/${otherBiz}/ownership-transfer/${t2.id}/accept`).set(as(manager))).body.status).toBe('awaiting_admin');
    await expect(svc.adminDecide(manager, t2.id, { decision: 'approve' })).rejects.toMatchObject({ code: 'self_review' });
    expect((await svc.adminDecide(admin, t2.id, { decision: 'approve' })).status).toBe('completed');
  });

  test('245: closure checklist blocks on open work and needs an export confirmation', async () => {
    const url = `/api/businesses/${bizId}/owner/closure-checklist`;
    expect((await request(app).get(url).set(as(owner))).status).toBe(403);
    let c = (await request(app).get(url).set(as(manager)).expect(200)).body;
    expect(c.ready).toBe(false);
    expect(c.items.find(i => i.key === 'future_bookings').count).toBeGreaterThan(0);
    await pool.query("UPDATE business_appointments SET status='cancelled' WHERE business_id=$1", [bizId]);
    await request(app).put(`/api/businesses/${bizId}/owner/closure-plan`).set(as(manager)).send({ target_date: '2026-12-31', export_confirmed: true }).expect(200);
    c = (await request(app).get(url).set(as(manager))).body;
    expect(c.ready).toBe(true);
    expect((await request(app).put(`/api/businesses/${bizId}/owner/closure-plan`).set(as(manager)).send({ expectedVersion: 99 })).status).toBe(409);
  });
});
