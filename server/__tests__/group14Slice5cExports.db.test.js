'use strict';

// Group 14 Slice 5c acceptance: export records (711-715).
//   711 Report export request: POST creates a job (202 + id, Idempotency-Key),
//       bulk creates one job per item, accounting export is scope-authorized.
//   712 Export progress: GET /:jobId reports the job state per state.
//   713 Permission-aware download: file downloads re-authorize per file;
//       the bulk ZIP re-authorizes every job and fails closed on any job
//       that is not complete.
//   714 Export history: GET / lists only the caller's jobs, newest first,
//       paginated, with working retry/cancel.
//   715 Expired report recovery (the build, D-429): export files expire 30
//       days after the job completes. A completed job past its expiry
//       reports state `expired`; its file links are refused; the bulk
//       packager fails closed on it; recovery is re-issue (a new job with
//       the same parameters and a new idempotency key).
// Group 14 is READ-ONLY (D-408): nothing here moves money.
// Runs against a dedicated fresh database (credit_statement_test_g14c).

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
jest.mock('../middleware/rateLimiter', () => ({
  creditExportLimiter: (_req, _res, next) => next(),
  authenticatedLimiter: (_req, _res, next) => next(),
}));

const crypto = require('crypto');
const { Readable } = require('node:stream');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP14_SLICE5C_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g14c') {
    throw new Error('Group 14 Slice 5c DB tests require the loopback credit_statement_test_g14c database');
  }
  process.env.DATABASE_URL = dbUrl;
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'test-secret';

jest.setTimeout(120000);

const describeDb = dbUrl ? describe : describe.skip;
const runId = crypto.randomUUID().slice(0, 8);
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };

// In-memory private storage: the export worker's upload/verify round trip
// without any real bucket.
function fakeStorage() {
  const objects = new Map();
  return {
    objects,
    async assertPrivate() { return { bucket: 'test-bucket' }; },
    async uploadFile({ filePath, objectKey }) {
      const fs = require('node:fs');
      objects.set(objectKey, await fs.promises.readFile(filePath));
    },
    async getObjectStream(objectKey) {
      const bytes = objects.get(objectKey);
      return bytes ? Readable.from([bytes]) : null;
    },
  };
}

// A zero-transaction statement header: the worker completes a CSV export
// over an empty period without any real ledger rows.
function fakeMaterialize(_client, job) {
  return {
    id: 'synthetic-5c', product: job.product, kind: 'monthly', ownerName: 'Test Fixture',
    accountLabel: 'Test', accountReference: 'T-0001', currencyCode: job.currency_code,
    period: { from: String(job.period_from).slice(0, 10), to: String(job.period_to).slice(0, 10) },
    generatedAt: new Date().toISOString(), openingBalanceCents: 0, closingBalanceCents: 0,
    totalCreditsCents: 0, totalDebitsCents: 0, transactionCount: 0, transactions: [],
    holds: [], holdsAsOf: null, totalHeldCents: 0, contentHash: 'a'.repeat(64),
  };
}

