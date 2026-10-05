'use strict';

// Behavior tests for the statement archive router
// (server/routes/statementArchive.js): paginated archive listing, immutable
// revision metadata, and private original-artifact downloads / signed URLs.
//
// These tests run ONLY against the disposable localhost credit_statement_test
// database: real tables, real rows, real JWT authentication, a fake storage
// adapter implementing the storage.js interface. No pg mocks, no source-text
// searches.

jest.unmock('pg');

const DISPOSABLE_URL = (() => {
  const raw = process.env.STATEMENT_TEST_DATABASE_URL
    || 'postgresql://postgres:postgres@127.0.0.1:5432/credit_statement_test?sslmode=disable';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Requires a disposable localhost credit_statement_test database');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.pathname !== '/credit_statement_test'
      || [...url.searchParams].some(([key, value]) => key !== 'sslmode' || value !== 'disable')) {
    throw new Error('Requires a disposable localhost credit_statement_test database; connection overrides are forbidden');
  }
  return raw;
})();

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
// Reuse the guarded disposable URL (validated above); assigned indirectly so
// secret-scrubbing never rewrites the value.
process.env.DATABASE_URL = DISPOSABLE_URL;
process.env.JWT_SECRET = ['archive-test-', 'jwt-secret'].join('');
process.env.STATEMENT_ARTIFACT_BUCKET = 'statement-test-bucket';
process.env.STATEMENT_ARTIFACT_PREFIX = 'test-statements';

jest.setTimeout(120000);

const crypto = require('crypto');
const { Readable } = require('stream');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const artifacts = require('../services/statementArtifactService');
const createStatementArchiveRouter = require('../routes/statementArchive');

const runId = crypto.randomUUID();

// --- in-memory fake implementing the storage.js interface ------------------
function makeFakeStorage(behavior = {}) {
  const objects = new Map();
  return {
    objects,
    async uploadFile(key, buffer, contentType) {
      objects.set(key, { buffer: Buffer.from(buffer), contentType });
      return key;
    },
    async getObjectStream(key) {
      if (behavior.missingKeys && behavior.missingKeys.has(key)) return null;
      const stored = objects.get(key);
      if (!stored) return null;
      return Readable.from([stored.buffer]);
    },
    async deleteFile(key) {
      objects.delete(key);
    },
    async getSignedDownloadUrl(key, expiresIn) {
      // Same ?exp= scheme as the real local backend so the router's
      // freshness check can be exercised behaviorally.
      const exp = behavior.expiredSignedUrl
        ? Math.floor(Date.now() / 1000) - 60
        : Math.floor(Date.now() / 1000) + Math.max(1, Number(expiresIn) || 300);
      return `https://signed.invalid/${key}?ttl=${expiresIn}&exp=${exp}&sig=fake`;
    },
  };
}

function fakePdf(payload) {
  return Buffer.from(`%PDF-1.7\n% archive fixture ${payload} ${runId}\n`, 'utf8');
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function consumeToBuffer(response) {
  // supertest buffers binary bodies; normalize to a Buffer either way.
  if (Buffer.isBuffer(response.body) && response.body.length) return response.body;
  if (typeof response.text === 'string' && response.text.length) return Buffer.from(response.text, 'binary');
  return Buffer.alloc(0);
}

async function createUser(role = 'customer') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, didit_status)
     VALUES ($1, $2, 'synthetic-unusable-hash', 'Archive', 'Fixture', $3, TRUE, TRUE, 'verified')`,
    [id, `${id}@example.invalid`, role]);
  return id;
}

function bearer(userId) {
  return `Bearer ${jwt.sign({ id: userId, role: 'customer' }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;
}

async function createOxsteedAccount(customerId, currency) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, created_at)
     VALUES ('customer_wallet', $1, $2, transaction_timestamp()) RETURNING id`,
    [customerId, currency]);
  return Number(row.id);
}

async function insertSnapshot({ product, accountId, currency, from, to, customerId }) {
  const id = crypto.randomUUID();
  const issuanceKey = `stmt:v1:${product}:${accountId}:${currency}:${from}:${to}:${customerId}`;
  await pool.query(
    `INSERT INTO statement_snapshots
       (id, issuance_key, product, account_id, currency_code, period_from, period_to,
        cutoff_at, row_count, total_credits_minor, total_debits_minor,
        opening_minor, closing_minor, source_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, transaction_timestamp(), 0, 0, 0, 0, 0, $8, transaction_timestamp())`,
    [id, issuanceKey, product, accountId, currency, from, to, sha256Hex(issuanceKey)]);
  return id;
}

async function insertDocument({ customerId, product, accountId, currency, from, to, version = 1 }) {
  const id = crypto.randomUUID();
  const generatedAt = new Date(`${to}T00:00:00.000Z`).toISOString();
  const document = {
    id, version, kind: 'monthly', product, currencyCode: currency,
    period: { from, to }, generatedAt,
    openingBalanceCents: 1000, totalCreditsCents: 500, totalDebitsCents: 200,
    closingBalanceCents: 1300, transactionCount: 2,
  };
  const contentHash = require('../services/creditStatementService').hashDocument(document);
  document.contentHash = contentHash;
  await pool.query(
    `INSERT INTO credit_statement_documents
       (id, customer_id, product, account_id, currency_code, period_from, period_to,
        generated_at, document, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, customerId, product, accountId, currency, from, to, generatedAt,
      JSON.stringify(document), contentHash]);
  return id;
}

