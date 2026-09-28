#!/usr/bin/env node
'use strict';

// Standalone real-PostgreSQL integration harness. Never loads db.js, .env,
// server/index.js, or a caller-supplied database URL. No production connections.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');

const root = path.resolve(__dirname, '..');
const runId = `delivery-verify-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
const image = 'postgis/postgis:16-3.4-alpine';
const results = [];
const effects = { sockets: [], notifications: [], sessions: new Map(), checkoutCreates: 0 };
let notificationFailure = false;
let containerId;
let pool;
let server;
let api;
let sequence = 0;
let windowSequence = 0;
let fixtureStripe;
const users = Object.fromEntries([
  ['customer', 'user', 'customer', null],
  ['other', 'user', 'customer', null],
  ['helper', 'helper', 'helper', null],
  ['helper2', 'helper', 'helper', null],
  ['driver', 'user', 'internal_driver', 'internal_driver'],
  ['driver2', 'user', 'internal_driver', 'internal_driver'],
  ['admin', 'admin', 'customer', 'admin'],
  ['unapproved', 'helper', 'helper', null],
].map(([name, role, default_mode, logistics_role], i) => [name, {
  id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  role, default_mode, logistics_role, email: `${name}@delivery.example.test`, first_name: name, last_name: 'Fixture',
}]));

function docker(args) {
  return execFileSync('docker', ['--context', 'colima', ...args], {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function check(name, action) {
  try {
    await action();
    results.push({ name, pass: true });
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    results.push({ name, pass: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    return false;
  }
}

function inject(relative, exports) {
  const filename = require.resolve(relative.startsWith('.') ? path.resolve(root, relative) : relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

async function startDatabase() {
  assert.equal(process.argv.length, 2, 'No arguments or database URLs are accepted');
  // Unset ambient configuration before loading any application modules.
  for (const name of Object.keys(process.env)) {
    if (/^(PG|DATABASE_|REDIS_|STRIPE_|AWS_)/.test(name)) delete process.env[name];
  }
  process.env.NODE_ENV = 'test';
  process.env.APP_URL = 'http://127.0.0.1';
  process.env.CLIENT_URL = 'http://127.0.0.1';
  // No database password or provider credential is created or read. Trust auth
  // exists only inside this disposable instance, published only on loopback.
  containerId = docker(['run', '--rm', '--detach', '--name', runId,
    '--label', `oxsteed.delivery-verification=${runId}`,
    '--memory', '384m', '--cpus', '1',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
    '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '--env', 'POSTGRES_USER=delivery_test',
    '--env', 'POSTGRES_DB=delivery_isolated', image]);
  assert.match(containerId, /^[a-f0-9]{64}$/);
  const binding = docker(['port', containerId, '5432/tcp']);
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const port = Number(binding.split(':')[1]);
  pool = new Pool({ host: '127.0.0.1', port, user: 'delivery_test', password: '',
    database: 'delivery_isolated', ssl: false, max: 12,
    connectionTimeoutMillis: 1500, idleTimeoutMillis: 1000,
    options: '-c statement_timeout=10000 -c lock_timeout=7000',
  });
  pool.on('error', (error) => console.error(`Isolated PostgreSQL connection error: ${error.code}`));
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { await pool.query('SELECT 1'); ready = true; break; } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  assert(ready, 'Disposable PostgreSQL did not become ready');
  const identity = (await pool.query('SELECT current_database() AS db, current_user AS username')).rows[0];
  assert.deepEqual(identity, { db: 'delivery_isolated', username: 'delivery_test' });
  console.log(`Isolated PostgreSQL: ${binding}; container ${runId}; tmpfs only`);
  await pool.query(`
    CREATE TABLE users (
      id UUID PRIMARY KEY, email TEXT, first_name TEXT, last_name TEXT,
      role TEXT, default_mode TEXT, logistics_role TEXT
    );
    CREATE TABLE support_tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE jobs (id UUID PRIMARY KEY);
    CREATE TABLE logistics_internal_access_credentials (
      user_id UUID PRIMARY KEY REFERENCES users(id), operations_enabled BOOLEAN,
      compliance_enabled BOOLEAN, admin_portal_enabled BOOLEAN, is_active BOOLEAN
    );
  `);
  // Extract the actual prerequisite table definition instead of inventing a
  // permissive ledger. No unrelated initial-schema SQL is executed.
  const initial = fs.readFileSync(path.join(root, 'migrations/001_initial_schema.sql'), 'utf8');
  const ledger = initial.match(/CREATE TABLE platform_ledger \([\s\S]*?\n\);/);
  assert(ledger, 'Initial migration platform ledger definition missing');
  await pool.query(ledger[0]);
  for (const user of Object.values(users)) {
    await pool.query('INSERT INTO users (id,email,first_name,last_name,role,default_mode,logistics_role) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [user.id, user.email, user.first_name, user.last_name, user.role, user.default_mode, user.logistics_role]);
  }
}

async function migrate(number) {
  const names = fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.startsWith(`${number}_`));
  assert.equal(names.length, 1, `Expected exactly one actual migration ${number}, found ${names.length}`);
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(root, 'migrations', names[0]), 'utf8'));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

function makeInput(overrides = {}) {
  const tomorrow = Date.now() + (48 + 6 * windowSequence++) * 60 * 60 * 1000;
  const date = (hours) => new Date(tomorrow + hours * 60 * 60 * 1000).toISOString();
  return {
    origin: { address: '101 Synthetic Pickup St', city: 'Miami', state: 'FL', country: 'US', lat: 25.7617, lng: -80.1918 },
    destination: { address: '202 Synthetic Dropoff St', city: 'Miami', state: 'FL', country: 'US', lat: 25.7817, lng: -80.1718 },
    originContact: { name: 'Synthetic Sender', phone: '+13055550101', instructions: 'PRIVATE PICKUP GATE 9182' },
    destinationContact: { name: 'Synthetic Recipient', phone: '+13055550102', instructions: 'PRIVATE DROPOFF GATE 7364' },
    packageType: 'small', serviceLevel: 'standard', weightLbs: 5, pieces: 1,
    dimensions: { lengthIn: 10, widthIn: 8, heightIn: 6 },
    declaredValueCents: 1500, contentsCategory: 'general',
    pickupWindow: { start: date(0), end: date(1) },
    deliveryWindow: { start: date(2), end: date(3) },
    proofPreference: 'recipient_confirmation', ...overrides,
  };
}

async function startApi() {
  inject('./db', pool);
  inject('./utils/logger', Object.fromEntries(['info', 'warn', 'error', 'debug'].map((name) => [name, () => {}])));
  inject('./services/geoRouteProviderService', {
    calculateRoute: async () => ({ provider: 'isolated-fixture', distanceMeters: 8046.72, durationSeconds: 900, fallback: false }),
  });
  inject('./services/socketService', {
    broadcastToUser: (...args) => { effects.sockets.push(args); return true; },
  });
  inject('./services/notificationService', {
    sendNotification: async (data) => {
      if (notificationFailure) throw new Error('Synthetic transport failure: private payload must never persist');
      effects.notifications.push(data); return { success: true, id: crypto.randomUUID() };
    },
  });
  inject('./services/runtimeState', { snapshot: () => ({ realtimeReady: true }) });
  inject('./middleware/rateLimiter', { authenticatedLimiter: (req, res, next) => next() });
  inject('./services/fileScanService', { isConfigured: () => true, scanBuffer: async () => ({ clean: true, provider: 'isolated-fixture' }) });
  inject('./utils/storage', {
    uploadFile: async (buffer, prefix) => `${prefix}/${crypto.randomUUID()}.png`,
    getSignedDownloadUrl: async (key) => `https://private.example.test/${key}?fixture=true`,
  });
  inject('./services/supportTicketLinkService', {
    createLinkedSupportTicket: async (client) => (await client.query('INSERT INTO support_tickets DEFAULT VALUES RETURNING id')).rows[0],
  });
  const stripe = { checkout: { sessions: {
    create: async (data, options) => {
      effects.checkoutCreates += 1;
      const id = `cs_test_delivery_${effects.checkoutCreates}`;
      const session = { id, url: `https://checkout.example.test/${id}`, status: 'open', payment_status: 'unpaid',
        mode: data.mode, client_reference_id: data.client_reference_id,
        amount_total: data.line_items[0].price_data.unit_amount, currency: data.line_items[0].price_data.currency,
        metadata: data.metadata, payment_intent: null, fixtureKey: options?.idempotencyKey };
      effects.sessions.set(id, session);
      return { ...session };
    },
    retrieve: async (id) => { assert(effects.sessions.has(id), 'Unknown fixture checkout'); return { ...effects.sessions.get(id) }; },
    expire: async (id) => { const session = effects.sessions.get(id); session.status = 'expired'; return { ...session }; },
  } } };
  inject('stripe', () => stripe);
  fixtureStripe = stripe;
  // Synthetic marker for application's configuration check; fixture above never
  // calls Stripe or reads any provider credential.
  process.env.STRIPE_SECRET_KEY = 'sk_test_isolated_fixture_not_a_credential';
  process.env.FEATURE_PAYMENTS_ENABLED = 'true';
  inject('./middleware/auth', { requireAuth: (req, res, next) => {
    req.user = users[req.get('X-Delivery-Test-User')];
    if (!req.user) return res.status(401).json({ code: 'unauthorized' });
    next();
  } });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/delivery', require('../routes/localDelivery'));
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(error.statusCode || error.status || 500).json({ code: error.code, error: error.message });
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  api = require('supertest')(`http://127.0.0.1:${server.address().port}`);
}

