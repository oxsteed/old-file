'use strict';
// Batch F (301-310, Wave 1 partials): property lifecycle + units link +
// common areas + archived exclusion + assignment-model verification.
//
// Re-verified at the 5209b3981 tip: the Group 7 console (12f32acf0, D-240)
// already ships the portfolio dashboard (301), detail + PATCH + archive /
// restore (302/305), common areas (304) and the staff-assignment model
// (306-310, 350). This suite proves those paths still work AND proves the
// gaps Batch F closes: DELETE fail-closed on live requests (302), the
// unit label backfill + property_id wiring on the ops-tab leg (303),
// archived properties leaving the intake picker and legacy lists
// (302/305), and unit contact-email validation (309).
//
// Runs ONLY against the disposable G6F DB; the env guard refuses anything
// else. Never run against the shared credit_statement_test DB.
const raw = process.env.G6F_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/credit_statement_test_g6f') throw new Error('Disposable G6F database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); };
  return { authenticate, requireAuth: authenticate };
});
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const { sendNotification } = require('../services/notificationService');
const maintenanceRequestController = require('../controllers/maintenanceRequestController');
const propertyOperationsController = require('../controllers/propertyOperationsController');
const describeDb = raw ? describe : describe.skip;
jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

const owner = crypto.randomUUID();
const manager = crypto.randomUUID();
const staff = crypto.randomUUID();
const tenant = crypto.randomUUID();
const stranger = crypto.randomUUID();
let app;
let bizId;
let propertyA;
let propertyB;
let propertyC;
let openRequestA;
const as = (u) => ({ 'x-user': u });
const sent = (type) => sendNotification.mock.calls.filter((c) => c[0].type === type).map((c) => c[0].userId);
const B = () => `/api/businesses/${bizId}/properties`;