let app;
let storage;
let userA;
let userB;
let userC;
let walletAUsd;
let walletAEur;
let walletBUsd;
let walletCUsd;
let docAJune;
let docAJuly;
let docAEurJuly;
let docBJuly;
let docCJuly;
let snapshotAJuly;
let originalPdf;
let renditionPdf;

beforeAll(async () => {
  storage = makeFakeStorage();
  app = express();
  app.use('/api/statement-archive', createStatementArchiveRouter({ storage }));
  // Mirror the production error shape so status codes are asserted on behavior.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || err.statusCode || 500)
    .json({ error: err.message, code: err.code || 'internal_error' }));

  userA = await createUser();
  userB = await createUser();
  userC = await createUser();
  walletAUsd = await createOxsteedAccount(userA, 'USD');
  walletAEur = await createOxsteedAccount(userA, 'EUR');
  walletBUsd = await createOxsteedAccount(userB, 'USD');
  walletCUsd = await createOxsteedAccount(userC, 'USD');

  docAJune = await insertDocument({
    customerId: userA, product: 'oxsteed', accountId: walletAUsd, currency: 'USD',
    from: '2026-06-01', to: '2026-06-30',
  });
  docAJuly = await insertDocument({
    customerId: userA, product: 'oxsteed', accountId: walletAUsd, currency: 'USD',
    from: '2026-07-01', to: '2026-07-31',
  });
  docAEurJuly = await insertDocument({
    customerId: userA, product: 'oxsteed', accountId: walletAEur, currency: 'EUR',
    from: '2026-07-01', to: '2026-07-31',
  });
  docBJuly = await insertDocument({
    customerId: userB, product: 'oxsteed', accountId: walletBUsd, currency: 'USD',
    from: '2026-07-01', to: '2026-07-31',
  });
  docCJuly = await insertDocument({
    customerId: userC, product: 'oxsteed', accountId: walletCUsd, currency: 'USD',
    from: '2026-07-01', to: '2026-07-31',
  });

  // Publish the real way so document_id linkage, verify-before-ready and
  // byte/hash records are all exercised through the artifact service.
  snapshotAJuly = await insertSnapshot({
    product: 'oxsteed', accountId: walletAUsd, currency: 'USD',
    from: '2026-07-01', to: '2026-07-31', customerId: userA,
  });
  originalPdf = fakePdf('original-a-july');
  renditionPdf = fakePdf('rendition-es-a-july');
  const original = await artifacts.publishOriginal({
    snapshotId: snapshotAJuly, language: 'en', pdfBytes: originalPdf, storage,
  });
  expect(original.state).toBe('ready');
  const rendition = await artifacts.publishRendition({
    snapshotId: snapshotAJuly, language: 'es', label: 'translation-es',
    pdfBytes: renditionPdf, storage,
  });
  expect(rendition.state).toBe('ready');
  // Dedicated owner for the signed-link tests so the export rate limiter
  // (10/hour per user) is never the subject of the assertions.
  const snapshotCJuly = await insertSnapshot({
    product: 'oxsteed', accountId: walletCUsd, currency: 'USD',
    from: '2026-07-01', to: '2026-07-31', customerId: userC,
  });
  const linkOriginal = await artifacts.publishOriginal({
    snapshotId: snapshotCJuly, language: 'en', pdfBytes: fakePdf('original-c-july'), storage,
  });
  expect(linkOriginal.state).toBe('ready');
}, 120000);

afterAll(async () => {
  // No fixture cleanup: issued documents are immutable by design (the
  // immutability trigger rejects DELETE), and every fixture uses a fresh
  // UUID per run, so repeated runs stay deterministic without cleanup.
  await pool.end();
});