function call(method, route, user = 'customer', body, key = `fixture-${++sequence}`) {
  let request = api[method](`/api/delivery${route}`).set('X-Delivery-Test-User', user);
  if (key) request = request.set('Idempotency-Key', key);
  if (body !== undefined) request = request.send(body);
  return request;
}

function status(response, expected) {
  assert.equal(response.status, expected, `${response.request.method} ${response.request.url.split('/api/delivery')[1]}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

async function quote(input = makeInput(), user = 'customer') {
  return status(await call('post', '/quote', user, input), 200).quote;
}

async function create(input = makeInput(), user = 'customer') {
  const quoted = await quote(input, user);
  return status(await call('post', '/jobs', user, { ...input, quoteId: quoted.id }), 201);
}

async function jobRow(id) {
  return (await pool.query('SELECT * FROM delivery_jobs WHERE id=$1', [id])).rows[0];
}

async function count(table, jobId) {
  assert.match(table, /^delivery_[a-z_]+$/);
  return Number((await pool.query(`SELECT COUNT(*) AS count FROM ${table} WHERE delivery_job_id=$1`, [jobId])).rows[0].count);
}

async function marketplace(input = makeInput()) {
  const created = await create(input);
  status(await call('post', `/internal/jobs/${created.job.id}/release-marketplace`, 'admin', { reason: 'Synthetic capacity unavailable' }), 200);
  return created;
}

async function inTransit(input = makeInput()) {
  const created = await assigned(input);
  status(await call('patch', `/jobs/${created.job.id}/status`, 'helper', { status: 'picked_up' }), 200);
  status(await call('patch', `/jobs/${created.job.id}/status`, 'helper', { status: 'in_transit' }), 200);
  return created;
}

async function assigned(input = makeInput()) {
  const created = await marketplace(input);
  status(await call('post', `/jobs/${created.job.id}/claim`, 'helper', {}), 200);
  return created;
}

async function seedCapacity() {
  for (const name of ['helper', 'helper2', 'driver', 'driver2']) {
    await pool.query(`INSERT INTO delivery_driver_profiles
      (user_id,approved,active,vehicle_type,max_payload_lbs,cargo_length_in,cargo_width_in,cargo_height_in,equipment,service_area,insurance_acknowledged)
      VALUES ($1,TRUE,TRUE,'van',1000,100,100,100,$2,$3,TRUE)`, [users[name].id,
      JSON.stringify({ dolly: true, liftgate: true, loadingHelp: true, temperatureControl: true }),
      JSON.stringify({ states: ['FL'], cities: ['Miami'], center: { lat: 25.76, lng: -80.19 }, radiusMiles: 100 }),
    ]);
  }
}

async function journeys() {
  await check('authentication and internal workspace authorization', async () => {
    status(await call('get', '/jobs', 'nobody'), 401);
    status(await call('get', '/internal/queue', 'customer'), 403);
    status(await call('get', '/internal/queue', 'helper'), 403);
    status(await call('get', '/internal/queue', 'admin'), 200);
  });
  await check('strict domestic intake and required idempotency key', async () => {
    for (const input of [makeInput({ pieces: 0 }), makeInput({ weightLbs: -1 }), makeInput({ dimensions: {} }),
      makeInput({ origin: { ...makeInput().origin, country: 'CA' } }), makeInput({ pickupWindow: {} }), makeInput({ hazmat: true })]) {
      status(await call('post', '/quote', 'customer', input), 400);
    }
    status(await call('post', '/jobs', 'customer', makeInput(), null), 400);
  });
  await check('quote ownership, expiry, changed details and no partial job write', async () => {
    const input = makeInput();
    const q = await quote(input);
    const altered = await call('post', '/jobs', 'customer', { ...input, quoteId: q.id, pieces: 2 });
    status(altered, 409);
    const stolen = await call('post', '/jobs', 'other', { ...input, quoteId: q.id });
    assert([404, 409].includes(stolen.status), `Unexpected stolen quote response ${stolen.status}`);
    const expired = (await pool.query(`INSERT INTO delivery_quotes
      (customer_user_id,request_hash,input_snapshot,price_snapshot,customer_total_cents,driver_payout_cents,currency,pricing_version,expires_at)
      SELECT customer_user_id,request_hash,input_snapshot,price_snapshot,customer_total_cents,driver_payout_cents,currency,pricing_version,NOW()-INTERVAL '1 minute'
      FROM delivery_quotes WHERE id=$1 RETURNING id`, [q.id])).rows[0];
    status(await call('post', '/jobs', 'customer', { ...input, quoteId: expired.id }), 409);
    assert.equal((await pool.query('SELECT delivery_job_id FROM delivery_quotes WHERE id=$1', [q.id])).rows[0].delivery_job_id, null);
  });
  await check('concurrent create same key yields one job, quote and event', async () => {
    const input = makeInput(); const q = await quote(input); const key = `create-race-${++sequence}`;
    const responses = await Promise.all(Array.from({ length: 6 }, () => call('post', '/jobs', 'customer', { ...input, quoteId: q.id }, key)));
    assert.equal(responses.filter((r) => r.status === 201).length, 1);
    assert(responses.every((r) => [200, 201].includes(r.status)), JSON.stringify(responses.map((r) => r.body)));
    const ids = new Set(responses.map((r) => r.body.job.id)); assert.equal(ids.size, 1);
    assert.equal(await count('delivery_events', [...ids][0]), 1);
    status(await call('post', '/jobs', 'customer', { ...input, quoteId: q.id, pieces: 2 }, key), 409);
  });
  await check('accepted quote cannot create a second job using a different key', async () => {
    const input = makeInput(); const q = await quote(input); const body = { ...input, quoteId: q.id };
    status(await call('post', '/jobs', 'customer', body), 201);
    const replay = await call('post', '/jobs', 'customer', body);
    assert([200, 409].includes(replay.status), `Accepted quote reuse returned ${replay.status}`);
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM delivery_jobs WHERE quote_id=$1', [q.id])).rows[0].count), 1);
  });
  await check('customer response privacy on create, replay, list and detail', async () => {
    const input = makeInput({ proofPreference: 'pin' }); const q = await quote(input); const key = `privacy-${++sequence}`;
    const created = status(await call('post', '/jobs', 'customer', { ...input, quoteId: q.id }, key), 201);
    const duplicate = status(await call('post', '/jobs', 'customer', { ...input, quoteId: q.id }, key), 200);
    const detail = status(await call('get', `/jobs/${created.job.id}`), 200);
    const list = status(await call('get', '/jobs'), 200);
    for (const body of [created, duplicate, detail, list]) {
      const serialized = JSON.stringify(body);
      for (const forbidden of ['proof_pin_digest', 'driver_payout_cents', 'driverPayout', 'internal_driver_user_id', 'marketplace_release_reason', 'fulfillment_source', 'dispatch_state']) {
        assert(!serialized.includes(`"${forbidden}"`), `Customer response exposes ${forbidden}`);
      }
    }
    status(await call('get', `/jobs/${created.job.id}`, 'other'), 404);
    assert.match(String(created.proofPin || created.job.proofPin || ''), /^\d{6}$/, 'Customer must receive completion PIN');
  });
  await check('internal review hidden from marketplace; unapproved helper cannot claim', async () => {
    const created = await create();
    const list = status(await call('get', '/jobs', 'helper'), 200);
    assert(!list.jobs.some((job) => job.id === created.job.id));
    const unpublished = await call('post', `/jobs/${created.job.id}/claim`, 'helper', {});
    assert([404, 409].includes(unpublished.status));
    status(await call('post', `/internal/jobs/${created.job.id}/release-marketplace`, 'admin', { reason: 'Synthetic fallback' }), 200);
    const denied = await call('post', `/jobs/${created.job.id}/claim`, 'unapproved', {});
    assert([403, 409].includes(denied.status), `Unapproved helper claim returned ${denied.status}`);
    assert.equal((await jobRow(created.job.id)).helper_user_id, null);
  });
  await check('concurrent marketplace claims have exactly one winner', async () => {
    const created = await marketplace();
    const responses = await Promise.all(['helper', 'helper2'].map((name) => call('post', `/jobs/${created.job.id}/claim`, name, {})));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await count('delivery_dispatch_attempts', created.job.id), 2);
    const winner = responses[0].status === 200 ? 'helper' : 'helper2';
    const serialized = JSON.stringify(status(await call('get', `/jobs/${created.job.id}`, winner), 200));
    assert(!serialized.includes('proof_pin_digest'));
  });
  await check('PIN proof mismatch rollback; correct proof once; changed replay conflict', async () => {
    const created = await inTransit(makeInput({ proofPreference: 'pin' }));
    const id = created.job.id; const pin = created.proofPin || created.job.proofPin;
    const wrong = pin === '000000' ? '111111' : '000000';
    status(await call('patch', `/jobs/${id}/status`, 'helper', { status: 'delivered', proofType: 'pin', proofValue: wrong }), 400);
    assert.equal((await jobRow(id)).status, 'in_transit'); assert.equal(await count('delivery_proofs', id), 0);
    const key = `proof-${++sequence}`; const body = { status: 'delivered', proofType: 'pin', proofValue: pin };
    status(await call('patch', `/jobs/${id}/status`, 'helper', body, key), 200);
    status(await call('patch', `/jobs/${id}/status`, 'helper', body, key), 200);
    status(await call('patch', `/jobs/${id}/status`, 'helper', { ...body, proofValue: wrong }, key), 409);
    assert.equal(await count('delivery_proofs', id), 1);
    const proof = (await pool.query('SELECT * FROM delivery_proofs WHERE delivery_job_id=$1', [id])).rows[0];
    assert.notEqual(proof.proof_value, pin, 'Raw PIN persisted in proof');
    assert.equal((await jobRow(id)).status, 'delivered');
  });
  await check('recipient proof requires name and confirmation; terminal state immutable', async () => {
    const created = await inTransit(); const id = created.job.id;
    status(await call('patch', `/jobs/${id}/status`, 'customer', { status: 'delivered', recipientName: 'Recipient', proofValue: 'Received' }), 403);
    status(await call('patch', `/jobs/${id}/status`, 'helper', { status: 'delivered' }), 400);
    status(await call('patch', `/jobs/${id}/status`, 'helper', { status: 'delivered', proofType: 'recipient_confirmation', recipientName: 'Fixture Recipient', recipientContact: '+13055550102', confirmed: true }), 200);
    status(await call('patch', `/jobs/${id}/status`, 'helper', { status: 'picked_up' }), 409);
    assert.equal(await count('delivery_proofs', id), 1);
  });
  await check('photo proof rejects foreign or fabricated upload', async () => {
    const created = await inTransit(makeInput({ proofPreference: 'photo' }));
    for (const objectKey of [`user-uploads/${users.other.id}/fake.jpg`, `user-uploads/${users.helper.id}/never-uploaded.jpg`]) {
      const response = await call('patch', `/jobs/${created.job.id}/status`, 'helper', { status: 'delivered', proofType: 'photo', objectKey, mediaUrl: 'https://untrusted.example.test/fake.jpg' });
      assert([400, 404].includes(response.status), `Unverified upload accepted: ${response.status}`);
    }
    assert.equal(await count('delivery_proofs', created.job.id), 0);
  });
  await check('concurrent assignments cannot double-book a driver or vehicle', async () => {
    const input = makeInput(); const a = await create(input); const b = await create(input);
    const vehicle = status(await call('post', '/internal/vehicles', 'admin', { label: 'Synthetic van', vehicleType: 'van', maxPayloadLbs: 1000, cargoLengthIn: 100, cargoWidthIn: 100, cargoHeightIn: 100, insuranceAcknowledged: true, serviceArea: { states: ['FL'] }, maxPieces: 10 }), 201).vehicle;
    const body = { driverUserId: users.driver.id, vehicleId: vehicle.id };
    const responses = await Promise.all([a, b].map((c) => call('post', `/internal/jobs/${c.job.id}/assign`, 'admin', body)));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const reservations = await pool.query("SELECT * FROM delivery_assignment_reservations WHERE status='active' AND driver_user_id=$1", [users.driver.id]);
    assert.equal(reservations.rows.length, 1);
    const winner = reservations.rows[0].delivery_job_id;
    status(await call('patch', `/jobs/${winner}/status`, 'customer', { status: 'cancelled', reason: 'Synthetic cancellation' }), 200);
    assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM delivery_assignment_reservations WHERE status='active' AND delivery_job_id=$1", [winner])).rows[0].count), 0);
  });
  await check('reschedule request reviewed using request status and applied windows', async () => {
    const created = await create(); const input = makeInput();
    const request = status(await call('post', `/jobs/${created.job.id}/reschedule-requests`, 'customer', { pickupWindow: input.pickupWindow, deliveryWindow: input.deliveryWindow, reason: 'Synthetic change' }), 201).request;
    status(await call('patch', `/internal/reschedule-requests/${request.id}`, 'admin', { decision: 'approved' }), 200);
    assert.equal((await pool.query('SELECT status FROM delivery_reschedule_requests WHERE id=$1', [request.id])).rows[0].status, 'approved');
  });
  await check('return requested, approved, completed and delivered job remains terminal', async () => {
    const created = await inTransit();
    const requested = status(await call('post', `/jobs/${created.job.id}/return-requests`, 'customer', { reason: 'Recipient unavailable' }), 201).returnRequest;
    status(await call('patch', `/internal/returns/${requested.id}`, 'admin', { decision: 'approved' }), 200);
    status(await call('patch', `/internal/returns/${requested.id}`, 'admin', { decision: 'completed' }), 200);
    assert.equal((await jobRow(created.job.id)).status, 'returned');
  });
  await paymentJourneys();
  await workerJourneys();
}

async function approvedExtra(jobId, key = `extra-${++sequence}`) {
  const extra = status(await call('post', `/jobs/${jobId}/extras`, 'helper', { category: 'waiting', amountCents: 500, notes: 'Synthetic 15 minute wait' }, key), 201).extra;
  status(await call('patch', `/extras/${extra.id}`, 'customer', { decision: 'approved' }), 200);
  return extra;
}

async function paymentJourneys() {
  await check('extras approval, checkout replay, payment ownership and captured once', async () => {
    const created = await assigned(); const extra = await approvedExtra(created.job.id); const key = `pay-${++sequence}`;
    const before = effects.checkoutCreates;
    const started = status(await call('post', `/extras/${extra.id}/checkout`, 'customer', {}, key), 201);
    status(await call('post', `/extras/${extra.id}/checkout`, 'customer', {}, key), 200);
    assert.equal(effects.checkoutCreates - before, 1);
    const denied = await call('post', `/payments/${started.payment.id}/sync`, 'other', {});
    assert([403, 404].includes(denied.status));
    const session = await settleFixture(started.payment.id);
    status(await call('post', `/payments/${started.payment.id}/sync`, 'customer', {}), 200);
    status(await call('post', `/payments/${started.payment.id}/sync`, 'customer', {}), 200);
    assert.equal((await pool.query('SELECT payment_status FROM delivery_extras WHERE id=$1', [extra.id])).rows[0].payment_status, 'captured');
    const ledgers = await pool.query("SELECT * FROM platform_ledger WHERE metadata->>'deliveryPaymentId'=$1", [String(started.payment.id)]);
    assert.equal(ledgers.rows.length, 1, 'Exactly one capture ledger entry required');
    assert.equal(ledgers.rows[0].amount_cents, session.amount_total);
  });
  await check('checkout key cannot reuse another extra payment', async () => {
    const created = await assigned(); const a = await approvedExtra(created.job.id); const b = await approvedExtra(created.job.id); const key = `cross-extra-${++sequence}`;
    status(await call('post', `/extras/${a.id}/checkout`, 'customer', {}, key), 201);
    status(await call('post', `/extras/${b.id}/checkout`, 'customer', {}, key), 409);
  });
  await check('provider amount mismatch cannot capture an approved extra', async () => {
    const created = await assigned(); const extra = await approvedExtra(created.job.id);
    const started = status(await call('post', `/extras/${extra.id}/checkout`, 'customer', {}), 201);
    const session = await settleFixture(started.payment.id);
    session.amount_total = 1;
    const response = await call('post', `/payments/${started.payment.id}/sync`, 'customer', {});
    assert([400, 409, 422].includes(response.status), `Mismatched payment accepted: ${response.status}`);
    assert.notEqual((await pool.query('SELECT payment_status FROM delivery_extras WHERE id=$1', [extra.id])).rows[0].payment_status, 'captured');
  });
}

async function settleFixture(paymentId) {
  const payment = (await pool.query('SELECT * FROM delivery_payments WHERE id=$1', [paymentId])).rows[0];
  const session = effects.sessions.get(payment.checkout_session_id);
  assert(session, 'Fixture session must exist');
  session.payment_status = 'paid'; session.status = 'complete';
  session.payment_intent = {
    id: `pi_test_delivery_${paymentId}`, status: 'succeeded', metadata: session.metadata,
    amount: session.amount_total, amount_received: session.amount_total, currency: session.currency,
    latest_charge: { id: `ch_test_delivery_${paymentId}`, payment_intent: `pi_test_delivery_${paymentId}`,
      amount: session.amount_total, currency: session.currency, paid: true, captured: true, amount_refunded: 0,
      receipt_url: `https://receipt.example.test/${paymentId}` },
  };
  return session;
}

