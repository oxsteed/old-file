'use strict';
// Gaps batch (317/323/345, D-433/D-434/D-435): owner approval inbox,
// occupant window selection, owner incident summary. Proves each read path
// the new screens call returns the right data to the right caller, and the
// manager-side entry leg still works after the occupant selects a window.
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
const owner = crypto.randomUUID(), manager = crypto.randomUUID(), staff = crypto.randomUUID(), stranger = crypto.randomUUID(), landlord = crypto.randomUUID(), tenant = crypto.randomUUID();
let app, bizId;
const as = (u) => ({ 'x-user': u });
const sent = (type) => sendNotification.mock.calls.filter(c => c[0].type === type).map(c => c[0].userId);

describeDb('Gaps: property panels (317/323/345)', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, staff, stranger, landlord, tenant]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Gap','User','customer',TRUE,TRUE,'555-0100')", [id, `gap-${id}@example.invalid`]);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Gap Prop Co','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [staff, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [bizId, owner, id, `gap-${id}@x.invalid`, role]);
    const { router, meRouter } = require('../routes/propertyManager');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router); app.use('/api/me/property', meRouter);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code, message: err.message })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id=$1', [bizId]); await pool.end(); });
  const B = () => `/api/businesses/${bizId}/properties`;
  let pid, unitId, reqId, incId;

  test('317: owner approval inbox, decide, audit trail; stranger sees nothing', async () => {
    pid = (await request(app).post(B()).set(as(manager)).send({ label: 'Gap Court', address: '2 Gap', property_type: 'multi_family', approval_threshold_cents: 50000, owner_user_id: landlord }).expect(201)).body.id;
    unitId = (await request(app).post(`${B()}/p/${pid}/units`).set(as(manager)).send({ unit_label: '1A', occupancy_status: 'occupied' }).expect(201)).body.id;
    // Staff acts on this property only through an active assignment.
    await request(app).post(`${B()}/p/${pid}/assignments`).set(as(manager)).send({ role: 'building_staff', user_id: staff }).expect(201);
    ({ rows: [{ id: reqId }] } = await pool.query(`INSERT INTO property_maintenance_requests(business_id,owner_id,requester_id,status,urgency,issue_category,title,description,property_label,unit_label,property_id,unit_id)
      VALUES($1,$2,$3,'reported','urgent','plumbing','Gap leak','d','Gap Court','1A',$4,$5) RETURNING id`, [bizId, owner, tenant, pid, unitId]));
    // Under the threshold: auto-approved, never reaches the inbox.
    expect((await request(app).post(`${B()}/requests/${reqId}/approval`).set(as(manager)).send({ amount_cents: 100 }).expect(200)).body.approval_status).toBe('approved');
    expect((await request(app).get('/api/me/property/approvals').set(as(landlord)).expect(200)).body.approvals).toEqual([]);
    // Over the threshold: pending, visible to the property owner only.
    expect((await request(app).post(`${B()}/requests/${reqId}/approval`).set(as(manager)).send({ amount_cents: 80000, note: 'New boiler' }).expect(200)).body.approval_status).toBe('pending');
    expect(sent('property_approval_requested')).toContain(landlord);
    const inbox = (await request(app).get('/api/me/property/approvals').set(as(landlord)).expect(200)).body;
    expect(inbox.approvals).toHaveLength(1);
    expect(inbox.approvals[0]).toMatchObject({ id: reqId, approval_amount_cents: 80000, approval_note: 'New boiler', property: 'Gap Court' });
    // Stranger: empty inbox (no existence leak), 404 on decide and on the trail.
    expect((await request(app).get('/api/me/property/approvals').set(as(stranger)).expect(200)).body.approvals).toEqual([]);
    await request(app).post(`/api/me/property/approvals/${reqId}`).set(as(stranger)).send({ decision: 'approved' }).expect(404);
    await request(app).get(`/api/me/property/approvals/${reqId}/events`).set(as(stranger)).expect(404);
    // Audit trail shows the request event to the approver, before deciding.
    const trail = (await request(app).get(`/api/me/property/approvals/${reqId}/events`).set(as(landlord)).expect(200)).body;
    expect(trail.events.map(e => e.event_type)).toContain('approval_requested');
    expect(trail.events.find(e => e.event_type === 'approval_requested')).toMatchObject({ note: 'New boiler' });
    expect(typeof trail.events.find(e => e.event_type === 'approval_requested').actor_name).toBe('string');
    // Decide with a note; the decision notifies the requester and the item
    // moves from pending to the decided list with its trail intact.
    expect((await request(app).post(`/api/me/property/approvals/${reqId}`).set(as(landlord)).send({ decision: 'declined', note: 'Too pricey' }).expect(200)).body.approval_status).toBe('declined');
    expect(sent('property_approval_decided')).toContain(manager);
    const after = (await request(app).get('/api/me/property/approvals').set(as(landlord)).expect(200)).body;
    expect(after.approvals).toEqual([]);
    expect(after.decided).toHaveLength(1);
    expect(after.decided[0]).toMatchObject({ id: reqId, approval_status: 'declined' });
    expect(after.decided[0].approval_decided_at).toBeTruthy();
    const trailAfter = (await request(app).get(`/api/me/property/approvals/${reqId}/events`).set(as(landlord)).expect(200)).body;
    expect(trailAfter.events.map(e => e.event_type)).toEqual(expect.arrayContaining(['approval_requested', 'approval_declined']));
    // Deciding twice is a 404: the request is no longer pending.
    await request(app).post(`/api/me/property/approvals/${reqId}`).set(as(landlord)).send({ decision: 'approved' }).expect(404);
  });

  test('323: occupant window selection; manager leg still works', async () => {
    const start = new Date(Date.now() + 864e5).toISOString();
    const end = new Date(Date.now() + 864e5 + 72e5).toISOString();
    const otherStart = new Date(Date.now() + 2 * 864e5).toISOString();
    const otherEnd = new Date(Date.now() + 2 * 864e5 + 72e5).toISOString();
    // Manager offers two windows and notifies the occupant.
    await request(app).put(`${B()}/requests/${reqId}/entry`).set(as(staff)).send({ consent: 'granted', consent_method: 'portal', consent_given_by: 'Tenant', offered_windows: [{ start, end }, { start: otherStart, end: otherEnd }], instructions: 'Code 1234' }).expect(200);
    await request(app).post(`${B()}/requests/${reqId}/entry/notify`).set(as(staff)).expect(200);
    expect(sent('property_entry_scheduled')).toContain(tenant);
    // Stranger cannot read or pick windows on someone else's request.
    await request(app).get(`/api/me/property/entry/${reqId}`).set(as(stranger)).expect(404);
    await request(app).post(`/api/me/property/entry/${reqId}/window`).set(as(stranger)).send({ start }).expect(404);
    // Occupant sees both offered windows, nothing selected yet.
    const seen = (await request(app).get(`/api/me/property/entry/${reqId}`).set(as(tenant)).expect(200)).body;
    expect(seen).toMatchObject({ request_id: reqId, title: 'Gap leak' });
    expect(seen.entry.offered_windows).toHaveLength(2);
    expect(seen.entry.selected_start).toBeNull();
    expect(seen.entry.occupant_notified_at).toBeTruthy();
    // A window that was never offered is refused; an offered one sticks.
    await request(app).post(`/api/me/property/entry/${reqId}/window`).set(as(tenant)).send({ start: new Date(Date.now() + 3 * 864e5).toISOString() }).expect(409);
    expect((await request(app).post(`/api/me/property/entry/${reqId}/window`).set(as(tenant)).send({ start: otherStart }).expect(200)).body.selected).toMatchObject({ start: otherStart, end: otherEnd });
    // No manager/coverage assignment on the property, so the window notice
    // falls back to the business owner.
    expect(sent('property_entry_window_selected')).toContain(owner);
    const after = (await request(app).get(`/api/me/property/entry/${reqId}`).set(as(tenant)).expect(200)).body;
    expect(new Date(after.entry.selected_start).toISOString()).toBe(otherStart);
    expect(after.entry.consent).toBe('granted');
    // Manager leg still works: the manager read shows the occupant's choice.
    const mgr = (await request(app).get(`${B()}/requests/${reqId}/entry`).set(as(staff)).expect(200)).body;
    expect(new Date(mgr.entry.selected_start).toISOString()).toBe(otherStart);
    expect(mgr).toMatchObject({ permission_to_enter: true });
  });

  test('345: owner incident summary with category, assignee, follow-up; stranger sees nothing', async () => {
    // Category/assignee must be real: an unknown assignee is rejected.
    await request(app).post(`${B()}/p/${pid}/incidents`).set(as(staff)).send({ title: 'Bad assign', assigned_to: crypto.randomUUID() }).expect(404);
    incId = (await request(app).post(`${B()}/p/${pid}/incidents`).set(as(staff)).send({ title: 'Gap flood', severity: 'major', category: 'water damage', assigned_to: staff, unit_id: unitId, request_id: reqId, follow_up_on: '2026-12-01' }).expect(201)).body.id;
    const listed = (await request(app).get(`${B()}/p/${pid}/incidents`).set(as(staff)).expect(200)).body.incidents;
    const listedInc = listed.find(i => i.id === incId);
    expect(listedInc).toMatchObject({ category: 'water damage', assigned_to: staff, assignee_name: 'Gap User', status: 'open' });
    expect(String(listedInc.follow_up_on).slice(0, 10)).toBe('2026-12-01');
    // Not shared with the owner yet: the owner summary stays empty.
    expect((await request(app).get('/api/me/property/incidents').set(as(landlord)).expect(200)).body.incidents).toEqual([]);
    await request(app).post(`${B()}/incidents/${incId}/share`).set(as(manager)).expect(409);
    await request(app).patch(`${B()}/incidents/${incId}`).set(as(manager)).send({ owner_summary: 'Pipe burst; repaired.', category: 'plumbing failure' }).expect(200);
    await request(app).post(`${B()}/incidents/${incId}/share`).set(as(manager)).expect(200);
    const mine = (await request(app).get('/api/me/property/incidents').set(as(landlord)).expect(200)).body.incidents;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: incId, title: 'Gap flood', category: 'plumbing failure', assignee_name: 'Gap User', status: 'open', property: 'Gap Court', owner_summary: 'Pipe burst; repaired.' });
    expect(String(mine[0].follow_up_on).slice(0, 10)).toBe('2026-12-01');
    expect(mine[0].evidence_count).toBe(0);
    // Stranger sees no incidents; reassigning the category sticks in both reads.
    expect((await request(app).get('/api/me/property/incidents').set(as(stranger)).expect(200)).body.incidents).toEqual([]);
    await request(app).patch(`${B()}/incidents/${incId}`).set(as(manager)).send({ assigned_to: null }).expect(200);
    const unassigned = (await request(app).get('/api/me/property/incidents').set(as(landlord)).expect(200)).body.incidents[0];
    expect(unassigned.assigned_to).toBeNull();
    expect(unassigned.assignee_name).toBeNull();
  });
});