describeDb('Batch F: property lifecycle, units link, common areas, assignments', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, staff, tenant, stranger]) {
      await pool.query(
        "INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,onboarding_completed,phone) VALUES($1,$2,'x','Batch','F','customer',TRUE,TRUE,TRUE,'555-0100')",
        [id, `g6f-${id}@example.invalid`]
      );
    }
    ({ rows: [{ id: bizId }] } = await pool.query(
      "INSERT INTO businesses(user_id,business_name,business_kind,is_active,is_listed,setup_status,timezone) VALUES($1,'G6F Prop Co','service',TRUE,TRUE,'active','UTC') RETURNING id",
      [owner]
    ));
    for (const [id, role] of [[manager, 'manager'], [staff, 'employee']]) {
      await pool.query(
        "INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())",
        [bizId, owner, id, `g6f-${id}@x.invalid`, role]
      );
    }
    const { router, meRouter } = require('../routes/propertyManager');
    app = express();
    app.use(express.json());
    app.use('/api/businesses', router);
    app.use('/api/me/property', meRouter);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code, message: err.message })); // eslint-disable-line no-unused-vars

    propertyA = (await request(app).post(B()).set(as(manager)).send({ label: 'Maple Court', address: '1 Maple Way', property_type: 'multi_family' }).expect(201)).body;
    propertyB = (await request(app).post(B()).set(as(manager)).send({ label: 'Oak House', address: '2 Oak Lane', property_type: 'single_family' }).expect(201)).body;
    // One linked unit + one open request on A; one completed request on B.
    await request(app).post(`${B()}/p/${propertyA.id}/units`).set(as(manager)).send({ unit_label: '1A', occupancy_status: 'occupied', contact_name: 'Ana', contact_email: 'ana@example.invalid' }).expect(201);
    ({ rows: [{ id: openRequestA }] } = await pool.query(
      `INSERT INTO property_maintenance_requests(business_id,owner_id,requester_id,status,urgency,issue_category,title,description,property_label,unit_label,property_id)
       VALUES($1,$2,$3,'reported','urgent','plumbing','Leaking sink','d','Maple Court','1A',$4) RETURNING id`,
      [bizId, owner, tenant, propertyA.id]
    ));
    await pool.query(
      `INSERT INTO property_maintenance_requests(business_id,owner_id,requester_id,status,urgency,issue_category,title,description,property_label,property_id)
       VALUES($1,$2,$3,'completed','normal','electrical','Fixed outlet','d','Oak House',$4)`,
      [bizId, owner, tenant, propertyB.id]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM property_maintenance_requests WHERE business_id=$1', [bizId]);
    await pool.query('DELETE FROM property_staff_assignments WHERE business_id=$1', [bizId]);
    await pool.query('DELETE FROM property_common_areas WHERE business_id=$1', [bizId]);
    await pool.query('DELETE FROM property_portfolio_units WHERE business_id=$1', [bizId]);
    await pool.query('DELETE FROM properties WHERE business_id=$1', [bizId]);
    await pool.query('DELETE FROM businesses WHERE id=$1', [bizId]);
    await pool.end();
  });

  test('301: portfolio returns per-property metrics; unassigned staff sees nothing', async () => {
    const body = (await request(app).get(B()).set(as(owner)).expect(200)).body;
    expect(body.totals.properties).toBe(2);
    const a = body.properties.find((p) => p.id === propertyA.id);
    expect(a.open_requests).toBe(1);
    expect(a.units).toBe(1);
    expect(a.urgent_requests).toBe(1);
    const b = body.properties.find((p) => p.id === propertyB.id);
    expect(b.open_requests).toBe(0);
    // Fail-closed scope: staff with no assignment sees no properties.
    expect((await request(app).get(B()).set(as(staff)).expect(200)).body.properties).toEqual([]);
  });

  test('301/302: profile returns units + history; PATCH renames the property', async () => {
    const profile = (await request(app).get(`${B()}/p/${propertyA.id}`).set(as(owner)).expect(200)).body;
    expect(profile.units).toHaveLength(1);
    expect(profile.units[0].unit_label).toBe('1A');
    expect(profile.history).toHaveLength(1);
    expect(profile.history[0].title).toBe('Leaking sink');
    const updated = (await request(app).patch(`${B()}/p/${propertyA.id}`).set(as(manager)).send({ label: 'Maple Court North' }).expect(200)).body;
    expect(updated.label).toBe('Maple Court North');
    // Route-level gate: staff cannot PATCH.
    await request(app).patch(`${B()}/p/${propertyA.id}`).set(as(staff)).send({ label: 'Nope' }).expect(403);
    // Restore the label for the backfill test, which matches on it.
    await request(app).patch(`${B()}/p/${propertyA.id}`).set(as(manager)).send({ label: 'Maple Court' }).expect(200);
  });

  test('303: label backfill links legacy units by exact trimmed label', async () => {
    const { rows: [legacy] } = await pool.query(
      `INSERT INTO property_portfolio_units(business_id,property_label,unit_label,occupancy_status)
       VALUES($1,'Oak House','2B','occupied') RETURNING id`,
      [bizId]
    );
    const { rows: [nomatch] } = await pool.query(
      `INSERT INTO property_portfolio_units(business_id,property_label,unit_label,occupancy_status)
       VALUES($1,'No Such Building','9Z','occupied') RETURNING id`,
      [bizId]
    );
    const { rows: [wrongCase] } = await pool.query(
      `INSERT INTO property_portfolio_units(business_id,property_label,unit_label,occupancy_status)
       VALUES($1,'oak house','3C','occupied') RETURNING id`,
      [bizId]
    );
    // Run the shipped migration file itself, twice: it must be idempotent.
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20261125203000_property_unit_label_backfill.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(sql);
    const { rows } = await pool.query('SELECT id, property_id FROM property_portfolio_units WHERE id = ANY($1)', [[legacy.id, nomatch.id, wrongCase.id]]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.property_id]));
    expect(byId[legacy.id]).toBe(propertyB.id);
    expect(byId[nomatch.id]).toBeNull();
    expect(byId[wrongCase.id]).toBeNull();
  });

  test('303/309: ops-tab units link by property_id and validate contact email', async () => {
    const linked = await call(propertyOperationsController.createUnit, {
      business: { id: bizId },
      body: { property_id: propertyB.id, unit_label: '4D', contact_name: 'Ben', contact_email: 'ben@example.invalid' },
    });
    expect(linked.err).toBeNull();
    expect(linked.res.statusCode).toBe(201);
    expect(linked.res.payload.unit.property_id).toBe(propertyB.id);
    expect(linked.res.payload.unit.property_label).toBe('Oak House');

    const wrongBiz = await call(propertyOperationsController.createUnit, {
      business: { id: bizId },
      body: { property_id: crypto.randomUUID(), unit_label: '5E' },
    });
    expect(wrongBiz.err).not.toBeNull();
    expect(wrongBiz.err.statusCode).toBe(404);

    const badEmail = await call(propertyOperationsController.createUnit, {
      business: { id: bizId },
      body: { property_label: 'Oak House', unit_label: '6F', contact_email: 'not-an-email' },
    });
    expect(badEmail.err).not.toBeNull();
    expect(badEmail.err.statusCode).toBe(400);

    const noLabel = await call(propertyOperationsController.createUnit, {
      business: { id: bizId },
      body: { unit_label: '7G' },
    });
    expect(noLabel.err).not.toBeNull();
    expect(noLabel.err.statusCode).toBe(400);

    // Re-link the unit to A syncs the label; unlinking clears the link.
    const relinked = await call(propertyOperationsController.updateUnit, {
      business: { id: bizId },
      params: { unitId: linked.res.payload.unit.id },
      body: { property_id: propertyA.id },
    });
    expect(relinked.err).toBeNull();
    expect(relinked.res.payload.unit.property_id).toBe(propertyA.id);
    expect(relinked.res.payload.unit.property_label).toBe('Maple Court');
    const unlinked = await call(propertyOperationsController.updateUnit, {
      business: { id: bizId },
      params: { unitId: linked.res.payload.unit.id },
      body: { property_id: null },
    });
    expect(unlinked.err).toBeNull();
    expect(unlinked.res.payload.unit.property_id).toBeNull();
    expect(unlinked.res.payload.unit.property_label).toBe('Maple Court');
    const badEmailUpdate = await call(propertyOperationsController.updateUnit, {
      business: { id: bizId },
      params: { unitId: linked.res.payload.unit.id },
      body: { contact_email: 'still-not-an-email' },
    });
    expect(badEmailUpdate.err).not.toBeNull();
    expect(badEmailUpdate.err.statusCode).toBe(400);
  });

  test('304: common areas list on the profile and archive out of it', async () => {
    const area = (await request(app).post(`${B()}/p/${propertyB.id}/common-areas`).set(as(manager)).send({ name: 'Laundry room', kind: 'laundry', access_notes: 'Code 1234' }).expect(201)).body;
    let profile = (await request(app).get(`${B()}/p/${propertyB.id}`).set(as(owner)).expect(200)).body;
    expect(profile.common_areas.map((a) => a.name)).toContain('Laundry room');
    await request(app).delete(`${B()}/common-areas/${area.id}`).set(as(manager)).expect(200);
    profile = (await request(app).get(`${B()}/p/${propertyB.id}`).set(as(owner)).expect(200)).body;
    expect(profile.common_areas.map((a) => a.name)).not.toContain('Laundry room');
  });

  test('305/302: archive blocks on open requests, then restores; legacy lists hide archived', async () => {
    await request(app).post(`${B()}/p/${propertyA.id}/archive`).set(as(manager)).send({}).expect(409);
    await pool.query("UPDATE property_maintenance_requests SET status='completed' WHERE id=$1", [openRequestA]);
    const archived = (await request(app).post(`${B()}/p/${propertyA.id}/archive`).set(as(manager)).send({ reason: 'Sold' }).expect(200)).body;
    expect(archived.status).toBe('archived');
    expect(archived.archived_at).toBeTruthy();
    // Archived history stays readable; archived list shows it.
    const profile = (await request(app).get(`${B()}/p/${propertyA.id}`).set(as(owner)).expect(200)).body;
    expect(profile.history).toHaveLength(1);
    const archivedList = (await request(app).get(`${B()}?archived=1`).set(as(owner)).expect(200)).body;
    expect(archivedList.properties.map((p) => p.id)).toContain(propertyA.id);
    // Legacy lists exclude it by default and include it on request.
    const listed = await call(maintenanceRequestController.listProperties, {
      user: { id: owner }, params: { businessId: String(bizId) }, query: {},
    });
    expect(listed.err).toBeNull();
    expect(listed.res.payload.properties.map((p) => p.id)).not.toContain(propertyA.id);
    const listedAll = await call(maintenanceRequestController.listProperties, {
      user: { id: owner }, params: { businessId: String(bizId) }, query: { include_archived: 'true' },
    });
    expect(listedAll.res.payload.properties.map((p) => p.id)).toContain(propertyA.id);
    // Public intake hides it, and an intake naming it is rejected.
    const pub = await call(maintenanceRequestController.getPublicBusiness, {
      params: { businessId: String(bizId) },
    });
    expect(pub.err).toBeNull();
    expect(pub.res.payload.properties.map((p) => p.id)).not.toContain(propertyA.id);
    const rejected = await call(maintenanceRequestController.createRequest, {
      user: { id: tenant },
      params: { businessId: String(bizId) },
      body: {
        title: 'Leak in archived building', description: 'A long enough description of the leak.',
        issue_category: 'Plumbing', property_id: propertyA.id,
      },
    });
    expect(rejected.err).not.toBeNull();
    expect(rejected.err.statusCode).toBe(404);
    expect(rejected.err.code).toBe('property_not_found');
    // Restore puts it back in the live lists.
    await request(app).post(`${B()}/p/${propertyA.id}/restore`).set(as(manager)).send({}).expect(200);
    const relisted = await call(maintenanceRequestController.listProperties, {
      user: { id: owner }, params: { businessId: String(bizId) }, query: {},
    });
    expect(relisted.res.payload.properties.map((p) => p.id)).toContain(propertyA.id);
  });

  test('302: DELETE refuses with live requests and succeeds once clear', async () => {
    propertyC = (await request(app).post(B()).set(as(manager)).send({ label: 'Birch Place', property_type: 'condo' }).expect(201)).body;
    const unitC = (await request(app).post(`${B()}/p/${propertyC.id}/units`).set(as(manager)).send({ unit_label: '1', occupancy_status: 'vacant' }).expect(201)).body;
    const { rows: [{ id: reqC }] } = await pool.query(
      `INSERT INTO property_maintenance_requests(business_id,owner_id,requester_id,status,urgency,issue_category,title,description,property_label,property_id)
       VALUES($1,$2,$3,'reported','normal','general','Birch issue','d','Birch Place',$4) RETURNING id`,
      [bizId, owner, tenant, propertyC.id]
    );
    // Staff cannot delete at the route layer.
    await request(app).delete(`${B()}/p/${propertyC.id}`).set(as(staff)).expect(403);
    // Manager delete refuses while the request is live.
    const blocked = await request(app).delete(`${B()}/p/${propertyC.id}`).set(as(manager)).expect(409);
    expect(blocked.body.code).toBe('property_has_live_requests');
    await pool.query("UPDATE property_maintenance_requests SET status='completed' WHERE id=$1", [reqC]);
    const done = await request(app).delete(`${B()}/p/${propertyC.id}`).set(as(manager)).expect(200);
    expect(done.body.deleted).toBe(true);
    await request(app).get(`${B()}/p/${propertyC.id}`).set(as(owner)).expect(404);
    // The unit survives with its link nulled.
    const { rows: [u] } = await pool.query('SELECT property_id FROM property_portfolio_units WHERE id=$1', [unitC.id]);
    expect(u.property_id).toBeNull();
  });

  test('306-310: assignment model verifies — assign, coverage expiry, review, revoke', async () => {
    // Coverage without an end date is refused.
    await request(app).post(`${B()}/p/${propertyB.id}/assignments`).set(as(manager)).send({ role: 'coverage', user_id: staff }).expect(400);
    const assignment = (await request(app).post(`${B()}/p/${propertyB.id}/assignments`).set(as(manager)).send({ role: 'building_staff', user_id: staff }).expect(201)).body;
    expect(sent('property_assigned')).toContain(staff);
    // Assigned staff now sees the property; access review flags it.
    expect((await request(app).get(`${B()}/mine`).set(as(staff)).expect(200)).body.properties.map((p) => p.id)).toContain(propertyB.id);
    const review = (await request(app).get(`${B()}/access-review`).set(as(manager)).expect(200)).body;
    expect(review.assignments.map((a) => a.id)).toContain(assignment.id);
    // Assigning the same person twice is refused.
    await request(app).post(`${B()}/p/${propertyB.id}/assignments`).set(as(manager)).send({ role: 'building_staff', user_id: staff }).expect(409);
    // Revoke ends the assignment immediately; the staff view empties.
    const revoked = (await request(app).post(`${B()}/p/${propertyB.id}/revoke`).set(as(manager)).send({ user_id: staff }).expect(200)).body;
    expect(revoked.ended).toBe(1);
    expect((await request(app).get(`${B()}/mine`).set(as(staff)).expect(200)).body.properties).toEqual([]);
  });

  test('306: assigning to an archived property is refused', async () => {
    await request(app).post(`${B()}/p/${propertyB.id}/archive`).set(as(manager)).send({}).expect(200);
    await request(app).post(`${B()}/p/${propertyB.id}/assignments`).set(as(manager)).send({ role: 'building_staff', user_id: staff }).expect(409);
    await request(app).post(`${B()}/p/${propertyB.id}/restore`).set(as(manager)).send({}).expect(200);
  });

  test('309: console addUnit refuses a malformed contact email', async () => {
    await request(app).post(`${B()}/p/${propertyB.id}/units`).set(as(manager)).send({ unit_label: '8H', contact_email: 'not-an-email' }).expect(400);
  });
});