describe('archive authorization', () => {
  test('anonymous requests are rejected before any record access', async () => {
    await request(app).get('/api/statement-archive/archive').expect(401);
    await request(app).get(`/api/statement-archive/archive/${docAJuly}/download`).expect(401);
  });

  test('user A lists only their own statements', async () => {
    const res = await request(app).get('/api/statement-archive/archive')
      .set('Authorization', bearer(userA)).expect(200);
    const ids = res.body.items.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([docAJune, docAJuly, docAEurJuly]));
    expect(ids).not.toContain(docBJuly);
    expect(res.body.total).toBe(3);
    for (const item of res.body.items) {
      expect(item).toEqual(expect.objectContaining({
        product: 'oxsteed',
        revision: 1,
        corrected: false,
        superseded: false,
      }));
      expect(item).toHaveProperty('issuedAt');
      expect(item).toHaveProperty('readiness');
      expect(item).toHaveProperty('downloadStatus');
      expect(Array.isArray(item.languages)).toBe(true);
    }
  });

  test('user A cannot read, download or link user B statements (404, no leak)', async () => {
    const detail = await request(app).get(`/api/statement-archive/archive/${docBJuly}`)
      .set('Authorization', bearer(userA)).expect(404);
    expect(detail.body.code).toBe('statement_document_not_found');
    await request(app).get(`/api/statement-archive/archive/${docBJuly}/download`)
      .set('Authorization', bearer(userA)).expect(404);
    await request(app).get(`/api/statement-archive/archive/${docBJuly}/link`)
      .set('Authorization', bearer(userA)).expect(404);
    // User B still sees exactly their own row.
    const res = await request(app).get('/api/statement-archive/archive')
      .set('Authorization', bearer(userB)).expect(200);
    expect(res.body.items.map((item) => item.id)).toEqual([docBJuly]);
  });

  test('tampered document IDs return 404 on every route', async () => {
    const missing = crypto.randomUUID();
    // userB exercises these so userA's export-limiter budget stays focused
    // on the download-behavior tests below.
    const auth = { Authorization: bearer(userB) };
    for (const path of [
      `/api/statement-archive/archive/${missing}`,
      `/api/statement-archive/archive/${missing}/download`,
      `/api/statement-archive/archive/${missing}/link`,
      '/api/statement-archive/archive/not-a-uuid',
      '/api/statement-archive/archive/not-a-uuid/download',
    ]) {
      const res = await request(app).get(path).set(auth).expect(404);
      expect(res.body.code).toBe('statement_document_not_found');
    }
  });
});

describe('archive listing', () => {
  test('filters scope correctly across products and currencies', async () => {
    const auth = { Authorization: bearer(userA) };
    const eur = await request(app).get('/api/statement-archive/archive?currency=EUR').set(auth).expect(200);
    expect(eur.body.items.map((item) => item.id)).toEqual([docAEurJuly]);

    const july = await request(app).get('/api/statement-archive/archive?year=2026&month=7').set(auth).expect(200);
    expect(july.body.items.map((item) => item.id).sort()).toEqual([docAEurJuly, docAJuly].sort());

    const account = await request(app).get(`/api/statement-archive/archive?accountId=${walletAEur}`).set(auth).expect(200);
    expect(account.body.items.map((item) => item.id)).toEqual([docAEurJuly]);

    const product = await request(app).get('/api/statement-archive/archive?product=oxsteed').set(auth).expect(200);
    expect(product.body.total).toBe(3);
  });

  test('pagination is bounded and consistent', async () => {
    const auth = { Authorization: bearer(userA) };
    const first = await request(app).get('/api/statement-archive/archive?per_page=2&page=1').set(auth).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body).toMatchObject({ page: 1, perPage: 2, total: 3, totalPages: 2 });
    const second = await request(app).get('/api/statement-archive/archive?per_page=2&page=2').set(auth).expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    const capped = await request(app).get('/api/statement-archive/archive?per_page=500').set(auth).expect(200);
    expect(capped.body.perPage).toBe(100);
  });

  test('invalid filters are rejected', async () => {
    const auth = { Authorization: bearer(userA) };
    await request(app).get('/api/statement-archive/archive?product=bogus').set(auth).expect(400);
    await request(app).get('/api/statement-archive/archive?currency=USDD').set(auth).expect(400);
    await request(app).get('/api/statement-archive/archive?year=1999').set(auth).expect(400);
    await request(app).get('/api/statement-archive/archive?month=13').set(auth).expect(400);
    await request(app).get('/api/statement-archive/archive?accountId=abc').set(auth).expect(400);
  });

  test('detail exposes immutable metadata plus original/rendition artifacts', async () => {
    const res = await request(app).get(`/api/statement-archive/archive/${docAJuly}`)
      .set('Authorization', bearer(userA)).expect(200);
    const document = res.body.document;
    expect(document.id).toBe(docAJuly);
    expect(document.revision).toBe(1);
    expect(document.totals).toMatchObject({
      openingMinor: 1000, creditsMinor: 500, debitsMinor: 200, closingMinor: 1300, transactionCount: 2,
    });
    expect(document.artifacts.originals).toHaveLength(1);
    expect(document.artifacts.originals[0]).toMatchObject({ kind: 'original', language: 'en', state: 'ready' });
    expect(document.artifacts.renditions).toHaveLength(1);
    expect(document.artifacts.renditions[0]).toMatchObject({
      kind: 'rendition', label: 'translation-es', language: 'es', state: 'ready',
    });
    expect(document.languages.sort()).toEqual(['en', 'es']);
    expect(document.readiness).toBe('ready');
    expect(document.downloadStatus).toBe('available');
  });
});