async function workerJourneys() {
  const worker = require('../services/localDeliveryEventWorker');
  async function event(jobId, type, visible = true) {
    await pool.query("UPDATE delivery_event_deliveries SET status='delivered',delivered_at=NOW()");
    const inserted = await pool.query(`INSERT INTO delivery_events(delivery_job_id,event_type,event_version,actor_user_id,payload,customer_visible)
      VALUES($1,$2,10000,$3,$4,$5) RETURNING id`, [jobId, type, users.admin.id,
      JSON.stringify({ secretAddress: 'PRIVATE PAYLOAD', dispatch_state: 'internal_assigned' }), visible]);
    const id = inserted.rows[0].id;
    await pool.query("INSERT INTO delivery_event_deliveries(event_id,consumer) VALUES($1,'notifications'),($1,'realtime')", [id]);
    return id;
  }
  await check('outbox concurrent consumers, abandoned lease recovery and public payload privacy', async () => {
    const created = await create(); const id = await event(created.job.id, 'delivery_assigned');
    await pool.query("UPDATE delivery_event_deliveries SET status='processing',attempts=1,updated_at=NOW()-INTERVAL '2 minutes' WHERE event_id=$1", [id]);
    const n = effects.notifications.length; const s = effects.sockets.length;
    await Promise.all([worker.processDeliveryEvents(10), worker.processDeliveryEvents(10)]);
    const rows = (await pool.query('SELECT status,attempts FROM delivery_event_deliveries WHERE event_id=$1', [id])).rows;
    assert(rows.every((row) => row.status === 'delivered' && row.attempts === 2), JSON.stringify(rows));
    assert.equal(effects.notifications.length - n, 1);
    assert.equal(effects.sockets.length - s, 1);
    const serialized = JSON.stringify([effects.notifications.slice(n), effects.sockets.slice(s)]);
    assert(!serialized.includes('PRIVATE PAYLOAD')); assert(!serialized.includes('dispatch_state'));
  });
  await check('outbox private event suppressed and failed notification retried with bounded error', async () => {
    const created = await create(); await event(created.job.id, 'delivery_marketplace_released', false);
    const n = effects.notifications.length; const s = effects.sockets.length;
    await worker.processDeliveryEvents(10);
    assert.equal(effects.notifications.length, n); assert.equal(effects.sockets.length, s);
    const id = await event(created.job.id, 'delivery_picked_up');
    notificationFailure = true;
    try { await worker.processDeliveryEvents(10); } finally { notificationFailure = false; }
    const failed = (await pool.query("SELECT * FROM delivery_event_deliveries WHERE event_id=$1 AND consumer='notifications'", [id])).rows[0];
    assert.equal(failed.status, 'failed'); assert.equal(failed.last_error, 'delivery_consumer_failed');
    await pool.query("UPDATE delivery_event_deliveries SET updated_at=NOW()-INTERVAL '2 minutes' WHERE event_id=$1", [id]);
    await worker.processDeliveryEvents(10);
    assert.equal((await pool.query("SELECT status FROM delivery_event_deliveries WHERE event_id=$1 AND consumer='notifications'", [id])).rows[0].status, 'delivered');
    assert.equal(effects.notifications.length - n, 1);
  });
}

