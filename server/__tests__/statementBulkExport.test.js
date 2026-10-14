'use strict';

// Bulk export, export history, accounting (OFX) download, ZIP packaging, and
// entry-note route wiring. Route tests inject fake services (no database);
// service validation tests use the real statementExportService with stubbed
// jobs; the accounting happy path runs against an isolated schema with a
// synthetic restaurant ledger.

jest.unmock('pg');
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    const actor = req.headers['x-test-actor'];
    if (!actor) return res.status(401).json({ error: 'unauthenticated' });
    req.user = { id: actor };
    next();
  },
}));
jest.mock('../middleware/rateLimiter', () => ({
  creditExportLimiter: (_req, _res, next) => next(),
  authenticatedLimiter: (_req, _res, next) => next(),
}));

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { Readable, PassThrough } = require('node:stream');
const { Pool } = require('pg');

// The statement builders (creditStatementService/settlementStatementService)
// use their module-level pool, so point DATABASE_URL at the isolated test
// database with the fixture schema first on the search path, before any
// service is required. This honors STATEMENT_TEST_DATABASE_URL end to end.
const OFX_SCHEMA = 'statement_bulk_ofx_test';
const dbUrl = process.env.STATEMENT_TEST_DATABASE_URL;
if (dbUrl) {
  const parsed = new URL(dbUrl);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/credit_statement_test') {
    throw new Error('Only an explicitly isolated statement test database is allowed');
  }
  parsed.searchParams.set('options', `-c search_path=${OFX_SCHEMA},public`);
  process.env.DATABASE_URL = parsed.toString();
}
const describeDb = dbUrl ? describe : describe.skip;
const { createRouter } = require('../routes/statementExports');
const { createService } = require('../services/statementExportService');
const archiver = require('archiver');

const user = 'b279247f-65d1-4c3c-8ae7-a4cb5d951849';
const stranger = '5f0d0562-3cba-4632-8609-1d9daf43930e';

function testApp(deps) {
  const app = express();
  app.use(express.json());
  app.use('/api/statements/exports', createRouter(undefined, deps));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  return app;
}