describeDb('Group 14 Slice 5c: export records (711-715)', () => {
  let pool;
  let app;
  let jobService;
  let notified;
  let owner;
  let stranger;

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const authAs = (user, req) => req.set('Authorization', `Bearer ${tokenFor(user)}`);
  const getAs = (user, path) => authAs(user, request(app).get(path));
  const postAs = (user, path, body) => authAs(user, request(app).post(path).send(body || {}));
  const exportInput = (overrides = {}) => ({
    product: 'helper_earnings', currencyCode: 'USD',
    from: PERIOD.from, to: PERIOD.to, format: 'csv', language: 'en', ...overrides,
  });

  async function makeUser() {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', 'customer', TRUE, TRUE)`,
      [id, `t5c-${id}@example.invalid`],
    );
    return { id, role: 'customer' };
  }

  // Seed a job row directly (bypasses the worker) for state-shape checks.
  async function seedJob(userId, state, extra = {}) {
    const id = crypto.randomUUID();
    const manifest = state === 'complete'
      ? { contract: 'statement-export-manifest-v1', id, complete: true, product: 'helper_earnings',
        currencyCode: 'USD', period: PERIOD, cutoffAt: new Date().toISOString(), rowCount: 0,
        openingMinor: '0', closingMinor: '0', creditsMinor: '0', debitsMinor: '0',
        sourceHash: 'a'.repeat(64), byteLength: 0, fileCount: 0, format: 'csv', language: 'en',
        holdsUnavailable: true, files: [] }
      : null;
    const { rows: [row] } = await pool.query(
      `INSERT INTO statement_export_jobs
         (id, requested_by, product, account_id, scope_id, currency_code, period_from, period_to,
          format, language, idempotency_key, request_hash, state, attempts, manifest,
          completed_at, error_code, row_count, source_hash, frozen_header, frozen_at)
       VALUES ($1,$2,'helper_earnings',$3,$4,'USD',$5,$6,'csv','en',$7,$8,$9,0,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [id, userId, userId, userId, PERIOD.from, PERIOD.to, `seed-${runId}-${id.slice(0, 8)}`,
        crypto.createHash('sha256').update(id).digest('hex'), state,
        manifest ? JSON.stringify(manifest) : null,
        state === 'complete' ? new Date() : null,
        extra.errorCode || null,
        state === 'complete' ? 0 : null,
        state === 'complete' ? 'a'.repeat(64) : null,
        state === 'complete' ? JSON.stringify({ generatedAt: new Date().toISOString(), transactionCount: 0 }) : null,
        state === 'complete' ? new Date() : null],
    );
    return row;
  }

  // Drive a real job to complete through the worker (fake storage/materialize).
  // Earlier tests leave pending jobs behind; cancel them first so claim()
  // picks the job this helper just created.
  async function completeJobViaWorker(input, key) {
    const created = await jobService.request(owner.id, input, key);
    await pool.query(
      `UPDATE statement_export_jobs SET state='cancelled', updated_at=now()
        WHERE requested_by=$1 AND state IN ('pending','freezing','rendering') AND id<>$2`,
      [owner.id, created.id]);
    const claimed = await jobService.claim();
    expect(claimed?.id).toBe(created.id);
    await jobService.process(claimed);
    const { rows: [row] } = await pool.query('SELECT * FROM statement_export_jobs WHERE id=$1', [created.id]);
    expect(row.state).toBe('complete');
    return { job: created, row };
  }

  beforeAll(async () => {
    pool = require('../db');
    owner = await makeUser();
    stranger = await makeUser();
    notified = [];
    const storage = fakeStorage();
    jobService = require('../services/statementExportJobService').createService({
      db: pool, storage, materialize: fakeMaterialize,
      // The worker refuses to render unless 768MB is free in os.tmpdir();
      // this VM's /tmp tmpfs is 512MB, so the check is stubbed to pass.
      diskCheck: async () => 1024 * 1024 * 1024,
      notify: async (args) => { notified.push(args); return { success: true }; },
    });
    const bulkService = require('../services/statementExportService').createService({ db: pool, jobs: jobService });
    const { createRouter } = require('../routes/statementExports');
    app = express();
    app.use(express.json());
    app.use('/api/statements/exports', createRouter(jobService, { bulk: bulkService }));
  });

  afterAll(async () => { if (pool) await pool.end(); });

  // 711: report export request.
  test('711: request creates a job, replays the idempotency key, and conflicts on a changed request', async () => {
    const key = `g14c-711-${runId}-${crypto.randomUUID()}`;
    const first = await postAs(owner, '/api/statements/exports', exportInput()).set('Idempotency-Key', key).expect(202);
    expect(first.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.body.data.state).toBe('pending');
    const replay = await postAs(owner, '/api/statements/exports', exportInput()).set('Idempotency-Key', key).expect(202);
    expect(replay.body.data.id).toBe(first.body.data.id);
    await postAs(owner, '/api/statements/exports', exportInput({ to: '2026-09-15' })).set('Idempotency-Key', key).expect(409);
    await postAs(owner, '/api/statements/exports', exportInput()).expect(400);
  });

  test('711: bulk creates one job per item and accounting rejects an unknown product', async () => {
    const bulk = await postAs(owner, '/api/statements/exports/bulk', {
      items: [exportInput(), exportInput({ format: 'pdf' })],
    }).set('Idempotency-Key', `g14c-bulk-${runId}-${crypto.randomUUID()}`).expect(202);
    expect(bulk.body.data.jobs).toHaveLength(2);
    expect(bulk.body.data.jobs[0].id).not.toBe(bulk.body.data.jobs[1].id);
    await postAs(owner, '/api/statements/exports/accounting', { product: 'nope', format: 'ofx' }).expect(400);
  });

  test('711: a stranger cannot read another user\'s job and anonymous callers get 401', async () => {
    const key = `g14c-711-scope-${runId}-${crypto.randomUUID()}`;
    const created = await postAs(owner, '/api/statements/exports', exportInput()).set('Idempotency-Key', key).expect(202);
    await getAs(stranger, `/api/statements/exports/${created.body.data.id}`).expect(404);
    await request(app).get(`/api/statements/exports/${created.body.data.id}`).expect(401);
  });

  // 712: export progress.
  test('712: status reports pending, complete, failed, and cancelled states', async () => {
    const key = `g14c-712-${runId}-${crypto.randomUUID()}`;
    const pending = await postAs(owner, '/api/statements/exports', exportInput()).set('Idempotency-Key', key).expect(202);
    expect((await getAs(owner, `/api/statements/exports/${pending.body.data.id}`).expect(200)).body.data.state).toBe('pending');
    for (const state of ['complete', 'failed', 'cancelled']) {
      const seeded = await seedJob(owner.id, state);
      const seen = await getAs(owner, `/api/statements/exports/${seeded.id}`).expect(200);
      expect(seen.body.data.state).toBe(state);
      // Seeded rows carry attempts 0 (< 5), so failed/cancelled jobs can
      // retry; a complete job never can.
      expect(seen.body.data.canRetry).toBe(state !== 'complete');
    }
  });

  // 713: permission-aware download.
  test('713: the owner downloads the completed file, a stranger gets 404, and the bulk package is a ZIP', async () => {
    const { job } = await completeJobViaWorker(exportInput(), `g14c-713-${runId}-${crypto.randomUUID()}`);
    const manifest = await getAs(owner, `/api/statements/exports/${job.id}/manifest`).expect(200);
    expect(manifest.body.data.files).toHaveLength(1);
    const file = manifest.body.data.files[0];
    const download = await getAs(owner, `/api/statements/exports/${job.id}/files/${file.id}`)
      .buffer(true).parse((res, done) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      }).expect(200);
    expect(Buffer.isBuffer(download.body) ? download.body.length : 0).toBe(file.byteLength);
    expect(crypto.createHash('sha256').update(download.body).digest('hex')).toBe(file.sha256);
    await getAs(stranger, `/api/statements/exports/${job.id}/files/${file.id}`).expect(404);
    await request(app).get(`/api/statements/exports/${job.id}/files/${file.id}`).expect(401);
    const packaged = await postAs(owner, '/api/statements/exports/bulk/package', { jobIds: [job.id] })
      .buffer(true).parse((res, done) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      }).expect(200);
    expect(packaged.headers['content-type']).toMatch(/application\/zip/);
    expect(packaged.body.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  test('713: the bulk package fails closed on a job that is not complete', async () => {
    const key = `g14c-713-pending-${runId}-${crypto.randomUUID()}`;
    const pending = await postAs(owner, '/api/statements/exports', exportInput()).set('Idempotency-Key', key).expect(202);
    const attempt = await postAs(owner, '/api/statements/exports/bulk/package', { jobIds: [pending.body.data.id] }).expect(409);
    expect(attempt.body.code || attempt.body.error?.code || 'statement_export_not_ready').toBeDefined();
  });

  // 714: export history.
  test('714: history lists only the caller\'s jobs, newest first, with working retry and cancel', async () => {
    const first = await postAs(owner, '/api/statements/exports', exportInput()).set('Idempotency-Key', `g14c-714-a-${runId}`).expect(202);
    const second = await postAs(owner, '/api/statements/exports', exportInput()).set('Idempotency-Key', `g14c-714-b-${runId}`).expect(202);
    const failed = await seedJob(owner.id, 'failed', { errorCode: 'statement_export_failed' });
    const strangerJob = await seedJob(stranger.id, 'complete');
    const history = await getAs(owner, '/api/statements/exports?page=1&pageSize=20').expect(200);
    const ids = history.body.data.jobs.map((item) => item.id);
    expect(ids).toContain(first.body.data.id);
    expect(ids).toContain(second.body.data.id);
    expect(ids).toContain(failed.id);
    expect(ids).not.toContain(strangerJob.id);
    expect(ids.indexOf(second.body.data.id)).toBeLessThan(ids.indexOf(first.body.data.id));
    expect(history.body.data.jobs.every((item) => ids.includes(item.id))).toBe(true);
    const retried = await postAs(owner, `/api/statements/exports/${failed.id}/retry`).expect(202);
    expect(retried.body.data.state).toBe('pending');
    const cancelled = await postAs(owner, `/api/statements/exports/${first.body.data.id}/cancel`).expect(200);
    expect(cancelled.body.data.state).toBe('cancelled');
    const page = await getAs(owner, '/api/statements/exports?page=1&pageSize=1').expect(200);
    expect(page.body.data.jobs).toHaveLength(1);
    expect(page.body.data.total).toBeGreaterThanOrEqual(3);
  });

  // 715: expired report recovery (D-429).
  test('715: completion stamps expires_at 30 days after completion', async () => {
    const { row } = await completeJobViaWorker(exportInput(), `g14c-715-complete-${runId}-${crypto.randomUUID()}`);
    expect(row.completed_at).not.toBeNull();
    expect(row.expires_at).not.toBeNull();
    const gapMs = new Date(row.expires_at).getTime() - new Date(row.completed_at).getTime();
    expect(gapMs).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000 - 120000);
    expect(gapMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 120000);
    const seen = await getAs(owner, `/api/statements/exports/${row.id}`).expect(200);
    expect(seen.body.data.state).toBe('complete');
    expect(seen.body.data.expiresAt).toBeTruthy();
  });

  test('715: a completed job past its expiry reports expired and its file links are refused', async () => {
    const { job } = await completeJobViaWorker(exportInput(), `g14c-715-expired-${runId}-${crypto.randomUUID()}`);
    await pool.query(`UPDATE statement_export_jobs SET expires_at = now() - interval '1 hour' WHERE id=$1`, [job.id]);
    const seen = await getAs(owner, `/api/statements/exports/${job.id}`).expect(200);
    expect(seen.body.data.state).toBe('expired');
    expect(seen.body.data.canRetry).toBe(false);
    expect(seen.body.data.manifestUrl).toBeNull();
    await getAs(owner, `/api/statements/exports/${job.id}/manifest`).expect(409);
    const manifest = await pool.query('SELECT manifest FROM statement_export_jobs WHERE id=$1', [job.id]);
    const fileId = manifest.rows[0].manifest.files[0].id;
    await getAs(owner, `/api/statements/exports/${job.id}/files/${fileId}`).expect(409);
    await postAs(owner, '/api/statements/exports/bulk/package', { jobIds: [job.id] }).expect(409);
    const history = await getAs(owner, '/api/statements/exports?page=1&pageSize=100').expect(200);
    const listed = history.body.data.jobs.find((item) => item.id === job.id);
    expect(listed.state).toBe('expired');
    expect(listed.files).toBeNull();
    await getAs(stranger, `/api/statements/exports/${job.id}`).expect(404);
    await getAs(stranger, `/api/statements/exports/${job.id}/manifest`).expect(404);
  });

  test('715: re-issue creates a new job with the same parameters and a new idempotency key', async () => {
    const { job } = await completeJobViaWorker(exportInput(), `g14c-715-reissue-${runId}-${crypto.randomUUID()}`);
    await pool.query(`UPDATE statement_export_jobs SET expires_at = now() - interval '1 hour' WHERE id=$1`, [job.id]);
    expect((await getAs(owner, `/api/statements/exports/${job.id}`).expect(200)).body.data.state).toBe('expired');
    const reissued = await postAs(owner, '/api/statements/exports', exportInput()).set('Idempotency-Key', `g14c-715-new-${runId}-${crypto.randomUUID()}`).expect(202);
    expect(reissued.body.data.id).not.toBe(job.id);
    expect(reissued.body.data.state).toBe('pending');
    expect(reissued.body.data.product).toBe('helper_earnings');
    expect(reissued.body.data.currencyCode).toBe('USD');
    expect(reissued.body.data.period).toEqual(PERIOD);
    expect(reissued.body.data.format).toBe('csv');
  });

  test('715: notifications skip expired jobs and a job before expiry still reports complete', async () => {
    const { job } = await completeJobViaWorker(exportInput(), `g14c-715-notify-${runId}-${crypto.randomUUID()}`);
    await pool.query(`UPDATE statement_export_jobs SET expires_at = now() - interval '1 hour' WHERE id=$1`, [job.id]);
    notified.length = 0;
    await jobService.deliverNotifications();
    expect(notified.some((note) => note.data?.exportJobId === job.id)).toBe(false);
    const fresh = await completeJobViaWorker(exportInput(), `g14c-715-fresh-${runId}-${crypto.randomUUID()}`);
    const seen = await getAs(owner, `/api/statements/exports/${fresh.job.id}`).expect(200);
    expect(seen.body.data.state).toBe('complete');
    expect((await getAs(owner, `/api/statements/exports/${fresh.job.id}/manifest`).expect(200)).body.data.complete).toBe(true);
  });
});