// Explicit synthetic inserts isolate service verification from controllers that
// are being integrated concurrently. These are fixtures, not alternate logic.
async function insertFixture(table, values) {
  assert.match(table, /^[a-z_]+$/);
  const columns = Object.keys(values);
  columns.forEach((column) => assert.match(column, /^[a-z_]+$/));
  return (await pool.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(values))).rows[0];
}

async function directJob(input = makeInput(), overrides = {}) {
  return insertFixture('delivery_jobs', {
    reference: `DLV-FIXTURE-${++sequence}`, customer_user_id: users.customer.id,
    origin_address: input.origin.address, origin_city: input.origin.city, origin_state: input.origin.state, origin_country: 'US',
    origin_lat: input.origin.lat, origin_lng: input.origin.lng,
    destination_address: input.destination.address, destination_city: input.destination.city, destination_state: input.destination.state, destination_country: 'US',
    destination_lat: input.destination.lat, destination_lng: input.destination.lng,
    origin_contact_name: input.originContact.name, origin_contact_phone: input.originContact.phone,
    destination_contact_name: input.destinationContact.name, destination_contact_phone: input.destinationContact.phone,
    distance_miles: 5, duration_minutes: 15, package_type: 'small', weight_lbs: 5, pieces: 1,
    package_length_in: 10, package_width_in: 8, package_height_in: 6,
    price_snapshot: JSON.stringify({ fixture: true }), customer_total_cents: 2000, driver_payout_cents: 1500,
    pickup_window_start: input.pickupWindow.start, pickup_window_end: input.pickupWindow.end,
    delivery_window_start: input.deliveryWindow.start, delivery_window_end: input.deliveryWindow.end,
    proof_preference: input.proofPreference, fulfillment_source: 'internal', dispatch_state: 'internal_review', ...overrides,
  });
}

