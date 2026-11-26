'use strict';
// Batch J (341-350): emergency triage + SLA-breach job, relocation note,
// follow-up inspection, case folder, portfolio export, property transfer,
// vendor carry-over, occupant note notice. 345/350 are re-verified here
// (already built); the group7 suite still proves 350's revoke leg.
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
const { runPropertySlaBreachEscalationJob } = require('../jobs/propertySlaBreachEscalation');
const describeDb = raw ? describe : describe.skip;
const owner = crypto.randomUUID(), manager = crypto.randomUUID(), staff = crypto.randomUUID(), other = crypto.randomUUID(), landlord = crypto.randomUUID(), tenant = crypto.randomUUID();
let app, bizA, bizB;
const as = (u) => ({ 'x-user': u });
const calls = (type, userId) => sendNotification.mock.calls.filter(c => c[0].type === type && (!userId || c[0].userId === userId));
const keys = (type, userId) => calls(type, userId).map(c => c[0].idempotencyKey);

describeDb('Batch J: property case, transfer, escalation', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, staff, other, landlord, tenant]) await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Prop','User','customer',TRUE,TRUE,'555-0100')", [id, `g7j-${id}@example.invalid`]);
    ({ rows: [{ id: bizA }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Prop Co J','service',TRUE,'UTC') RETURNING id", [owner]));
    ({ rows: [{ id: bizB }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Prop Co J2','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [staff, 'employee'], [other, 'employee']]) await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [bizA, owner, id, `g7j-${id}@x.invalid`, role]);
    const { router, meRouter } = require('../routes/propertyManager');
    const maintenanceRequests = require('../routes/maintenanceRequests');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router); app.use('/api/me/property', meRouter); app.use('/api/maintenance-requests', maintenanceRequests);
    app.use((err, req, res, next) => (process.env.G7DBG && console.log(err.code, err.message)) || res.status(err.statusCode || err.status || 500).json({ code: err.code, message: err.message })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => { await pool.query('DELETE FROM businesses WHERE id IN ($1,$2)', [bizA, bizB]); await pool.end(); });
  const B = (biz = bizA) => `/api/businesses/${biz}/properties`;
  let pid, unitId, pid2, unit2, reqA, reqB, reqTransfer, vendor2, incId;

  const mkReq = (overrides = {}) => pool.query(`INSERT INTO property_maintenance_requests(business_id,owner_id,requester_id,status,urgency,issue_category,title,description,property_label,unit_label,property_id,unit_id,sla_target_at,follow_up_due_at)
    VALUES($1,$2,$3,$4,$5,'plumbing',$6,'d','Elm Court','2A',$7,$8,$9,$10) RETURNING id`,
  [bizA, owner, tenant, overrides.status || 'reported', overrides.urgency || 'normal', overrides.title || 'Tap', pid, unitId,
    overrides.sla || new Date(Date.now() + 864e5).toISOString(), overrides.followUp || new Date('2026-12-01T00:00:00Z').toISOString()]).then(r => r.rows[0].id);

  test('setup: properties, units, assignments, transfer fixtures', async () => {
    pid = (await request(app).post(B()).set(as(manager)).send({ label: 'Elm Court', property_type: 'multi_family', owner_user_id: landlord }).expect(201)).body.id;
    unitId = (await request(app).post(`${B()}/p/${pid}/units`).set(as(manager)).send({ unit_label: '2A', occupancy_status: 'occupied' }).expect(201)).body.id;
    await request(app).post(`${B()}/p/${pid}/assignments`).set(as(manager)).send({ role: 'building_staff', user_id: staff }).expect(201);
    pid2 = (await request(app).post(B()).set(as(manager)).send({ label: 'Maple House', property_type: 'single_family' }).expect(201)).body.id;
    unit2 = (await request(app).post(`${B()}/p/${pid2}/units`).set(as(manager)).send({ unit_label: '1', occupancy_status: 'occupied' }).expect(201)).body.id;
    await request(app).post(`${B()}/p/${pid2}/assignments`).set(as(manager)).send({ role: 'building_staff', user_id: other }).expect(201);
    vendor2 = (await request(app).post(`${B()}/vendors`).set(as(manager)).send({ name: 'Carry Co', trade: 'plumbing', email: 'carry@example.invalid', insurance_expires_on: '2099-01-01' }).expect(201)).body.id;
    await request(app).post(`${B()}/p/${pid2}/schedules`).set(as(manager)).send({ kind: 'vendor', title: 'Pest visit', vendor_id: vendor2, interval_days: 30, next_due_on: '2099-01-01' }).expect(201);
    reqTransfer = await pool.query(`INSERT INTO property_maintenance_requests(business_id,owner_id,requester_id,status,urgency,issue_category,title,description,property_label,unit_label,property_id,unit_id) VALUES($1,$2,$3,'reported','normal','plumbing','Maple tap','d','Maple House','1',$4,$5) RETURNING id`, [bizA, owner, tenant, pid2, unit2]).then(r => r.rows[0].id);
    reqA = await mkReq({ title: 'Follow-up tap' });
    reqB = await mkReq({ title: 'Relink me' });
  });

  test('341: emergency triage lists emergencies first, breach job alerts once', async () => {
    const past = new Date(Date.now() - 2 * 3600e3).toISOString(); const future = new Date(Date.now() + 4 * 3600e3).toISOString();
    const em1 = await mkReq({ title: 'Burst', urgency: 'emergency', sla: past });
    const em2 = await mkReq({ title: 'No heat', urgency: 'emergency', sla: future });
    const ur1 = await mkReq({ title: 'Leak', urgency: 'urgent', sla: past });
    await mkReq({ title: 'Routine', urgency: 'normal', sla: past });
    const tri = (await request(app).get(`${B()}/emergencies`).set(as(manager)).expect(200)).body;
    expect(tri.emergencies.map(r => r.id)).toEqual([em1, em2, ur1]);
    expect(tri.emergencies[0]).toMatchObject({ breached: true });
    expect(tri.emergencies[1]).toMatchObject({ breached: false });
    expect((await request(app).get(`${B()}/emergencies`).set(as(other)).expect(200)).body.emergencies).toEqual([]);
    expect((await request(app).get(`${B()}/emergencies`).set(as(staff)).expect(200)).body.emergencies.map(r => r.id)).toContain(em1);
    const before = calls('property_sla_breach', owner).length;
    await runPropertySlaBreachEscalationJob();
    expect(calls('property_sla_breach', owner).length).toBeGreaterThan(before);
    for (const id of [em1, ur1]) {
      expect((await pool.query('SELECT sla_alerted_at FROM property_maintenance_requests WHERE id=$1', [id])).rows[0].sla_alerted_at).not.toBeNull();
    }
    const stamped = calls('property_sla_breach', owner).length;
    await runPropertySlaBreachEscalationJob();
    expect(calls('property_sla_breach', owner).length).toBe(stamped);
  });

  test('342+343: relocation note, follow-up recompute only on change, inspection on follow-up', async () => {
    const get = async () => (await request(app).get(`/api/maintenance-requests/${reqA}`).set(as(manager)).expect(200)).body.request;
    expect((await get()).follow_up_due_at.slice(0, 10)).toBe('2026-12-01');
    await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'reported', owner_notes: 'typo fix' }).expect(200);
    expect((await get()).follow_up_due_at.slice(0, 10)).toBe('2026-12-01');
    await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'reported', scheduled_start_at: '2026-12-05T10:00:00Z' }).expect(200);
    expect(new Date((await get()).follow_up_due_at).toISOString()).toBe('2026-12-05T22:00:00.000Z');
    await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'completed' }).expect(200);
    const done = new Date((await get()).follow_up_due_at).getTime();
    expect(Math.abs(done - (Date.now() + 2 * 864e5))).toBeLessThan(120e3);
    await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'completed', relocation_note: 'Hotel 3 nights', relocation_until: '2026-12-20' }).expect(200);
    const relocated = await get();
    expect(relocated).toMatchObject({ relocation_note: 'Hotel 3 nights' });
    expect(String(relocated.relocation_until).slice(0, 10)).toBe('2026-12-20');
    expect((await request(app).get(`/api/maintenance-requests/${reqA}`).set(as(tenant)).expect(200)).body.request).toMatchObject({ relocation_note: 'Hotel 3 nights' });
    await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'completed', relocation_until: '20-12-2026' }).expect(400);
    const insp = (await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'completed', follow_up_done: true }).expect(200)).body.follow_up_inspection;
    expect(insp).toMatchObject({ record_type: 'inspection', status: 'complete', request_id: reqA });
    const count = async () => (await pool.query('SELECT COUNT(*)::int n FROM property_compliance_records WHERE request_id=$1', [reqA])).rows[0].n;
    expect(await count()).toBe(1);
    await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'completed', follow_up_done: true }).expect(200);
    expect(await count()).toBe(1);
    await request(app).patch(`/api/maintenance-requests/${reqB}`).set(as(manager)).send({ status: 'reported', follow_up_done: true }).expect(409);
  });

  test('347: request re-link before conversion; archived, foreign and converted refuse', async () => {
    const arch = (await request(app).post(B()).set(as(manager)).send({ label: 'Old Barn J' }).expect(201)).body.id;
    await request(app).post(`${B()}/p/${arch}/archive`).set(as(manager)).send({ reason: 'sold' }).expect(200);
    const bHouse = (await request(app).post(B(bizB)).set(as(owner)).send({ label: 'B House' }).expect(201)).body.id;
    const moved = (await request(app).patch(`/api/maintenance-requests/${reqB}`).set(as(manager)).send({ status: 'reported', property_id: pid2 }).expect(200)).body.request;
    expect(moved).toMatchObject({ property_id: pid2, property_label: 'Maple House', unit_id: null });
    await request(app).patch(`/api/maintenance-requests/${reqB}`).set(as(manager)).send({ status: 'reported', property_id: arch }).expect(409);
    await request(app).patch(`/api/maintenance-requests/${reqB}`).set(as(manager)).send({ status: 'reported', property_id: bHouse }).expect(404);
    const { rows: [{ id: jobId }] } = await pool.query("INSERT INTO jobs(client_id,title,description,property_id) VALUES($1,'x','y',$2) RETURNING id", [owner, pid2]);
    await pool.query('UPDATE property_maintenance_requests SET job_id=$2 WHERE id=$1', [reqB, jobId]);
    await request(app).patch(`/api/maintenance-requests/${reqB}`).set(as(manager)).send({ status: 'reported', property_id: pid }).expect(409);
    await pool.query('UPDATE property_maintenance_requests SET job_id=NULL WHERE id=$1', [reqB]);
    await pool.query('DELETE FROM jobs WHERE id=$1', [jobId]);
  });

  test('344+345: case folder bundles request events, photos, evidence, documents; owner summary shared', async () => {
    await pool.query("UPDATE property_maintenance_requests SET photo_urls=$2 WHERE id=$1", [reqA, ['https://files.example/r1.jpg']]);
    incId = (await request(app).post(`${B()}/p/${pid}/incidents`).set(as(staff)).send({ title: 'Flood 2A', unit_id: unitId, request_id: reqA, relocation_note: 'Hotel 3 nights', relocation_until: '2026-12-20' }).expect(201)).body.id;
    await request(app).post(`${B()}/incidents/${incId}/evidence`).set(as(staff)).send({ url: 'https://files.example/p1.jpg', label: 'Ceiling', kind: 'photo' }).expect(200);
    await request(app).post(`${B()}/incidents/${incId}/evidence`).set(as(staff)).send({ url: 'https://files.example/report.pdf', label: 'Report', kind: 'document' }).expect(200);
    await pool.query("INSERT INTO property_compliance_records(business_id,unit_id,record_type,title,status,document_url) VALUES($1,$2,'inspection','Boiler cert','complete','https://files.example/boiler.pdf')", [bizA, unitId]);
    const folder = (await request(app).get(`${B()}/incidents/${incId}/case`).set(as(staff)).expect(200)).body;
    expect(folder.incident).toMatchObject({ relocation_note: 'Hotel 3 nights' });
    expect(folder.request.photo_urls).toContain('https://files.example/r1.jpg');
    expect(folder.request.events.length).toBeGreaterThan(0);
    expect(folder.evidence.map(e => e.kind).sort()).toEqual(['document', 'photo']);
    expect(folder.documents.map(d => d.document_url)).toContain('https://files.example/boiler.pdf');
    await request(app).get(`${B()}/incidents/${incId}/case`).set(as(other)).expect(404);
    await request(app).patch(`${B()}/incidents/${incId}`).set(as(manager)).send({ owner_summary: 'Pipe burst; repaired.' }).expect(200);
    await request(app).post(`${B()}/incidents/${incId}/share`).set(as(manager)).expect(200);
    expect((await request(app).get('/api/me/property/incidents').set(as(landlord)).expect(200)).body.incidents.map(i => i.id)).toContain(incId);
  });

  test('346: portfolio export JSON + CSV, manager-only', async () => {
    const json = (await request(app).get(`${B()}/export?format=json`).set(as(manager)).expect(200)).body;
    const elm = json.properties.find(p => p.property.label === 'Elm Court');
    expect(elm.units.map(u => u.unit_label)).toContain('2A');
    expect(json.vendors.map(v => v.name)).toContain('Carry Co');
    const csv = (await request(app).get(`${B()}/export?format=csv`).set(as(manager)).expect(200)).text;
    expect(csv.split('\r\n')[0]).toBe('property,type,address,city,owner,unit,occupancy,unit_contact_name,unit_contact_email,unit_contact_phone,managers,vendors,open_requests');
    expect(csv).toContain('Elm Court');
    const vcsv = (await request(app).get(`${B()}/export?format=csv&section=vendors`).set(as(manager)).expect(200)).text;
    expect(vcsv.split('\r\n')[0]).toBe('name,trade,status,contact_name,phone,email,license_number,insurance_expires_on,work_orders');
    expect(vcsv).toContain('Carry Co');
    await request(app).get(`${B()}/export?format=json`).set(as(staff)).expect(403);
  });

  test('347+348: transfer moves the property, ends assignments, carries vendors once', async () => {
    await pool.query("INSERT INTO property_vendors(business_id,created_by,name,trade,email,status) VALUES($1,$2,'Carry Co','plumbing','carry@example.invalid','approved')", [bizB, owner]);
    const { rows: [{ id: jobId }] } = await pool.query("INSERT INTO jobs(client_id,title,description,property_id) VALUES($1,'x','y',$2) RETURNING id", [owner, pid2]);
    await pool.query('UPDATE property_maintenance_requests SET job_id=$2 WHERE id=$1', [reqTransfer, jobId]);
    await request(app).post(`${B()}/p/${pid2}/transfer`).set(as(owner)).send({ to_business_id: bizB }).expect(409);
    await pool.query('UPDATE property_maintenance_requests SET job_id=NULL WHERE id=$1', [reqTransfer]);
    await pool.query('DELETE FROM jobs WHERE id=$1', [jobId]);
    await request(app).post(`${B()}/p/${pid2}/transfer`).set(as(manager)).send({ to_business_id: bizB }).expect(403);
    const dup = (await request(app).post(B(bizB)).set(as(owner)).send({ label: 'Maple House' }).expect(201)).body.id;
    await request(app).post(`${B()}/p/${pid2}/transfer`).set(as(owner)).send({ to_business_id: bizB }).expect(409);
    await request(app).delete(`${B(bizB)}/p/${dup}`).set(as(owner)).expect(200);
    const out = (await request(app).post(`${B()}/p/${pid2}/transfer`).set(as(owner)).send({ to_business_id: bizB }).expect(200)).body;
    expect(out.moved).toMatchObject({ units: 1 });
    expect(out.moved.requests).toBeGreaterThanOrEqual(2);
    expect(out.vendors_carried).toBe(0);
    expect(out.handover.property.label).toBe('Maple House');
    expect((await request(app).get(B(bizB)).set(as(owner)).expect(200)).body.properties.map(p => p.id)).toContain(pid2);
    expect((await request(app).get(B()).set(as(owner)).expect(200)).body.properties.map(p => p.id)).not.toContain(pid2);
    expect((await pool.query("SELECT COUNT(*)::int n FROM property_vendors WHERE business_id=$1 AND LOWER(name)='carry co'", [bizB])).rows[0].n).toBe(1);
    expect((await request(app).get(`${B()}/mine`).set(as(other)).expect(200)).body.properties.map(p => p.id)).not.toContain(pid2);
  });

  test('349: tenant-visible note update notifies once; owner notes and repeats stay silent', async () => {
    const before = calls('property_request_status', tenant).length;
    await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'completed', tenant_visible_notes: 'Plumber comes Tuesday' }).expect(200);
    expect(calls('property_request_status', tenant).length).toBe(before + 1);
    expect(keys('property_request_status', tenant).pop()).toContain('property-request-note:');
    await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'completed', owner_notes: 'internal only' }).expect(200);
    expect(calls('property_request_status', tenant).length).toBe(before + 1);
    await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'completed', tenant_visible_notes: 'Plumber comes Tuesday' }).expect(200);
    expect(calls('property_request_status', tenant).length).toBe(before + 1);
    await request(app).patch(`/api/maintenance-requests/${reqA}`).set(as(manager)).send({ status: 'in_progress', tenant_visible_notes: 'Back to work' }).expect(200);
    expect(calls('property_request_status', tenant).length).toBe(before + 2);
    expect(keys('property_request_status', tenant).pop()).toContain('property-request-status:');
  });

  test('350: re-verify revoke ends access and flags keys to recover', async () => {
    const keyId = (await request(app).post(`${B()}/p/${pid}/keys`).set(as(manager)).send({ label: '2A front', unit_id: unitId }).expect(201)).body.id;
    await request(app).post(`${B()}/keys/${keyId}/check-out`).set(as(staff)).send({ holder_user_id: staff }).expect(200);
    const rv = (await request(app).post(`${B()}/p/${pid}/revoke`).set(as(owner)).send({ user_id: staff }).expect(200)).body;
    expect(rv.keys_to_recover.length).toBe(1);
    await request(app).get(`${B()}/p/${pid}`).set(as(staff)).expect(404);
  });
});
