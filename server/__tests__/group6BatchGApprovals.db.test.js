'use strict';
// Batch G (311-320 + G6-17 + convertToJob archived exclusion): spending
// approval default $0 fail-closed with owner self-approval, finance-read
// cost gate, triage ordering, manager-only property creation with a
// duplicate-label guard, and no conversion off an archived property.
const raw = process.env.ACCESS_TEST_DATABASE_URL || process.env.STATEMENT_TEST_DATABASE_URL;
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
const maintenanceRequestController = require('../controllers/maintenanceRequestController');
const describeDb = raw ? describe : describe.skip;
const owner = crypto.randomUUID(), manager = crypto.randomUUID(), staff = crypto.randomUUID(), landlord = crypto.randomUUID(), tenant = crypto.randomUUID();
let app, bizId;
const as = (u) => ({ 'x-user': u });

describeDb('Batch G: approvals, triage, property creation, archived conversion', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, staff, landlord, tenant]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Batch','G','customer',TRUE,TRUE,'555-0100')", [id, `g6g-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Batch G Co','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [staff, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [bizId, owner, id, `g6g-${id}@x.invalid`, role]);
    const { router, meRouter } = require('../routes/propertyManager');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router); app.use('/api/me/property', meRouter);
    app.use('/api/maintenance-requests', require('../routes/maintenanceRequests'));
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code, message: err.message })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id=$1', [bizId]); await pool.end(); });
  const B = () => `/api/businesses/${bizId}/properties`;
  const M = () => `/api/maintenance-requests/business/${bizId}`;
  const mkReq = async (pid, title, urgency = 'normal') => (await pool.query(
    `INSERT INTO property_maintenance_requests(business_id,owner_id,requester_id,status,urgency,issue_category,title,description,property_id)
     VALUES($1,$2,$3,'reported',$4,'plumbing',$5,'d',$6) RETURNING id`,
    [bizId, owner, tenant, urgency, title, pid])).rows[0].id;

  test('316: threshold defaults to $0 (fail closed); owner self-approves, manager pends', async () => {
    // No owner_user_id on this property, so the business owner is the
    // approver; a distinct property owner would be the approver instead.
    const pid = (await request(app).post(B()).set(as(manager)).send({ label: 'Zero Court' }).expect(201)).body.id;
    const prop = (await request(app).get(`${B()}/p/${pid}`).set(as(manager)).expect(200)).body.property;
    expect(prop.approval_threshold_cents).toBe(0);
    const reqId = await mkReq(pid, 'Zero threshold leak');
    // A manager asking for $10 above the $0 default pends.
    expect((await request(app).post(`${B()}/requests/${reqId}/approval`).set(as(manager)).send({ amount_cents: 1000 }).expect(200)).body.approval_status).toBe('pending');
    const { rows: [ev] } = await pool.query("SELECT event_type FROM property_maintenance_request_events WHERE request_id=$1 AND event_type='approval_requested'", [reqId]);
    expect(ev).toBeDefined();
    // The business owner asking for the same spend self-approves instead:
    // a fresh request so no approval is already pending.
    const reqId2 = await mkReq(pid, 'Zero threshold leak 2');
    const out = (await request(app).post(`${B()}/requests/${reqId2}/approval`).set(as(owner)).send({ amount_cents: 1000 }).expect(200)).body;
    expect(out.approval_status).toBe('approved');
    const { rows: [r2] } = await pool.query('SELECT approval_decided_by FROM property_maintenance_requests WHERE id=$1', [reqId2]);
    expect(String(r2.approval_decided_by)).toBe(owner);
    const { rows: [ev2] } = await pool.query("SELECT event_type FROM property_maintenance_request_events WHERE request_id=$1 AND event_type='approval_self_approved'", [reqId2]);
    expect(ev2).toBeDefined();
    // The owner's pending queue holds the manager's request but not the
    // self-approved one.
    const inbox = (await request(app).get('/api/me/property/approvals').set(as(owner)).expect(200)).body;
    expect(inbox.approvals.map(a => a.id)).toContain(reqId);
    expect(inbox.approvals.map(a => a.id)).not.toContain(reqId2);
  });

  test('316/320: work order above the $0 default 409s for a manager, self-approves for the owner', async () => {
    const pid = (await request(app).post(B()).set(as(manager)).send({ label: 'WO Court' }).expect(201)).body.id;
    const reqId = await mkReq(pid, 'WO leak', 'urgent');
    const vendorId = (await request(app).post(`${B()}/vendors`).set(as(manager)).send({ name: 'G Pipe', trade: 'plumbing', insurance_expires_on: '2099-01-01' }).expect(201)).body.id;
    const q = (await request(app).post(`${B()}/requests/${reqId}/quotes`).set(as(manager)).send({ vendor_id: vendorId, amount_cents: 5000 }).expect(201)).body.id;
    await request(app).post(`${B()}/requests/${reqId}/work-orders`).set(as(manager)).send({ quote_id: q }).expect(409);
    const wo = (await request(app).post(`${B()}/requests/${reqId}/work-orders`).set(as(owner)).send({ quote_id: q }).expect(201)).body;
    expect(wo).toMatchObject({ not_to_exceed_cents: 5000, vendor: 'G Pipe' });
    const { rows: [r] } = await pool.query('SELECT approval_status, approval_decided_by FROM property_maintenance_requests WHERE id=$1', [reqId]);
    expect(r.approval_status).toBe('approved');
    expect(String(r.approval_decided_by)).toBe(owner);
  });

  test('G6-1: cost writes need finance read; non-cost updates stay open', async () => {
    const pid = (await request(app).post(B()).set(as(manager)).send({ label: 'Cost Court' }).expect(201)).body.id;
    const reqId = await mkReq(pid, 'Cost write check');
    await request(app).patch(`/api/maintenance-requests/${reqId}`).set(as(staff)).send({ actual_cost: 99 }).expect(403);
    await request(app).patch(`/api/maintenance-requests/${reqId}`).set(as(staff)).send({ estimated_cost: 50 }).expect(403);
    const ok = (await request(app).patch(`/api/maintenance-requests/${reqId}`).set(as(staff)).send({ status: 'accepted' }).expect(200)).body;
    expect(ok.request.status).toBe('accepted');
    const owned = (await request(app).patch(`/api/maintenance-requests/${reqId}`).set(as(owner)).send({ actual_cost: 42.5 }).expect(200)).body;
    expect(Number(owned.request.actual_cost)).toBe(42.5);
  });

  test('315: list orders open work by urgency then SLA deadline, closed rows last', async () => {
    const pid = (await request(app).post(B()).set(as(manager)).send({ label: 'Triage Court' }).expect(201)).body.id;
    const normal = await mkReq(pid, 'Triage normal', 'normal');
    const urgent = await mkReq(pid, 'Triage urgent', 'urgent');
    const emergency = await mkReq(pid, 'Triage emergency', 'emergency');
    const closed = await mkReq(pid, 'Triage closed emergency', 'emergency');
    await pool.query("UPDATE property_maintenance_requests SET status='completed' WHERE id=$1", [closed]);
    await pool.query("UPDATE property_maintenance_requests SET sla_target_at=NOW() + INTERVAL '2 hours' WHERE id=$1", [urgent]);
    await pool.query("UPDATE property_maintenance_requests SET sla_target_at=NOW() + INTERVAL '9 hours' WHERE id=$1", [emergency]);
    const rows = (await request(app).get(M()).set(as(manager)).expect(200)).body.requests;
    const idx = (id) => rows.findIndex(r => String(r.id) === String(id));
    expect(idx(emergency)).toBeGreaterThan(-1);
    expect(idx(emergency)).toBeLessThan(idx(urgent));
    expect(idx(urgent)).toBeLessThan(idx(normal));
    expect(idx(closed)).toBeGreaterThan(idx(normal));
  });

  test('G6-17: property creation is manager-only with a duplicate-label guard', async () => {
    await request(app).post(M() + '/properties').set(as(staff)).send({ label: 'Staff Court' }).expect(403);
    const created = (await request(app).post(M() + '/properties').set(as(manager)).send({ label: 'Dup Court' }).expect(201)).body.property;
    expect(created.label).toBe('Dup Court');
    await request(app).post(M() + '/properties').set(as(manager)).send({ label: 'Dup Court' }).expect(409);
    await request(app).post(M() + '/properties').set(as(manager)).send({ label: 'dup court' }).expect(409);
    await request(app).post(B()).set(as(manager)).send({ label: 'Dup Court' }).expect(409);
    // Archived labels are exempt: archive, then the label is free again.
    await request(app).post(`${B()}/p/${created.id}/archive`).set(as(manager)).send({ reason: 'sold', force: true }).expect(200);
    await request(app).post(M() + '/properties').set(as(manager)).send({ label: 'Dup Court' }).expect(201);
  });

  test('convertToJob refuses an archived property', async () => {
    const pid = (await request(app).post(B()).set(as(manager)).send({ label: 'Archive Court', address: '1 Old Rd', address_city: 'Columbus', address_country: 'US' }).expect(201)).body.id;
    const reqId = await mkReq(pid, 'Archived convert');
    await request(app).post(`${B()}/p/${pid}/archive`).set(as(manager)).send({ reason: 'sold', force: true }).expect(200);
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.payload = payload; return res; });
    const next = jest.fn();
    await maintenanceRequestController.convertToJob({ user: { id: owner }, params: { id: reqId }, body: {} }, res, next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('property_archived');
  });
});