async function directCapacity(mode = 'internal_driver', overrides = {}) {
  const user = { ...users.driver, id: crypto.randomUUID(), role: mode === 'helper' ? 'helper' : 'user', default_mode: mode, logistics_role: mode === 'helper' ? null : mode };
  await insertFixture('users', user);
  const capacity = { max_payload_lbs: 1000, cargo_length_in: 100, cargo_width_in: 100, cargo_height_in: 100,
    vehicle_type: 'van', active: true, insurance_acknowledged: true, max_pieces: 10,
    service_area: JSON.stringify({ states: ['FL'], cities: ['Miami'] }), ...overrides };
  await insertFixture('delivery_driver_profiles', { user_id: user.id, approved: true, ...capacity });
  const vehicle = await insertFixture('delivery_vehicles', { label: 'Direct fixture van', ...capacity });
  return { user, vehicle };
}

function req(user, id, body = {}, key = `direct-fixture-${++sequence}`, extraParams = {}) {
  return { user, params: { id: String(id), ...extraParams }, body, get: (name) => name.toLowerCase() === 'idempotency-key' ? key : undefined };
}

async function directServiceJourneys() {
  const dispatch = require('../services/localDeliveryDispatchService').createDispatchService({ pool }).actions;
  const recovery = require('../services/localDeliveryRecoveryService').createRecoveryService({ pool }).actions;
  const verifyRace = (outcomes) => {
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(outcomes));
    const loser = outcomes.find((r) => r.status === 'rejected').reason;
    assert.equal(loser.status, 409); return outcomes.find((r) => r.status === 'fulfilled').value.response.job;
  };
  await check('SERVICE concurrent overlapping internal assignments serialize; failed attempt is audited', async () => {
    const input = makeInput(); const a = await directJob(input); const b = await directJob(input); const capacity = await directCapacity();
    const body = { driverUserId: capacity.user.id, vehicleId: capacity.vehicle.id };
    const outcomes = await Promise.allSettled([a, b].map((job) => dispatch.assignInternal(req(users.admin, job.id, body))));
    const winner = verifyRace(outcomes);
    assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM delivery_assignment_reservations WHERE driver_user_id=$1 AND status='active'", [capacity.user.id])).rows[0].count), 1);
    const loserId = String(winner.id) === String(a.id) ? b.id : a.id;
    assert.equal((await jobRow(loserId)).status, 'posted');
    assert.equal((await pool.query("SELECT action FROM delivery_dispatch_attempts WHERE delivery_job_id=$1", [loserId])).rows[0].action, 'assignment_failed');
    await dispatch.releaseMarketplace(req(users.admin, winner.id, { reason: 'Capacity recovery fixture' }));
    const retried = await dispatch.assignInternal(req(users.admin, loserId, body));
    assert.equal(retried.response.job.status, 'assigned');
  });
  await check('SERVICE marketplace claim race, capacity denial and replay identity', async () => {
    const job = await directJob(); const a = await directCapacity('helper'); const b = await directCapacity('helper');
    await dispatch.releaseMarketplace(req(users.admin, job.id, { reason: 'Synthetic fallback' }));
    await assert.rejects(dispatch.claim(req(users.unapproved, job.id)), { code: 'delivery_capacity_mismatch' });
    const requests = [req(a.user, job.id), req(b.user, job.id)];
    const outcomes = await Promise.allSettled(requests.map((r) => dispatch.claim(r)));
    verifyRace(outcomes);
    const index = outcomes.findIndex((r) => r.status === 'fulfilled');
    const replay = await dispatch.claim(requests[index]);
    assert.equal(replay.response.duplicate, true);
    await assert.rejects(dispatch.claim({ ...requests[index], body: { changed: true } }), { code: 'delivery_idempotency_conflict' });
    assert.equal(await count('delivery_assignment_reservations', job.id), 1);
    assert(!JSON.stringify(replay.response).includes('proof_pin_digest'));
  });
  await check('SERVICE capability rejects service area, pieces, dimensions and insurance; adjacent windows allowed', async () => {
    const input = makeInput(); const job = await directJob(input); const capacity = await directCapacity();
    const body = { driverUserId: capacity.user.id, vehicleId: capacity.vehicle.id };
    for (const [column, value, restored] of [
      ['service_area', JSON.stringify({ states: ['NY'] }), JSON.stringify({ states: ['FL'] })],
      ['insurance_acknowledged', false, true], ['max_payload_lbs', 1, 1000], ['cargo_length_in', 1, 100],
    ]) {
      await pool.query(`UPDATE delivery_driver_profiles SET ${column}=$1 WHERE user_id=$2`, [value, capacity.user.id]);
      await assert.rejects(dispatch.assignInternal(req(users.admin, job.id, body)), { code: 'delivery_capacity_mismatch' });
      await pool.query(`UPDATE delivery_driver_profiles SET ${column}=$1 WHERE user_id=$2`, [restored, capacity.user.id]);
    }
    await dispatch.assignInternal(req(users.admin, job.id, body));
    const end = new Date(input.deliveryWindow.end).getTime();
    const next = { ...input, pickupWindow: { start: new Date(end).toISOString(), end: new Date(end + 3600000).toISOString() }, deliveryWindow: { start: new Date(end + 7200000).toISOString(), end: new Date(end + 10800000).toISOString() } };
    const adjacent = await directJob(next);
    await dispatch.assignInternal(req(users.admin, adjacent.id, body));
    assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM delivery_assignment_reservations WHERE driver_user_id=$1 AND status='active'", [capacity.user.id])).rows[0].count), 2);
  });
  await check('SERVICE reschedule updates reservation atomically; overlapping review rolls back', async () => {
    const inputA = makeInput(); const inputB = makeInput(); const a = await directJob(inputA); const b = await directJob(inputB); const capacity = await directCapacity();
    const body = { driverUserId: capacity.user.id, vehicleId: capacity.vehicle.id };
    await dispatch.assignInternal(req(users.admin, a.id, body)); await dispatch.assignInternal(req(users.admin, b.id, body));
    const requested = await recovery.requestReschedule(req(users.customer, b.id, { pickupWindow: inputA.pickupWindow, deliveryWindow: inputA.deliveryWindow, reason: 'Synthetic overlapping request' }));
    const requestId = requested.response.request.id;
    await assert.rejects(recovery.reviewReschedule(req(users.admin, b.id, { decision: 'approved' }, undefined, { requestId })), { code: 'delivery_schedule_conflict' });
    assert.equal((await pool.query('SELECT status FROM delivery_reschedule_requests WHERE id=$1', [requestId])).rows[0].status, 'pending');
    assert.equal(new Date((await jobRow(b.id)).pickup_window_start).toISOString(), inputB.pickupWindow.start);
    await recovery.reviewReschedule(req(users.admin, b.id, { decision: 'rejected' }, undefined, { requestId }));
    const inputC = makeInput();
    const next = await recovery.requestReschedule(req(users.customer, b.id, { pickupWindow: inputC.pickupWindow, deliveryWindow: inputC.deliveryWindow, reason: 'Synthetic valid reschedule' }));
    await recovery.reviewReschedule(req(users.admin, b.id, { decision: 'approved' }, undefined, { requestId: next.response.request.id }));
    const reservation = (await pool.query("SELECT * FROM delivery_assignment_reservations WHERE delivery_job_id=$1 AND status='active'", [b.id])).rows[0];
    assert.equal(new Date(reservation.starts_at).toISOString(), inputC.pickupWindow.start);
  });
  await check('SERVICE return custody, proof-required completion, replay and reservation release', async () => {
    const job = await directJob(); const capacity = await directCapacity();
    await dispatch.assignInternal(req(users.admin, job.id, { driverUserId: capacity.user.id, vehicleId: capacity.vehicle.id }));
    await assert.rejects(recovery.requestReturn(req(users.customer, job.id, { reason: 'Before pickup' })), { code: 'delivery_return_conflict' });
    await pool.query("UPDATE delivery_jobs SET status='in_transit',picked_up_at=NOW() WHERE id=$1", [job.id]);
    const requested = await recovery.requestReturn(req(users.customer, job.id, { reason: 'Recipient unavailable' }));
    const returnId = requested.response.returnRequest.id;
    await assert.rejects(dispatch.releaseMarketplace(req(users.admin, job.id, { reason: 'Unsafe release' })), { code: 'delivery_release_conflict' });
    await recovery.reviewReturn(req(users.admin, job.id, { decision: 'approved' }, undefined, { returnId }));
    await assert.rejects(recovery.reviewReturn(req(users.admin, job.id, { decision: 'completed' }, undefined, { returnId })), { code: 'delivery_recipient_confirmation_required' });
    const completed = req(users.admin, job.id, { decision: 'completed', proofType: 'recipient_confirmation', recipientName: 'Synthetic Sender', recipientContact: '+13055550101', confirmed: true }, undefined, { returnId });
    await recovery.reviewReturn(completed); await recovery.reviewReturn(completed);
    assert.equal((await jobRow(job.id)).status, 'returned'); assert.equal(await count('delivery_proofs', job.id), 1);
    assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM delivery_assignment_reservations WHERE delivery_job_id=$1 AND status='active'", [job.id])).rows[0].count), 0);
  });
  await directPaymentJourneys();
}