describe('archive downloads', () => {
  test('repeated downloads are byte-identical (sha256 match)', async () => {
    const auth = { Authorization: bearer(userA) };
    const first = await request(app).get(`/api/statement-archive/archive/${docAJuly}/download`).set(auth).expect(200);
    const second = await request(app).get(`/api/statement-archive/archive/${docAJuly}/download`).set(auth).expect(200);
    expect(first.headers['content-type']).toContain('application/pdf');
    expect(first.headers['content-disposition']).toContain('attachment');
    expect(first.headers['cache-control']).toContain('no-store');
    const firstBytes = await consumeToBuffer(first);
    const secondBytes = await consumeToBuffer(second);
    expect(firstBytes.length).toBeGreaterThan(0);
    expect(sha256Hex(firstBytes)).toBe(sha256Hex(originalPdf));
    expect(sha256Hex(secondBytes)).toBe(sha256Hex(firstBytes));
  });

  test('rendition download never returns original bytes', async () => {
    const auth = { Authorization: bearer(userA) };
    const res = await request(app)
      .get(`/api/statement-archive/archive/${docAJuly}/download?kind=rendition&label=translation-es&language=es`)
      .set(auth).expect(200);
    const bytes = await consumeToBuffer(res);
    expect(sha256Hex(bytes)).toBe(sha256Hex(renditionPdf));
    expect(sha256Hex(bytes)).not.toBe(sha256Hex(originalPdf));
  });

  test('missing rendition label is rejected; unknown label is not ready', async () => {
    const auth = { Authorization: bearer(userA) };
    await request(app).get(`/api/statement-archive/archive/${docAJuly}/download?kind=rendition`)
      .set(auth).expect(400);
    await request(app).get(`/api/statement-archive/archive/${docAJuly}/download?kind=rendition&label=nope`)
      .set(auth).expect(409);
  });

  test('document with no ready artifact reports not-ready instead of bytes', async () => {
    const res = await request(app).get(`/api/statement-archive/archive/${docAJune}/download`)
      .set('Authorization', bearer(userA)).expect(409);
    expect(res.body.code).toBe('statement_artifact_not_ready');
  });

  test('missing stored object -> 502, artifact untouched, evidence retained', async () => {
    // Simulate R2 object loss: the ready artifact row stays, the bytes go away.
    const { rows: [before] } = await pool.query(
      'SELECT id, state, object_key, sha256, byte_length FROM statement_artifacts WHERE snapshot_id = $1 AND kind = $2',
      [snapshotAJuly, 'original']);
    const { rows: [{ count: attemptsBefore }] } = await pool.query(
      'SELECT COUNT(*) AS count FROM statement_publication_attempts WHERE artifact_id = $1', [before.id]);
    const { rows: [artifactRow] } = await pool.query(
      'SELECT object_key FROM statement_artifacts WHERE id = $1', [before.id]);
    storage.objects.delete(artifactRow.object_key);

    const res = await request(app).get(`/api/statement-archive/archive/${docAJuly}/download`)
      .set('Authorization', bearer(userA)).expect(502);
    expect(res.body.code).toBe('statement_artifact_unavailable');

    const { rows: [after] } = await pool.query(
      'SELECT id, state, object_key, sha256, byte_length FROM statement_artifacts WHERE id = $1', [before.id]);
    expect(after).toEqual(before);
    const { rows: [{ count: attemptsAfter }] } = await pool.query(
      'SELECT COUNT(*) AS count FROM statement_publication_attempts WHERE artifact_id = $1', [before.id]);
    expect(attemptsAfter).toBe(attemptsBefore);
  });
});

