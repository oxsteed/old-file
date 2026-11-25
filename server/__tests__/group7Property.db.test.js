'use strict';
// Group 7 items 301-350: property manager console end to end.
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
const { sendNotification } = require('../services/notificationService');
const describeDb = raw ? describe : describe.skip;
const owner = crypto.randomUUID(), manager = crypto.randomUUID(), staff = crypto.randomUUID(), other = crypto.randomUUID(), landlord = crypto.randomUUID(), tenant = crypto.randomUUID();
let app, bizId;
const as = (u) => ({ 'x-user': u });
const sent = (type) => sendNotification.mock.calls.filter(c => c[0].type === type).map(c => c[0].userId);

describeDb('Group 7: property manager', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, staff, other, landlord, tenant]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Prop','User','customer',TRUE,TRUE,'555-0100')", [id, `g7p-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Prop Co','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [staff, 'employee'], [other, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [bizId, owner, id, `g7p-${id}@x.invalid`, role]);
    const { router, meRouter } = require('../routes/propertyManager');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router); app.use('/api/me/property', meRouter);
    app.use((err, req, res, next) => (process.env.G7DBG && console.log(err.code, err.message)) || res.status(err.statusCode || err.status || 500).json({ code: err.code, message: err.message })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id=$1', [bizId]); await pool.end(); });
  const B = () => `/api/businesses/${bizId}/properties`;
  let pid, unitId, reqId, vendorId, keyId;

  test('301-310: portfolio, profile, units, areas, assignments, access review, archive', async () => {
    await request(app).post(B()).set(as(staff)).send({ label: 'No' }).expect(403);
    pid = (await request(app).post(B()).set(as(manager)).send({ label: 'Elm Court', address: '1 Elm', property_type: 'multi_family', approval_threshold_cents: 50000, monthly_budget_cents: 100000, owner_user_id: landlord, reserve_target_cents: 200000, reserve_balance_cents: 50000 }).expect(201)).body.id;
    unitId = (await request(app).post(`${B()}/p/${pid}/units`).set(as(manager)).send({ unit_label: '2A', occupancy_status: 'occupied' }).expect(201)).body.id;
    await request(app).post(`${B()}/p/${pid}/common-areas`).set(as(manager)).send({ name: 'Laundry', kind: 'laundry' }).expect(201);
    await request(app).get(`${B()}/p/${pid}`).set(as(staff)).expect(404);
    await request(app).post(`${B()}/p/${pid}/assignments`).set(as(manager)).send({ role: 'building_staff', user_id: landlord }).expect(409);
    await request(app).post(`${B()}/p/${pid}/assignments`).set(as(manager)).send({ role: 'coverage', user_id: other }).expect(400);
    await request(app).post(`${B()}/p/${pid}/assignments`).set(as(manager)).send({ role: 'building_staff', user_id: staff }).expect(201);
    await request(app).post(`${B()}/p/${pid}/assignments`).set(as(manager)).send({ role: 'unit_contact', unit_id: unitId, contact_name: 'Super Sam', contact_phone: '555' }).expect(201);
    expect(sent('property_assigned')).toContain(staff);
    const prof = (await request(app).get(`${B()}/p/${pid}`).set(as(staff)).expect(200)).body;
    expect(prof).toMatchObject({ can_manage: false, my_roles: ['building_staff'] });
    expect(prof.units[0].unit_label).toBe('2A'); expect(prof.common_areas[0].name).toBe('Laundry');
    expect((await request(app).get(B()).set(as(staff)).expect(200)).body.properties.map(p => p.id)).toEqual([pid]);
    expect((await request(app).get(B()).set(as(other)).expect(200)).body.properties).toEqual([]);
    const dash = (await request(app).get(B()).set(as(manager)).expect(200)).body;
    expect(dash.totals).toMatchObject({ properties: 1, units: 1 });
    const rev = (await request(app).get(`${B()}/access-review`).set(as(manager)).expect(200)).body;
    expect(rev.assignments.length).toBe(2);
    await request(app).post(`${B()}/assignments/${rev.assignments[0].id}/review`).set(as(manager)).send({ decision: 'keep' }).expect(200);
    const tmp = (await request(app).post(B()).set(as(manager)).send({ label: 'Old Barn' }).expect(201)).body.id;
    await request(app).post(`${B()}/p/${tmp}/archive`).set(as(manager)).send({ reason: 'sold' }).expect(200);
    expect((await request(app).get(`${B()}?archived=1`).set(as(manager)).expect(200)).body.properties.map(p => p.id)).toEqual([tmp]);
    await request(app).post(`${B()}/p/${tmp}/restore`).set(as(manager)).expect(200);
  });

  test('314, 316-320: duplicates, owner approval, quotes, vendors, work order', async () => {
    const mk = (title) => pool.query(`INSERT INTO property_maintenance_requests(business_id,owner_id,requester_id,status,urgency,issue_category,title,description,property_label,unit_label,property_id,unit_id)
      VALUES($1,$2,$3,'reported','urgent','plumbing',$4,'d','Elm Court','2A',$5,$6) RETURNING id`, [bizId, owner, tenant, title, pid, unitId]).then(r => r.rows[0].id);
    reqId = await mk('Leak'); const dup = await mk('Leak again');
    const d = (await request(app).get(`${B()}/requests/${dup}/duplicates`).set(as(staff)).expect(200)).body;
    expect(d.candidates.map(c => c.id)).toContain(reqId);
    expect((await request(app).post(`${B()}/requests/${dup}/duplicate`).set(as(staff)).send({ duplicate_of_id: reqId }).expect(200)).body.duplicate_of_id).toBe(reqId);
    await request(app).post(`${B()}/requests/${reqId}/duplicate`).set(as(staff)).send({ duplicate_of_id: dup }).expect(409);
    vendorId = (await request(app).post(`${B()}/vendors`).set(as(manager)).send({ name: 'Pipe Pros', trade: 'plumbing', insurance_expires_on: '2099-01-01' }).expect(201)).body.id;
    const v2 = (await request(app).post(`${B()}/vendors`).set(as(manager)).send({ name: 'Old Pipes', trade: 'plumbing', insurance_expires_on: '2001-01-01' }).expect(201)).body.id;
    await request(app).post(`${B()}/requests/${reqId}/quotes`).set(as(manager)).send({ vendor_id: v2, amount_cents: 100 }).expect(409);
    const q1 = (await request(app).post(`${B()}/requests/${reqId}/quotes`).set(as(manager)).send({ vendor_id: vendorId, amount_cents: 80000 }).expect(201)).body.id;
    const cmp = (await request(app).get(`${B()}/requests/${reqId}/quotes`).set(as(manager)).expect(200)).body;
    expect(cmp.quotes[0]).toMatchObject({ lowest: true, needs_approval: true });
    await request(app).post(`${B()}/quotes/${q1}/select`).set(as(manager)).expect(200);
    await request(app).post(`${B()}/requests/${reqId}/work-orders`).set(as(manager)).send({ quote_id: q1 }).expect(409);
    expect((await request(app).post(`${B()}/requests/${reqId}/approval`).set(as(manager)).send({ amount_cents: 80000 }).expect(200)).body.approval_status).toBe('pending');
    expect(sent('property_approval_requested')).toContain(landlord);
    const inbox = (await request(app).get('/api/me/property/approvals').set(as(landlord)).expect(200)).body;
    expect(inbox.approvals[0]).toMatchObject({ id: reqId, approval_amount_cents: 80000 });
    await request(app).post(`/api/me/property/approvals/${reqId}`).set(as(other)).send({ decision: 'approved' }).expect(404);
    await request(app).post(`/api/me/property/approvals/${reqId}`).set(as(landlord)).send({ decision: 'approved' }).expect(200);
    expect(sent('property_approval_decided')).toContain(manager);
    const wo = (await request(app).post(`${B()}/requests/${reqId}/work-orders`).set(as(manager)).send({ quote_id: q1 }).expect(201)).body;
    expect(wo).toMatchObject({ number: 'WO-00001', not_to_exceed_cents: 80000, vendor: 'Pipe Pros' });
    await request(app).post(`${B()}/requests/${reqId}/work-orders`).set(as(manager)).send({ quote_id: q1 }).expect(409);
    // 339 invoice matching
    const inv = (await request(app).post(`${B()}/invoices`).set(as(manager)).send({ vendor_id: vendorId, work_order_id: wo.id, invoice_number: 'INV-1', amount_cents: 90000 }).expect(201)).body;
    expect(inv.match_status).toBe('over');
    await request(app).post(`${B()}/invoices`).set(as(manager)).send({ vendor_id: vendorId, work_order_id: wo.id, invoice_number: 'INV-1', amount_cents: 1 }).expect(409);
    await request(app).post(`${B()}/invoices/${inv.id}/decision`).set(as(manager)).send({ decision: 'approved' }).expect(200);
    const costs = (await request(app).get(`${B()}/costs`).set(as(manager)).expect(200)).body;
    const row = costs.properties.find(p => p.id === pid);
    expect(row).toMatchObject({ month_spend_cents: 90000, over_budget: false, reserve_funded_pct: 25, reserve_short_cents: 150000 });
    const us = (await request(app).get(`${B()}/p/${pid}/unit-spend`).set(as(manager)).expect(200)).body;
    expect(us.units[0]).toMatchObject({ unit_label: '2A', spend_cents: 90000 });
    await pool.query('UPDATE properties SET monthly_budget_cents=1000 WHERE id=$1', [pid]);
    expect((await request(app).post(`${B()}/costs/alerts`).set(as(manager)).expect(200)).body.over_budget).toBe(1);
  });

  test('321-325: entry consent, occupant window choice, expiring instructions, keys', async () => {
    await request(app).put(`${B()}/requests/${reqId}/entry`).set(as(other)).send({}).expect(404);
    const start = new Date(Date.now() + 864e5).toISOString(); const end = new Date(Date.now() + 864e5 + 72e5).toISOString();
    await request(app).put(`${B()}/requests/${reqId}/entry`).set(as(staff)).send({ consent: 'granted', consent_method: 'phone', consent_given_by: 'Tenant', offered_windows: [{ start, end }], instructions: 'Code 1234', instructions_expire_at: new Date(Date.now() + 1000).toISOString() }).expect(200);
    await request(app).post(`${B()}/requests/${reqId}/entry/notify`).set(as(staff)).expect(200);
    expect(sent('property_entry_scheduled')).toContain(tenant);
    expect((await request(app).get(`/api/me/property/entry/${reqId}`).set(as(tenant)).expect(200)).body.entry.offered_windows.length).toBe(1);
    await request(app).post(`/api/me/property/entry/${reqId}/window`).set(as(tenant)).send({ start: end }).expect(409);
    await request(app).post(`/api/me/property/entry/${reqId}/window`).set(as(tenant)).send({ start }).expect(200);
    await pool.query("UPDATE property_entry_records SET instructions_expire_at=NOW() - INTERVAL '1 minute' WHERE request_id=$1", [reqId]);
    const e = (await request(app).get(`${B()}/requests/${reqId}/entry`).set(as(staff)).expect(200)).body.entry;
    expect(e).toMatchObject({ instructions: null, instructions_expired: true, consent: 'granted', consent_expired: false });
    expect(new Date(e.selected_start).toISOString()).toBe(start);
    // D-505: consent authorizes the selected window only. Before the window
    // ends the visit is authorized; once the window ends it is not.
    expect((await request(app).get(`${B()}/requests/${reqId}/entry`).set(as(staff)).expect(200)).body.entry_authorized).toBe(true);
    await pool.query("UPDATE property_entry_records SET selected_end=NOW() - INTERVAL '1 hour' WHERE request_id=$1", [reqId]);
    const e2 = (await request(app).get(`${B()}/requests/${reqId}/entry`).set(as(staff)).expect(200)).body;
    expect(e2.entry_authorized).toBe(false);
    expect(e2.entry).toMatchObject({ consent_expired: true });
    // D-506: instructions saved with no explicit expiry default to the
    // latest offered window end.
    const req2 = (await pool.query(`INSERT INTO property_maintenance_requests(business_id,owner_id,requester_id,status,urgency,issue_category,title,description,property_id) VALUES($1,$2,$3,'reported','normal','plumbing','Tap','d',$4) RETURNING id`, [bizId, owner, tenant, pid])).rows[0].id;
    const w2s = new Date(Date.now() + 2 * 864e5).toISOString(); const w2e = new Date(Date.now() + 3 * 864e5).toISOString();
    const e3 = (await request(app).put(`${B()}/requests/${req2}/entry`).set(as(staff)).send({ consent: 'granted', consent_method: 'portal', offered_windows: [{ start: w2s, end: w2e }], instructions: 'Knock twice' }).expect(200)).body;
    expect(new Date(e3.instructions_expire_at).toISOString()).toBe(w2e);
    keyId = (await request(app).post(`${B()}/p/${pid}/keys`).set(as(manager)).send({ label: '2A front', unit_id: unitId }).expect(201)).body.id;
    await request(app).post(`${B()}/keys/${keyId}/check-out`).set(as(staff)).send({ holder_user_id: staff, request_id: reqId }).expect(200);
    await request(app).post(`${B()}/keys/${keyId}/check-out`).set(as(staff)).send({ holder_name: 'x' }).expect(409);
    const k = (await request(app).get(`${B()}/p/${pid}/keys`).set(as(staff)).expect(200)).body.keys[0];
    expect(k).toMatchObject({ status: 'out', holder_user_id: staff }); expect(k.events[0].action).toBe('check_out');
  });

  test('326-335: schedules, calendar, alerts, vendor booking, turnover sequence', async () => {
    const s = (await request(app).post(`${B()}/p/${pid}/schedules`).set(as(manager)).send({ kind: 'equipment', title: 'Boiler service', interval_days: 180, next_due_on: '2020-01-01' }).expect(201)).body;
    await request(app).post(`${B()}/p/${pid}/schedules`).set(as(manager)).send({ kind: 'seasonal', title: 'Gutters', interval_days: 30, next_due_on: '2099-01-01' }).expect(400);
    const vb = (await request(app).post(`${B()}/p/${pid}/schedules`).set(as(manager)).send({ kind: 'vendor', title: 'Pest visit', vendor_id: vendorId, interval_days: 30, next_due_on: new Date().toISOString().slice(0, 10) }).expect(201)).body;
    // D-510 (330): an open request past its SLA target is a breach; a
    // completed one past its target is not.
    const slaReq = (await pool.query(`INSERT INTO property_maintenance_requests(business_id,owner_id,requester_id,status,urgency,issue_category,title,description,property_id,sla_target_at) VALUES($1,$2,$3,'reported','urgent','plumbing','Burst pipe','d',$4,NOW() - INTERVAL '2 hours') RETURNING id`, [bizId, owner, tenant, pid])).rows[0].id;
    const doneReq = (await pool.query(`INSERT INTO property_maintenance_requests(business_id,owner_id,status,urgency,issue_category,title,description,property_id,sla_target_at) VALUES($1,$2,'reported','normal','plumbing','Old tap','d',$3,NOW() - INTERVAL '2 hours') RETURNING id`, [bizId, owner, pid])).rows[0].id;
    await pool.query("UPDATE property_maintenance_requests SET status='completed' WHERE id=$1", [doneReq]);
    const al = (await request(app).get(`${B()}/alerts`).set(as(staff)).expect(200)).body;
    expect(al.overdue.map(i => i.id)).toContain(s.id);
    expect(al.sla_breaches.map(i => i.id)).toContain(slaReq);
    expect(al.sla_breaches.map(i => i.id)).not.toContain(doneReq);
    expect((await request(app).post(`${B()}/alerts/notify`).set(as(manager)).expect(200)).body.notified).toBeGreaterThan(0);
    expect(sent('property_sla_breach')).toContain(owner);
    expect((await request(app).post(`${B()}/alerts/notify`).set(as(manager)).expect(200)).body.notified).toBe(0);
    const done = (await request(app).post(`${B()}/schedules/${s.id}/done`).set(as(staff)).send({ done_on: '2026-01-10' }).expect(200)).body;
    expect(done.next_due_on.slice(0, 10)).toBe('2026-07-09');
    const b1 = (await request(app).post(`${B()}/schedules/${vb.id}/book`).set(as(staff)).expect(200)).body;
    expect(b1.created).toBe(true);
    expect((await request(app).post(`${B()}/schedules/${vb.id}/book`).set(as(staff)).expect(200)).body).toMatchObject({ created: false, request_id: b1.request_id });
    expect((await request(app).get(`${B()}/calendar`).set(as(manager)).expect(200)).body.items.length).toBeGreaterThan(0);
    const tv = (await request(app).post(`${B()}/p/${pid}/turnovers`).set(as(manager)).send({ unit_id: unitId, move_out_on: '2026-12-01', move_in_on: '2026-12-15' }).expect(201)).body;
    await request(app).post(`${B()}/p/${pid}/turnovers`).set(as(manager)).send({ unit_id: unitId }).expect(409);
    const step = (k, body) => request(app).post(`${B()}/turnovers/${tv.id}/steps/${k}`).set(as(staff)).send(body);
    await step('cleaning', { status: 'done' }).expect(409);
    await step('move_out_inspection', { status: 'done' }).expect(200);
    await step('repairs', { status: 'done', request_ids: [reqId] }).expect(409);
    await pool.query("UPDATE property_maintenance_requests SET status='completed' WHERE id=$1", [reqId]);
    await step('repairs', { status: 'done' }).expect(200);
    await step('cleaning', { status: 'done' }).expect(200);
    await step('keys_returned', { status: 'done' }).expect(409);
    await request(app).post(`${B()}/keys/${keyId}/return`).set(as(staff)).send({}).expect(200);
    await step('keys_returned', { status: 'done' }).expect(200);
    expect((await step('final_walkthrough', { status: 'done' }).expect(200)).body.status).toBe('ready');
    const board = (await request(app).get(`${B()}/turnovers`).set(as(staff)).expect(200)).body;
    expect(board.turnovers[0]).toMatchObject({ done_steps: 5, total_steps: 5 });
    await request(app).post(`${B()}/turnovers/${tv.id}/close`).set(as(manager)).send({ status: 'completed' }).expect(200);
    expect((await pool.query('SELECT occupancy_status FROM property_portfolio_units WHERE id=$1', [unitId])).rows[0].occupancy_status).toBe('occupied');
  });

  test('341-345: emergency routing, incidents, evidence, owner summary', async () => {
    const { rows: [{ id: em }] } = await pool.query(`INSERT INTO property_maintenance_requests(business_id,owner_id,status,urgency,issue_category,title,description,property_id) VALUES($1,$2,'reported','emergency','water','Flood','d',$3) RETURNING id`, [bizId, owner, pid]);
    const r = (await request(app).post(`${B()}/requests/${em}/emergency`).set(as(staff)).expect(200)).body;
    expect(r.notified).toBeGreaterThan(0); expect(sent('property_emergency')).toContain(owner);
    const inc = (await request(app).post(`${B()}/p/${pid}/incidents`).set(as(staff)).send({ title: 'Flood 2A', unit_id: unitId, request_id: em, relocation_note: 'Hotel 3 nights', follow_up_on: '2020-01-01' }).expect(201)).body;
    await request(app).post(`${B()}/incidents/${inc.id}/evidence`).set(as(staff)).send({ url: 'http://x' }).expect(400);
    await request(app).post(`${B()}/incidents/${inc.id}/evidence`).set(as(staff)).send({ url: 'https://files.example/p1.jpg', label: 'Ceiling' }).expect(200);
    expect((await request(app).get(`${B()}/p/${pid}/incidents`).set(as(staff)).expect(200)).body.incidents[0]).toMatchObject({ follow_up_overdue: true });
    await request(app).patch(`${B()}/incidents/${inc.id}`).set(as(staff)).send({ follow_up_done: true }).expect(200);
    await request(app).post(`${B()}/incidents/${inc.id}/share`).set(as(manager)).expect(409);
    await request(app).patch(`${B()}/incidents/${inc.id}`).set(as(manager)).send({ owner_summary: 'Pipe burst; repaired.' }).expect(200);
    await request(app).post(`${B()}/incidents/${inc.id}/share`).set(as(manager)).expect(200);
    expect((await request(app).get('/api/me/property/incidents').set(as(landlord)).expect(200)).body.incidents[0]).toMatchObject({ owner_summary: 'Pipe burst; repaired.', evidence_count: 1 });
  });

  test('346-350: handover export, reassignment, occupant notice, revocation', async () => {
    await request(app).post(`${B()}/p/${pid}/assignments`).set(as(manager)).send({ role: 'manager', user_id: manager }).expect(201);
    const ex = (await request(app).get(`${B()}/p/${pid}/handover`).set(as(manager)).expect(200)).body;
    expect(ex.vendor_contacts.map(v => v.name)).toContain('Pipe Pros');
    const re = (await request(app).post(`${B()}/p/${pid}/reassign`).set(as(owner)).send({ to_user_id: other }).expect(200)).body;
    expect(re.ended).toBe(1); expect(sent('property_manager_changed')).toContain(manager);
    expect((await request(app).post(`${B()}/p/${pid}/notify-occupants`).set(as(owner)).expect(200)).body.notified).toBe(1);
    await request(app).post(`${B()}/keys/${keyId}/check-out`).set(as(staff)).send({ holder_user_id: staff }).expect(200);
    const rv = (await request(app).post(`${B()}/p/${pid}/revoke`).set(as(owner)).send({ user_id: staff }).expect(200)).body;
    expect(rv.keys_to_recover.length).toBe(1);
    await request(app).get(`${B()}/p/${pid}`).set(as(staff)).expect(404);
  });
});