async function directPaymentJourneys() {
  const refundCalls = new Map();
  const paymentService = require('../services/localDeliveryPaymentService').createService({ db: pool, getStripe: () => fixtureStripe,
    issueRefund: async (intentId, amount, key) => {
      if (refundCalls.has(key)) return refundCalls.get(key);
      const session = [...effects.sessions.values()].find((s) => s.payment_intent?.id === intentId);
      assert(session, 'Refund fixture intent missing');
      session.payment_intent.latest_charge.amount_refunded += amount;
      const result = { id: `re_fixture_${refundCalls.size + 1}`, payment_intent: intentId, amount, currency: 'usd', status: 'succeeded' };
      refundCalls.set(key, result); return result;
    },
  });
  async function payableJob() {
    const job = await directJob();
    const q = await insertFixture('delivery_quotes', {
      customer_user_id: users.customer.id, delivery_job_id: job.id, request_hash: '0'.repeat(64),
      input_snapshot: '{}', price_snapshot: job.price_snapshot, customer_total_cents: 2000, driver_payout_cents: 1500,
      expires_at: new Date(Date.now() + 3600000), accepted_at: new Date(), accepted_by_user_id: users.customer.id,
    });
    await pool.query('UPDATE delivery_jobs SET quote_id=$1 WHERE id=$2', [q.id, job.id]);
    return job;
  }
  await check('SERVICE base checkout races reserve one obligation; verified capture ledger exactly once', async () => {
    const job = await payableJob(); const args = { deliveryJobId: job.id, customerUserId: users.customer.id }; const before = effects.checkoutCreates;
    const started = await Promise.all(Array.from({ length: 4 }, () => paymentService.createBaseCheckout(args)));
    assert.equal(new Set(started.map((r) => r.payment.id)).size, 1); assert.equal(effects.checkoutCreates - before, 1);
    const id = started[0].payment.id;
    await assert.rejects(paymentService.syncPayment({ paymentId: id, customerUserId: users.other.id }), { status: 404 });
    await settleFixture(id);
    const synced = await Promise.all(Array.from({ length: 4 }, () => paymentService.syncPayment({ paymentId: id, customerUserId: users.customer.id })));
    assert(synced.every((r) => r.payment.status === 'paid'));
    const ledger = (await pool.query("SELECT * FROM platform_ledger WHERE metadata->>'deliveryPaymentId'=$1", [String(id)])).rows;
    assert.equal(ledger.length, 1); assert.equal(ledger[0].amount_cents, 2000);
    const refundArgs = { paymentId: id, actor: users.admin, targetRefundedAmountCents: 1000, reason: 'Synthetic partial refund' };
    await paymentService.refundPayment(refundArgs); await paymentService.refundPayment(refundArgs);
    assert.equal(refundCalls.size, 1);
    await paymentService.refundPayment({ ...refundArgs, targetRefundedAmountCents: 2000 });
    assert.equal(refundCalls.size, 2);
    assert.equal(Number((await pool.query("SELECT SUM(amount_cents) AS total FROM platform_ledger WHERE metadata->>'deliveryPaymentId'=$1", [String(id)])).rows[0].total), 0);
  });
  await check('SERVICE checkout rejects provider metadata or amount mismatch without settlement', async () => {
    const job = await payableJob(); const started = await paymentService.createBaseCheckout({ deliveryJobId: job.id, customerUserId: users.customer.id });
    const session = await settleFixture(started.payment.id); const args = { paymentId: started.payment.id, customerUserId: users.customer.id };
    session.amount_total = 1;
    await assert.rejects(paymentService.syncPayment(args), { code: 'delivery_payment_verification_failed' });
    session.amount_total = 2000; session.metadata = { ...session.metadata, customerUserId: users.other.id };
    await assert.rejects(paymentService.syncPayment(args), { code: 'delivery_payment_verification_failed' });
    assert.equal((await pool.query('SELECT status FROM delivery_payments WHERE id=$1', [started.payment.id])).rows[0].status, 'pending');
    assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM platform_ledger WHERE metadata->>'deliveryPaymentId'=$1", [String(started.payment.id)])).rows[0].count), 0);
  });
}