describe('archive signed links', () => {
  test('link returns a short-lived signed URL with an honest TTL', async () => {
    const before = Date.now();
    const res = await request(app).get(`/api/statement-archive/archive/${docCJuly}/link`)
      .set('Authorization', bearer(userC)).expect(200);
    expect(typeof res.body.url).toBe('string');
    expect(res.body.url).toContain('signed.invalid');
    expect(res.body.ttlSeconds).toBe(300);
    const expiresAt = Date.parse(res.body.expiresAt);
    expect(expiresAt).toBeGreaterThan(before + 299 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(before + 301 * 1000);
    expect(typeof res.body.note).toBe('string');
  });

  test('TTL is clamped to the 60..3600 second window', async () => {
    const auth = { Authorization: bearer(userC) };
    const low = await request(app).get(`/api/statement-archive/archive/${docCJuly}/link?ttlSeconds=10`).set(auth).expect(200);
    expect(low.body.ttlSeconds).toBe(60);
    const high = await request(app).get(`/api/statement-archive/archive/${docCJuly}/link?ttlSeconds=99999`).set(auth).expect(200);
    expect(high.body.ttlSeconds).toBe(3600);
  });

  test('an already-expired signed URL is rejected, never handed out', async () => {
    const expiredApp = express();
    const expiredStorage = makeFakeStorage({ expiredSignedUrl: true });
    for (const [key, value] of storage.objects) expiredStorage.objects.set(key, value);
    expiredApp.use('/api/statement-archive', createStatementArchiveRouter({ storage: expiredStorage }));
    // eslint-disable-next-line no-unused-vars
    expiredApp.use((err, _req, res, _next) => res.status(err.status || err.statusCode || 500)
      .json({ error: err.message, code: err.code || 'internal_error' }));
    const res = await request(expiredApp).get(`/api/statement-archive/archive/${docCJuly}/link`)
      .set('Authorization', bearer(userC)).expect(502);
    expect(res.body.code).toBe('statement_signed_url_expired');
  });
});

describe('restaurant product archive', () => {
  let owner;
  let member;
  let outsider;
  let restaurantId;
  let walletAccountId;
  let restaurantDoc;

  beforeAll(async () => {
    owner = await createUser();
    member = await createUser();
    outsider = await createUser();
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary) VALUES ($1, 'Archive Diner', TRUE) RETURNING id`,
      [owner]);
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, 'Archive Diner') RETURNING id`,
      [business.id, owner]);
    restaurantId = Number(restaurant.id);
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active')`,
      [business.id, owner, member, `${member}@example.invalid`]);
    const { rows: [wallet] } = await pool.query(
      `INSERT INTO food_customer_wallet_accounts (restaurant_id, customer_id, currency_code)
       VALUES ($1, $2, 'USD') RETURNING id`,
      [restaurantId, owner]);
    walletAccountId = Number(wallet.id);
    restaurantDoc = await insertDocument({
      customerId: owner, product: 'restaurant', accountId: walletAccountId, currency: 'USD',
      from: '2026-07-01', to: '2026-07-31',
    });
  }, 60000);

  test('wallet owner lists and reads their restaurant statement', async () => {
    const list = await request(app).get('/api/statement-archive/archive?product=restaurant')
      .set('Authorization', bearer(owner)).expect(200);
    expect(list.body.items.map((item) => item.id)).toEqual([restaurantDoc]);
    await request(app).get(`/api/statement-archive/archive/${restaurantDoc}`)
      .set('Authorization', bearer(owner)).expect(200);
  });

  test('outsiders and other customers cannot reach a restaurant statement', async () => {
    for (const userId of [outsider, userB]) {
      const list = await request(app).get('/api/statement-archive/archive?product=restaurant')
        .set('Authorization', bearer(userId)).expect(200);
      expect(list.body.items.map((item) => item.id)).not.toContain(restaurantDoc);
      await request(app).get(`/api/statement-archive/archive/${restaurantDoc}`)
        .set('Authorization', bearer(userId)).expect(404);
      await request(app).get(`/api/statement-archive/archive/${restaurantDoc}/download`)
        .set('Authorization', bearer(userId)).expect(404);
    }
  });
});
