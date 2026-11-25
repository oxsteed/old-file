'use strict';
// Groups 5-6 items 201, 203-205, 207, 210: launch readiness, listing claims,
// regional offering rules and service pause. Disposable loopback DB only.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/(credit_statement_test|pa_g\d+|g56)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => ({ authenticate: (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); } }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const describeDb = raw ? describe : describe.skip;
const owner = crypto.randomUUID(), manager = crypto.randomUUID(), employee = crypto.randomUUID(), stranger = crypto.randomUUID(), admin = crypto.randomUUID();
let app, bizId, otherBiz, serviceId, prospectId, unlicensedId;
const as = (u) => ({ 'x-user': u });

describeDb('Groups 5-6: launch readiness, listing claims, offerings', () => {
  beforeAll(async () => {
    for (const id of [owner, manager, employee, stranger, admin]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone,state,zip_code)
        VALUES($1,$2,'x','G56','Fixture','customer',TRUE,TRUE,'3055550100','FL','33139')`, [id, `g56-${id}@acme-tile.example`]);
    }
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active) VALUES($1,'Acme Tile','service',TRUE) RETURNING id", [owner]));
    ({ rows: [{ id: otherBiz }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active) VALUES($1,'Other','service',TRUE) RETURNING id", [stranger]));
    for (const [id, role] of [[manager, 'manager'], [employee, 'employee']]) {
      await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,$5,'active')", [bizId, owner, id, `g56-${id}@x.invalid`, role]);
    }
    ({ rows: [{ id: serviceId }] } = await pool.query("INSERT INTO business_services(business_id,name,description,base_price_cents,duration_minutes,is_active,allow_online_booking) VALUES($1,'Grout repair','Regrout and seal one bathroom floor',15000,90,TRUE,FALSE) RETURNING id", [bizId]));
    ({ rows: [{ id: prospectId }] } = await pool.query(`INSERT INTO prospect_businesses(source,source_record_id,business_name,country,license_ref,provenance,permitted_uses,contact_email)
      VALUES('test',$1,'Acme Tile LLC','US','lic','{}',ARRAY['marketing_outreach'],'info@acme-tile.example') RETURNING id`, [crypto.randomUUID()]));
    ({ rows: [{ id: unlicensedId }] } = await pool.query(`INSERT INTO prospect_businesses(source,source_record_id,business_name,country,license_ref,provenance,permitted_uses)
      VALUES('test',$1,'Acme Tile Maps Only','US','lic','{}',ARRAY['supply_maps']) RETURNING id`, [crypto.randomUUID()]));
    const { router, claimRouter } = require('../routes/businessOwnerConsole');
    app = express(); app.use(express.json());
    app.use('/api/businesses', router); app.use('/api/business-listing-claims', claimRouter);
    app.post('/admin/claims/:id', async (req, res, next) => { try { res.json(await require('../services/businessOwner/listingClaimService').decide(req.get('x-user'), req.params.id, req.body)); } catch (e) { next(e); } });
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code, error: err.message })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => {
    await pool.query('DELETE FROM prospect_businesses WHERE id = ANY($1::bigint[])', [[prospectId, unlicensedId]]);
    await pool.query('DELETE FROM businesses WHERE id = ANY($1::int[])', [[bizId, otherBiz]]);
    await pool.end();
  });

  test('203-205: readiness is computed server-side, manager+ only, and names blockers', async () => {
    const res = await request(app).get(`/api/businesses/${bizId}/owner/launch-readiness`).set(as(owner));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
    expect(res.body.blockers).toEqual(expect.arrayContaining(['verification.description', 'verification.payouts']));
    expect(res.body.services[0]).toMatchObject({ id: serviceId, ready: true });
    expect((await request(app).get(`/api/businesses/${bizId}/owner/launch-readiness`).set(as(manager))).status).toBe(200);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/launch-readiness`).set(as(employee))).status).toBe(403);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/launch-readiness`).set(as(stranger))).status).toBe(404);
    await pool.query(`UPDATE businesses SET description=repeat('Tile and grout repair for homes. ',3), phone='3055550100', address_city='Miami', address_state='FL',
      service_city='Miami', service_state='FL', business_hours_json='{"mon":["09:00","17:00"]}', stripe_charges_enabled=TRUE, stripe_payouts_enabled=TRUE WHERE id=$1`, [bizId]);
    expect((await request(app).get(`/api/businesses/${bizId}/owner/launch-readiness`).set(as(owner))).body.status).toBe('ready_to_publish');
  });

  test('201: claim needs ownership of the business, a licensed listing, and an admin who is not the claimant', async () => {
    const search = await request(app).get('/api/business-listing-claims/listings?q=Acme%20Tile').set(as(owner));
    expect(search.body.listings.map(l => l.id).map(String)).toEqual([String(prospectId)]);
    expect(search.body.listings[0].contact_email).toBeUndefined();
    const body = { requestId: crypto.randomUUID(), listing_id: prospectId, business_id: bizId, relationship: 'owner', evidence: 'I am the registered owner on the state filing.' };
    expect((await request(app).post('/api/business-listing-claims').set(as(manager)).send({ ...body, requestId: crypto.randomUUID() })).status).toBe(404);
    expect((await request(app).post('/api/business-listing-claims').set(as(owner)).send({ ...body, requestId: crypto.randomUUID(), listing_id: unlicensedId })).status).toBe(404);
    const first = await request(app).post('/api/business-listing-claims').set(as(owner)).send(body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'pending', contact_match: true });
    expect((await request(app).post('/api/business-listing-claims').set(as(owner)).send(body)).body.id).toBe(first.body.id);
    expect((await request(app).post('/api/business-listing-claims').set(as(owner)).send({ ...body, requestId: crypto.randomUUID() })).body.code).toBe('claim_already_pending');
    expect((await request(app).post(`/admin/claims/${first.body.id}`).set(as(owner)).send({ decision: 'approve' })).status).toBe(403);
    const ok = await request(app).post(`/admin/claims/${first.body.id}`).set(as(admin)).send({ decision: 'approve' });
    expect(ok.body.status).toBe('approved');
    const { rows: [p] } = await pool.query('SELECT matched_business_id FROM prospect_businesses WHERE id=$1', [prospectId]);
    expect(p.matched_business_id).toBe(bizId);
    expect((await request(app).post('/api/business-listing-claims').set(as(owner)).send({ ...body, requestId: crypto.randomUUID() })).body.code).toBe('listing_already_claimed');
    expect((await request(app).get('/api/business-listing-claims/mine').set(as(owner))).body.claims[0].status).toBe('approved');
  });

  test('207, 210: regions and pause are versioned, audited, and enforced on customer bookings', async () => {
    const { assertBookable } = require('../services/businessOwner/launchService');
    let offer = (await request(app).get(`/api/businesses/${bizId}/owner/offerings`).set(as(manager))).body.services[0];
    expect((await request(app).put(`/api/businesses/${bizId}/owner/services/${serviceId}/regions`).set(as(employee)).send({ region_mode: 'only', region_states: ['FL'], expectedVersion: 0 })).status).toBe(403);
    expect((await request(app).put(`/api/businesses/${bizId}/owner/services/${serviceId}/regions`).set(as(manager)).send({ region_mode: 'only', region_states: [], expectedVersion: offer.offering_version })).status).toBe(400);
    const set = await request(app).put(`/api/businesses/${bizId}/owner/services/${serviceId}/regions`).set(as(manager)).send({ region_mode: 'only', region_states: ['fl'], region_postal_prefixes: ['300'], expectedVersion: offer.offering_version });
    expect(set.body).toMatchObject({ region_mode: 'only', region_states: ['FL'], region_postal_prefixes: ['300'] });
    expect((await request(app).put(`/api/businesses/${bizId}/owner/services/${serviceId}/regions`).set(as(manager)).send({ region_mode: 'everywhere', expectedVersion: offer.offering_version })).body.code).toBe('offering_changed');
    const { rows: [svc] } = await pool.query('SELECT * FROM business_services WHERE id=$1', [serviceId]);
    expect(() => assertBookable(svc, { state: 'FL' })).not.toThrow();
    expect(() => assertBookable(svc, { state: 'GA', postal_code: '30012' })).not.toThrow();
    expect(() => assertBookable(svc, { state: 'NY', postal_code: '10001' })).toThrow(expect.objectContaining({ code: 'outside_service_area' }));
    expect(() => assertBookable(svc, {})).toThrow(expect.objectContaining({ code: 'service_area_required' }));
    offer = (await request(app).get(`/api/businesses/${bizId}/owner/offerings`).set(as(owner))).body.services[0];
    const until = new Date(Date.now() + 86400000).toISOString();
    const paused = await request(app).post(`/api/businesses/${bizId}/owner/services/${serviceId}/pause`).set(as(owner)).send({ reason: 'Supplier delay', paused_until: until, expectedVersion: offer.offering_version });
    expect(paused.status).toBe(200);
    const { rows: [p2] } = await pool.query('SELECT * FROM business_services WHERE id=$1', [serviceId]);
    expect(() => assertBookable(p2, { state: 'FL' })).toThrow(expect.objectContaining({ code: 'service_paused' }));
    expect(() => assertBookable({ ...p2, paused_until: new Date(Date.now() - 1000).toISOString() }, { state: 'FL' })).not.toThrow();
    const ready = (await request(app).get(`/api/businesses/${bizId}/owner/launch-readiness`).set(as(owner))).body.services[0];
    expect(ready).toMatchObject({ paused: true, ready: false });
    await request(app).post(`/api/businesses/${bizId}/owner/services/${serviceId}/resume`).set(as(owner)).send({ expectedVersion: paused.body.offering_version }).expect(200);
    const hist = (await request(app).get(`/api/businesses/${bizId}/owner/offerings`).set(as(owner))).body.history.map(h => h.event);
    expect(hist).toEqual(['resumed', 'paused', 'regions_changed']);
    expect((await request(app).get(`/api/businesses/${otherBiz}/owner/offerings`).set(as(owner))).status).toBe(404);
  });
});