async function cleanup() {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (pool) await pool.end();
  if (containerId) {
    // Deletion target is exclusively the ID returned by this invocation.
    const label = docker(['inspect', '--format', '{{index .Config.Labels "oxsteed.delivery-verification"}}', containerId]);
    assert.equal(label, runId, 'Refusing to remove container without matching ownership label');
    docker(['rm', '--force', containerId]);
    console.log(`Removed disposable container ${runId} and its synthetic tmpfs database.`);
    containerId = null;
  }
}

async function main() {
  try {
    await startDatabase();
    for (const number of [566, 570, 571]) {
      if (!(await check(`actual migration ${number} applies`, () => migrate(number)))) return;
    }
    await check('baseline 566/570/571 reproduces missing proof_pin_digest (42703)', async () => {
      await assert.rejects(pool.query('SELECT proof_pin_digest FROM delivery_jobs LIMIT 0'), { code: '42703' });
    });
    let migrated = true;
    for (const number of [572, 574]) migrated = (await check(`actual migration ${number} applies`, () => migrate(number))) && migrated;
    if (!migrated) return;
    await check('proof PIN column provided by actual migrations', async () => {
      await pool.query('SELECT proof_pin_digest FROM delivery_jobs LIMIT 0');
    });
    await seedCapacity();
    await startApi();
    await directServiceJourneys();
    if (process.env.DELIVERY_VERIFY_SERVICES_ONLY === '1') {
      console.log('API journeys explicitly omitted by DELIVERY_VERIFY_SERVICES_ONLY=1; this is not a full acceptance run.');
      await workerJourneys();
    } else await journeys();
  } catch (error) {
    results.push({ name: 'harness infrastructure', pass: false, error: error.message });
    console.error(`FAIL harness infrastructure: ${error.message}`);
  } finally {
    await cleanup();
    const failed = results.filter((result) => !result.pass);
    console.log(`\nLocal delivery isolated verification: ${results.length - failed.length} passed, ${failed.length} failed.`);
    process.exitCode = failed.length ? 1 : 0;
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