describe('statement export routes (wired, no database)', () => {
  const job = { id: crypto.randomUUID(), product: 'restaurant', state: 'complete', period: { from: '2026-08-01', to: '2026-08-31' } };
  let bulk, notes, app;
  beforeEach(() => {
    bulk = {
      requestBulk: jest.fn(async () => ({ bulkId: 'bulk-1', jobs: [job] })),
      packageJobs: jest.fn(async () => {
        const archive = new PassThrough();
        // Mirrors the real service, which finalizes before returning: bytes
        // flow as soon as the route pipes the archive to the response.
        process.nextTick(() => archive.end('fake-zip-bytes'));
        return { archive, filename: 'statement-package-2026-08-31.zip' };
      }),
      exportHistory: jest.fn(async () => ({ page: 1, pageSize: 20, total: 1, jobs: [job] })),
      accountingExport: jest.fn(async () => ({ content: 'OFXDATA', filename: 'statement.ofx', mediaType: 'application/x-ofx' })),
    };
    notes = {
      list: jest.fn(async () => []),
      upsert: jest.fn(async (userId, body) => ({ id: 'note-1', ...body })),
      remove: jest.fn(async () => ({ id: 'note-1', deleted: true })),
      attachmentRedirect: jest.fn(async () => 'https://signed.example/key'),
    };
    app = testApp({ bulk, notes });
  });

  test('bulk export requires authentication', async () => {
    await request(app).post('/api/statements/exports/bulk').send({ items: [] }).expect(401);
    expect(bulk.requestBulk).not.toHaveBeenCalled();
  });

  test('bulk export passes items and the idempotency key through and returns 202', async () => {
    const items = [{ product: 'restaurant', restaurantId: 1, currencyCode: 'USD', from: '2026-08-01', to: '2026-08-31', format: 'csv', language: 'en' }];
    const response = await request(app).post('/api/statements/exports/bulk')
      .set('x-test-actor', user).set('Idempotency-Key', 'bulk-key-1').send({ items }).expect(202);
    expect(bulk.requestBulk).toHaveBeenCalledWith(user, items, 'bulk-key-1');
    expect(response.body.data.bulkId).toBe('bulk-1');
  });

  test('service errors surface with their status code', async () => {
    const AppError = require('../utils/appError');
    bulk.requestBulk.mockRejectedValueOnce(new AppError('too many', 400, 'statement_bulk_invalid_items'));
    const response = await request(app).post('/api/statements/exports/bulk')
      .set('x-test-actor', user).set('Idempotency-Key', 'k').send({ items: [] }).expect(400);
    expect(response.body.code).toBe('statement_bulk_invalid_items');
  });

  test('export history lists the callers jobs with pagination', async () => {
    const response = await request(app).get('/api/statements/exports?page=2&pageSize=5')
      .set('x-test-actor', user).expect(200);
    expect(bulk.exportHistory).toHaveBeenCalledWith(user, { page: '2', pageSize: '5' });
    expect(response.body.data.total).toBe(1);
  });

  test('bulk package streams a ZIP attachment', async () => {
    const response = await request(app).post('/api/statements/exports/bulk/package')
      .set('x-test-actor', user).send({ jobIds: [job.id] }).expect(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toContain('statement-package-2026-08-31.zip');
    expect(bulk.packageJobs).toHaveBeenCalledWith(user, [job.id]);
  });

  test('accounting download streams the generated file as an attachment', async () => {
    const response = await request(app).post('/api/statements/exports/accounting')
      .set('x-test-actor', user)
      .send({ product: 'restaurant', restaurantId: 1, currencyCode: 'USD', from: '2026-08-01', to: '2026-08-31', format: 'ofx' })
      .expect(200);
    expect(response.headers['content-type']).toBe('application/x-ofx');
    expect(response.headers['content-disposition']).toContain('statement.ofx');
    expect(response.text).toBe('OFXDATA');
  });

  test('literal paths win over :jobId (notes are not treated as job ids)', async () => {
    const status = jest.fn();
    const jobApp = testApp({ bulk, notes });
    jobApp._router; // keep linter calm
    await request(jobApp).get('/api/statements/exports/notes?product=oxsteed')
      .set('x-test-actor', user).expect(200);
    expect(notes.list).toHaveBeenCalledWith(user, { product: 'oxsteed', documentId: undefined, entryId: undefined });
    expect(status).not.toHaveBeenCalled();
  });

  test('notes CRUD is owner-scoped to the authenticated user', async () => {
    await request(app).post('/api/statements/exports/notes').set('x-test-actor', user)
      .send({ product: 'oxsteed', entryId: 'tx-1', note: 'hello' }).expect(200);
    expect(notes.upsert).toHaveBeenCalledWith(user, { product: 'oxsteed', entryId: 'tx-1', note: 'hello' });
    await request(app).delete('/api/statements/exports/notes/note-1').set('x-test-actor', user).expect(200);
    expect(notes.remove).toHaveBeenCalledWith(user, 'note-1');
    await request(app).get('/api/statements/exports/notes/note-1/attachment')
      .set('x-test-actor', user).expect(302);
    expect(notes.attachmentRedirect).toHaveBeenCalledWith(user, 'note-1');
  });
});

describe('statementExportService validation (stubbed jobs)', () => {
  const fakeDb = { query: jest.fn() };
  const service = () => createService({ db: fakeDb, jobs: { request: jest.fn(async (_u, input) => ({ input })) } });

  test('bulk request requires an idempotency key and 1..20 items', async () => {
    const item = { product: 'restaurant', restaurantId: 1, currencyCode: 'USD', from: '2026-08-01', to: '2026-08-31', format: 'csv' };
    await expect(service().requestBulk(user, [item], 'bad key!!')).rejects.toMatchObject({ code: 'statement_export_idempotency_required' });
    await expect(service().requestBulk(user, [], 'bulk-key-ok')).rejects.toMatchObject({ code: 'statement_bulk_invalid_items' });
    await expect(service().requestBulk(user, Array(21).fill(item), 'bulk-key-ok')).rejects.toMatchObject({ code: 'statement_bulk_invalid_items' });
  });

  test('bulk items reject bad products, accounts, and non-job formats', async () => {
    const base = { restaurantId: 1, currencyCode: 'USD', from: '2026-08-01', to: '2026-08-31', format: 'csv' };
    await expect(service().requestBulk(user, [{ ...base, product: 'nope' }], 'bulk-key-ok'))
      .rejects.toMatchObject({ code: 'statement_invalid_product' });
    await expect(service().requestBulk(user, [{ ...base, product: 'restaurant', restaurantId: 'x' }], 'bulk-key-ok'))
      .rejects.toMatchObject({ code: 'statement_invalid_account' });
    // OFX rides the synchronous accounting path, not the job pipeline.
    await expect(service().requestBulk(user, [{ ...base, product: 'restaurant', format: 'ofx' }], 'bulk-key-ok'))
      .rejects.toMatchObject({ code: 'statement_export_invalid_format' });
  });

  test('bulk items derive independent idempotency keys per job', async () => {
    const jobs = { request: jest.fn(async (_u, _input, key) => ({ key })) };
    const item = { product: 'restaurant', restaurantId: 1, currencyCode: 'USD', from: '2026-08-01', to: '2026-08-31', format: 'pdf' };
    const result = await createService({ db: fakeDb, jobs }).requestBulk(user, [item, item], 'bulk-key-ok');
    expect(result.jobs.map((j) => j.key)).toEqual(['bulk-key-ok:bulk:0', 'bulk-key-ok:bulk:1']);
  });

  test('accounting export validates before touching the database', async () => {
    const base = { product: 'restaurant', restaurantId: 1, currencyCode: 'USD', from: '2026-08-01', to: '2026-08-31' };
    await expect(service().accountingExport(user, { ...base, product: 'nope', format: 'ofx' }))
      .rejects.toMatchObject({ code: 'statement_invalid_product' });
    await expect(service().accountingExport(user, { ...base, format: 'csv' }))
      .rejects.toMatchObject({ code: 'statement_export_invalid_format' });
    await expect(service().accountingExport('not-a-user', { ...base, format: 'ofx' }))
      .rejects.toMatchObject({ code: 'statement_export_not_found' });
  });
});

describeDb('statementExportService against an isolated schema', () => {
  let root, db, service;
  beforeAll(async () => {
    root = new Pool({ connectionString: process.env.STATEMENT_TEST_DATABASE_URL, max: 2 });
    await root.query(`DROP SCHEMA IF EXISTS ${OFX_SCHEMA} CASCADE`);
    await root.query(`CREATE SCHEMA ${OFX_SCHEMA}`);
    db = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    await db.query(`CREATE TABLE users(id uuid PRIMARY KEY, first_name text, last_name text, email text);
      CREATE TABLE food_restaurants(id bigint PRIMARY KEY, display_name text);
      CREATE TABLE food_customer_wallet_accounts(id bigint PRIMARY KEY, customer_id uuid, restaurant_id bigint, currency_code text, created_at timestamptz);
      CREATE TABLE food_customer_wallet_ledger(id bigint PRIMARY KEY, account_id bigint, currency_code text, created_at timestamptz,
        entry_sequence bigint, entry_type text, description text, amount_cents bigint, balance_after_cents bigint);
      CREATE TABLE food_customer_wallet_holds(id bigint PRIMARY KEY, account_id bigint, currency_code text,
        amount_cents bigint, status text, expires_at timestamptz, created_at timestamptz);
      INSERT INTO users VALUES ('${user}','Synthetic','User','synthetic@example.com'),('${stranger}','Stranger','User','stranger@example.com');
      INSERT INTO food_restaurants VALUES (1,'Synthetic restaurant');
      INSERT INTO food_customer_wallet_accounts VALUES (1,'${user}',1,'USD','2020-01-01');
      INSERT INTO food_customer_wallet_ledger VALUES
        (0,1,'USD','2026-07-15T12:00:00Z',0,'credit','Opening balance',10000,10000),
        (1,1,'USD','2026-08-05T12:00:00Z',1,'credit','Top up',5000,15000),
        (2,1,'USD','2026-08-10T12:00:00Z',2,'debit','Lunch',6500,8500);`);
    service = createService({ db, jobs: require('../services/statementExportJobService') });
  }, 30000);
  afterAll(async () => {
    await db?.end();
    if (OFX_SCHEMA) await root.query(`DROP SCHEMA ${OFX_SCHEMA} CASCADE`);
    await root?.end();
  }, 30000);

  test('accounting OFX happy path: authorized scope, correct signs, single currency', async () => {
    const result = await service.accountingExport(user, {
      product: 'restaurant', restaurantId: 1, currencyCode: 'USD',
      from: '2026-08-01', to: '2026-08-15', format: 'ofx',
    });
    expect(result.mediaType).toBe('application/x-ofx');
    expect(result.filename).toMatch(/\.ofx$/);
    expect(result.currency).toBe('USD');
    expect(result.content).toContain('<TRNAMT>50.00</TRNAMT>');
    expect(result.content).toContain('<TRNAMT>-65.00</TRNAMT>');
    expect(result.content).toContain('<BALAMT>85.00</BALAMT>');
    expect(result.content).toContain('<CURDEF>USD</CURDEF>');
    expect(result.transactionCount).toBe(2);
  });

  test('accounting export refuses other users scopes', async () => {
    await expect(service.accountingExport(stranger, {
      product: 'restaurant', restaurantId: 1, currencyCode: 'USD',
      from: '2026-08-01', to: '2026-08-15', format: 'qfx',
    })).rejects.toMatchObject({ code: 'statement_export_not_found' });
  });

  test('packageJobs fails closed when a job is not complete', async () => {
    const jobs = {
      requireJob: jest.fn(async () => ({ id: 'job-1', product: 'restaurant', state: 'rendering', period: { from: '2026-08-01', to: '2026-08-31' } })),
      manifest: jest.fn(), download: jest.fn(),
    };
    const svc = createService({ db, jobs });
    await expect(svc.packageJobs(user, ['job-1'])).rejects.toMatchObject({ code: 'statement_export_not_ready' });
    expect(jobs.download).not.toHaveBeenCalled();
  });

  test('packageJobs zips verified bytes of complete jobs', async () => {
    const payload = Buffer.from('a,b,c\n1,2,3\n');
    const jobs = {
      requireJob: jest.fn(async () => ({ id: 'job-1', product: 'restaurant', state: 'complete', period: { from: '2026-08-01', to: '2026-08-31' } })),
      manifest: jest.fn(async () => ({
        complete: true, period: { from: '2026-08-01', to: '2026-08-31' },
        files: [{ id: 'file-1', kind: 'csv', part: 1 }],
      })),
      download: jest.fn(async () => ({ stream: Readable.from(payload), file: { id: 'file-1' } })),
    };
    const svc = createService({ db, jobs });
    // Stored (uncompressed) entries keep the payload bytes literal in the
    // archive so the test can assert the verified bytes shipped.
    const { archive, filename } = await svc.packageJobs(user, ['job-1'], (format) => archiver(format, { zlib: { level: 0 } }));
    const chunks = [];
    await new Promise((resolve, reject) => {
      archive.on('data', (c) => chunks.push(c));
      archive.on('end', resolve);
      archive.on('error', reject);
      archive.pipe(new PassThrough());
    });
    const zip = Buffer.concat(chunks);
    expect(filename).toMatch(/\.zip$/);
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zip.includes(payload)).toBe(true);
    expect(jobs.download).toHaveBeenCalledWith('job-1', 'file-1', user);
  });

  test('export history reads the existing job records', async () => {
    await db.query(`CREATE TABLE statement_export_jobs(id uuid PRIMARY KEY, requested_by uuid NOT NULL,
      product text NOT NULL, currency_code text NOT NULL, period_from date NOT NULL, period_to date NOT NULL,
      format text NOT NULL, language text NOT NULL, state text NOT NULL, error_code text,
      row_count bigint, rows_rendered bigint NOT NULL DEFAULT 0, manifest jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);`);
    const manifest = { complete: true, files: [{ id: 'f1', kind: 'csv', part: 1, rowFrom: 1, rowTo: 2, byteLength: 10 }] };
    await db.query(`INSERT INTO statement_export_jobs
      (id, requested_by, product, currency_code, period_from, period_to, format, language, state, row_count, manifest, completed_at)
      VALUES ($1,$2,'restaurant','USD','2026-08-01','2026-08-31','csv','en','complete',2,$3,now())`,
    [crypto.randomUUID(), user, JSON.stringify(manifest)]);
    const history = await service.exportHistory(user, { page: 1, pageSize: 20 });
    expect(history.total).toBe(1);
    expect(history.jobs[0]).toMatchObject({ product: 'restaurant', format: 'csv', state: 'complete', rowsTotal: 2 });
    expect(history.jobs[0].files[0].downloadUrl).toContain('/api/statements/exports/');
    expect(history.jobs[0].files[0].id).toBe('f1');
    const strangerHistory = await service.exportHistory(stranger, {});
    expect(strangerHistory.total).toBe(0);
  });
});
