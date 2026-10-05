'use strict';

/**
 * Behavior tests for the statement issuance job infrastructure (migration 683).
 *
 * These tests run against the disposable `credit_statement_test` database only
 * (see scripts/credit-isolated-env.sh); they exercise real DB behavior —
 * leases, fencing, backoff, outbox claims — with no source-text assertions.
 */

jest.unmock('pg');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// NOTE: jest setupFiles (__tests__/setup.js) overwrites process.env.DATABASE_URL
// with a mock dummy before this file loads, so the disposable database URL is
// taken from STATEMENT_JOB_TEST_DATABASE_URL instead. Run with e.g.
//   STATEMENT_JOB_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/credit_statement_test?sslmode=disable \
//     npx jest __tests__/statementJobService.test.js
// Without it, the DB describes skip (fail closed) instead of touching a DB.
const { disposableDatabaseOptIn, isDisposableDatabase, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('STATEMENT_JOB_TEST_DATABASE_URL');
const DISPOSABLE_URL = RAW_URL;


// Fail closed: the suite only runs against the disposable database. Under a
// plain `npm test` (mock setup dummy URL) it skips instead of touching a DB.
const CAN_RUN_DB = isDisposableDatabase(DISPOSABLE_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  if (!CAN_RUN_DB) {
    // eslint-disable-next-line no-console
    console.log('statementJobService DB tests skipped: set STATEMENT_JOB_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase('postgresql://postgres@127.0.0.1:54329/credit_statement_test?sslmode=disable')).toBe(true);
  expect(isDisposableDatabase('postgresql://testuser:testpass@localhost:5432/testdb')).toBe(false);
  expect(isDisposableDatabase('postgresql://prod.example.com/credit_statement_test')).toBe(false);
  expect(isDisposableDatabase(DISPOSABLE_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
process.env.DATABASE_URL = DISPOSABLE_URL;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
}

const service = require('../services/statementJobService');
const pool = require('../db');

const PERIOD = { from: '2026-09-01', to: '2026-09-30' };

async function newUser() {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'synthetic-unusable-hash', 'Statement', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `${id}@example.invalid`]
  );
  return id;
}

let accountSeq = 410000;
async function newRun(product = 'oxsteed') {
  return service.createRun({ product, periodFrom: PERIOD.from, periodTo: PERIOD.to });
}

function accountFor(customerId, overrides = {}) {
  accountSeq += 1;
  return {
    customerId,
    product: 'oxsteed',
    accountId: accountSeq,
    currencyCode: 'USD',
    ...overrides,
  };
}

async function expireLease(jobId) {
  await pool.query(
    `UPDATE statement_account_jobs
     SET lease_expires_at = transaction_timestamp() - interval '1 second'
     WHERE id = $1`, [jobId]);
}

async function jobState(jobId) {
  const { rows: [job] } = await pool.query(
    'SELECT * FROM statement_account_jobs WHERE id = $1', [jobId]);
  return job;
}

// Claims are global across runs, so each behavior test starts by draining any
// claimable leftovers from earlier tests into dead_letter (their assertions
// already ran; per-run stats are unaffected).
async function drainClaimableJobs() {
  for (let i = 0; i < 200; i += 1) {
    const job = await service.claimNextAccountJob('test-drain');
    if (!job) return;
    if (job.state === 'leased') {
      await service.failJob(job.id, 'test-drain', job.fencing_token, 'test drain', false);
    }
  }
  throw new Error('test drain did not converge');
}

beforeEach(async () => {
  if (CAN_RUN_DB) await drainClaimableJobs();
});

beforeAll(async () => { if (CAN_RUN_DB) await assertMigratedSchema(pool); });

ddescribe('migration 683 rehearsal (idempotent re-apply on the disposable DB)', () => {
  test('683 SQL applies cleanly and creates the expected objects', async () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '683_statement_issuance_jobs.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS statement_issuance_runs');
    await pool.query(sql); // must not raise on re-application
    const { rows: tables } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('statement_issuance_runs', 'statement_account_jobs', 'statement_outbox')`);
    expect(tables.map((row) => row.table_name).sort()).toEqual(
      ['statement_account_jobs', 'statement_issuance_runs', 'statement_outbox']);
    const { rows: states } = await pool.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'statement_account_jobs'::regclass AND contype = 'c'`);
    expect(states.map((row) => row.conname)).toContain('statement_account_jobs_state_check');
    const { rows: indexes } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'statement_outbox' AND indexname = 'statement_outbox_unprocessed'`);
    expect(indexes).toHaveLength(1);
    const { rows: unique } = await pool.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'statement_account_jobs'::regclass AND contype = 'u'`);
    expect(unique.map((row) => row.conname)).toContain('statement_account_jobs_issuance_key_key');
  });
});

ddescribe('claim exclusivity', () => {
  test('two workers racing for two jobs each get a different job', async () => {
    const run = await newRun();
    const customer = await newUser();
    const inserted = await service.discoverAccountJobs(run.id,
      [accountFor(customer), accountFor(customer)]);
    expect(inserted).toBe(2);
    const [first, second] = await Promise.all([
      service.claimNextAccountJob('worker-a'),
      service.claimNextAccountJob('worker-b'),
    ]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first.id).not.toBe(second.id);
    expect(first.lease_owner).not.toBe(second.lease_owner);
  });

  test('a second worker cannot claim the one remaining job', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer)]);
    const first = await service.claimNextAccountJob('worker-a');
    expect(first).not.toBeNull();
    expect(first.state).toBe('leased');
    expect(String(first.fencing_token)).toBe('1');
    const second = await service.claimNextAccountJob('worker-b');
    expect(second).toBeNull();
  });
});

ddescribe('lease expiry and fencing', () => {
  test('an expired lease can be reclaimed; the stale worker is fenced out', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer)]);
    const claimed = await service.claimNextAccountJob('worker-a', 120);
    await expireLease(claimed.id);

    const reclaimed = await service.claimNextAccountJob('worker-b', 120);
    expect(reclaimed).not.toBeNull();
    expect(reclaimed.id).toBe(claimed.id);
    expect(reclaimed.lease_owner).toBe('worker-b');
    expect(String(reclaimed.fencing_token)).toBe('2');

    // worker-a still holds the old fencing token: every mutation is rejected.
    await expect(service.renewLease(claimed.id, 'worker-a', 1, 120))
      .rejects.toMatchObject({ code: 'statement_lease_stale', statusCode: 409 });
    await expect(service.completeJobStage(claimed.id, 'worker-a', 1, 'snapshotted'))
      .rejects.toMatchObject({ code: 'statement_lease_stale' });
    await expect(service.failJob(claimed.id, 'worker-a', 1, 'boom'))
      .rejects.toMatchObject({ code: 'statement_lease_stale' });

    // worker-b with the current token can renew and advance.
    const renewed = await service.renewLease(reclaimed.id, 'worker-b', 2, 300);
    expect(new Date(renewed.lease_expires_at).getTime())
      .toBeGreaterThan(new Date(reclaimed.lease_expires_at).getTime());
    const advanced = await service.completeJobStage(reclaimed.id, 'worker-b', 2, 'snapshotted');
    expect(advanced.state).toBe('snapshotted');
  });

  test('a wrong fencing token is rejected even by the lease owner name', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer)]);
    const claimed = await service.claimNextAccountJob('worker-a');
    await expect(service.renewLease(claimed.id, 'worker-a', 999, 120))
      .rejects.toMatchObject({ code: 'statement_lease_stale', statusCode: 409 });
  });

  test('renews a lease throughout every active pipeline state', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer)]);
    let job = await service.claimNextAccountJob('worker-a', 120);

    for (const state of ['leased', 'snapshotted', 'artifact_ready', 'notified']) {
      const previousExpiry = new Date(job.lease_expires_at).getTime();
      job = await service.renewLease(job.id, 'worker-a', 1, 300);
      expect(job.state).toBe(state);
      expect(new Date(job.lease_expires_at).getTime()).toBeGreaterThan(previousExpiry);

      const nextState = {
        leased: 'snapshotted',
        snapshotted: 'artifact_ready',
        artifact_ready: 'notified',
      }[state];
      if (nextState) {
        job = await service.completeJobStage(job.id, 'worker-a', 1, nextState);
      }
    }
  });

  test('rejects renewal after the current lease expires', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer)]);
    const claimed = await service.claimNextAccountJob('worker-a', 120);
    await expireLease(claimed.id);

    await expect(service.renewLease(claimed.id, 'worker-a', 1, 120))
      .rejects.toMatchObject({ code: 'statement_lease_stale', statusCode: 409 });
  });
});

ddescribe('deterministic issuance keys dedupe re-discovery', () => {
  test('repeated discovery inserts no duplicate jobs', async () => {
    const run = await newRun();
    const customer = await newUser();
    const accounts = [accountFor(customer), accountFor(customer, { currencyCode: 'EUR' })];
    expect(await service.discoverAccountJobs(run.id, accounts)).toBe(2);
    expect(await service.discoverAccountJobs(run.id, accounts)).toBe(0);
    expect(await service.discoverAccountJobs(run.id, accounts)).toBe(0);
    const stats = await service.getRunStats(run.id);
    expect(stats.expected).toBe(2);
    const { rows } = await pool.query(
      `SELECT issuance_key FROM statement_account_jobs WHERE run_id = $1 ORDER BY issuance_key`, [run.id]);
    expect(rows[0].issuance_key).toBe(
      `stmt:v1:oxsteed:${accounts[0].accountId}:USD:${PERIOD.from}:${PERIOD.to}:${customer}`);
    expect(rows[1].issuance_key).toBe(
      `stmt:v1:oxsteed:${accounts[1].accountId}:EUR:${PERIOD.from}:${PERIOD.to}:${customer}`);
  });

  test('duplicate accounts within one discovery batch insert once', async () => {
    const run = await newRun();
    const customer = await newUser();
    const account = accountFor(customer);
    expect(await service.discoverAccountJobs(run.id, [account, { ...account }])).toBe(1);
  });
});

ddescribe('stage progression and run stats', () => {
  test('a job walks the full stage ladder to complete', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer)]);
    const claimed = await service.claimNextAccountJob('worker-a');
    let job = claimed;
    for (const stage of ['snapshotted', 'artifact_ready', 'notified', 'complete']) {
      job = await service.completeJobStage(job.id, 'worker-a', 1, stage);
      expect(job.state).toBe(stage);
    }
    const stats = await service.getRunStats(run.id);
    expect(stats).toMatchObject({ expected: 1, issued: 1, failed: 0, deadLetter: 0, activeLeases: 0 });
  });

  test('skipping stages is rejected', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer)]);
    const claimed = await service.claimNextAccountJob('worker-a');
    await expect(service.completeJobStage(claimed.id, 'worker-a', 1, 'complete'))
      .rejects.toMatchObject({ code: 'statement_job_invalid_transition', statusCode: 409 });
    await expect(service.completeJobStage(claimed.id, 'worker-a', 1, 'pending'))
      .rejects.toMatchObject({ code: 'statement_job_invalid_transition' });
  });
});

ddescribe('backoff is bounded and attempts exhaust to dead_letter', () => {
  test('computeBackoffMs stays within [base/2, base] then caps at 6h', () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const delay = service.computeBackoffMs(attempt);
      const grown = Math.min(service.BACKOFF_CAP_MS, service.BACKOFF_BASE_MS * 2 ** (attempt - 1));
      expect(delay).toBeGreaterThanOrEqual(Math.floor(grown / 2));
      expect(delay).toBeLessThanOrEqual(grown);
    }
    expect(service.computeBackoffMs(100)).toBeLessThanOrEqual(service.BACKOFF_CAP_MS);
    expect(service.computeBackoffMs(100)).toBeGreaterThanOrEqual(service.BACKOFF_CAP_MS / 2);
  });

  test('a retryable failure schedules bounded backoff and becomes claimable again', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer, { maxAttempts: 3 })]);
    const claimed = await service.claimNextAccountJob('worker-a');
    const before = Date.now();
    const failed = await service.failJob(claimed.id, 'worker-a', 1, 'transient export error', true);
    expect(failed.state).toBe('failed');
    expect(failed.last_error).toBe('transient export error');
    const retryInMs = new Date(failed.next_retry_at).getTime() - before;
    expect(retryInMs).toBeGreaterThanOrEqual(25000);
    expect(retryInMs).toBeLessThanOrEqual(70000);
    // Not claimable while the backoff window is open...
    expect(await service.claimNextAccountJob('worker-b')).toBeNull();
    // ...but becomes claimable once the window elapses.
    await pool.query(
      `UPDATE statement_account_jobs SET next_retry_at = transaction_timestamp() - interval '1 second'
       WHERE id = $1`, [claimed.id]);
    const retried = await service.claimNextAccountJob('worker-b');
    expect(retried).not.toBeNull();
    expect(retried.id).toBe(claimed.id);
    expect(String(retried.attempt_count)).toBe('2');
  });

  test('exhausting max_attempts moves the job to dead_letter', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer, { maxAttempts: 1 })]);
    const claimed = await service.claimNextAccountJob('worker-a');
    const dead = await service.failJob(claimed.id, 'worker-a', 1, 'still broken', true);
    expect(dead.state).toBe('dead_letter');
    expect(dead.next_retry_at).toBeNull();
    expect(await service.claimNextAccountJob('worker-b')).toBeNull();
    const stats = await service.getRunStats(run.id);
    expect(stats).toMatchObject({ expected: 1, failed: 0, deadLetter: 1 });
  });

  test('a non-retryable failure goes straight to dead_letter', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer, { maxAttempts: 8 })]);
    const claimed = await service.claimNextAccountJob('worker-a');
    const dead = await service.failJob(claimed.id, 'worker-a', 1, 'corrupt ledger snapshot', false);
    expect(dead.state).toBe('dead_letter');
  });

  test('an expired lease with no attempt budget left is dead-lettered on claim', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer, { maxAttempts: 1 })]);
    const claimed = await service.claimNextAccountJob('worker-a');
    await expireLease(claimed.id); // worker-a died without reporting
    const result = await service.claimNextAccountJob('worker-b');
    expect(result).not.toBeNull();
    expect(result.id).toBe(claimed.id);
    expect(result.state).toBe('dead_letter');
    expect(await jobState(claimed.id).then((job) => job.lease_owner)).toBeNull();
  });
});

ddescribe('transactional outbox is exactly once', () => {
  async function appendEvent(overrides = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const event = await service.outboxAppend(client, {
        eventType: 'statement.issued',
        aggregateType: 'statement_account_job',
        aggregateId: crypto.randomUUID(),
        payload: { runId: crypto.randomUUID(), scope: 'oxsteed/USD' },
        ...overrides,
      });
      await client.query('COMMIT');
      return event;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  test('append, claim, and process deliver an event exactly once', async () => {
    const event = await appendEvent();
    const first = await service.claimOutboxEvents(50, 'worker-a');
    expect(first.map((row) => row.id)).toContain(event.id);
    expect(first.find((row) => row.id === event.id).payload.scope).toBe('oxsteed/USD');
    // A second worker sees nothing while the event is claimed.
    expect(await service.claimOutboxEvents(50, 'worker-b')).toHaveLength(0);
    await service.markOutboxProcessed(event.id);
    // Processed events are never redelivered.
    expect(await service.claimOutboxEvents(50, 'worker-b')).toHaveLength(0);
  });

  test('a failed event is released and redelivered, then processed', async () => {
    const event = await appendEvent({ eventType: 'statement.export_ready' });
    const claimed = await service.claimOutboxEvents(50, 'worker-a');
    expect(claimed.map((row) => row.id)).toContain(event.id);
    await service.outboxFailed(event.id);
    const redelivered = await service.claimOutboxEvents(50, 'worker-b');
    const again = redelivered.find((row) => row.id === event.id);
    expect(again).toBeDefined();
    expect(again.attempt_count).toBeGreaterThan(1);
    await service.markOutboxProcessed(event.id);
    expect(await service.claimOutboxEvents(50, 'worker-a')).toHaveLength(0);
  });

  test('outboxAppend validates its inputs', async () => {
    const client = await pool.connect();
    try {
      await expect(service.outboxAppend(client, {
        eventType: '', aggregateType: 't', aggregateId: 'a', payload: {},
      })).rejects.toMatchObject({ code: 'statement_outbox_invalid' });
      await expect(service.outboxAppend(client, {
        eventType: 't', aggregateType: 't', aggregateId: 'a', payload: [1],
      })).rejects.toMatchObject({ code: 'statement_outbox_invalid' });
    } finally {
      client.release();
    }
  });

  test('claims are ordered oldest first and respect the limit', async () => {
    const first = await appendEvent();
    const second = await appendEvent();
    const claimed = await service.claimOutboxEvents(1, 'worker-a');
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(first.id);
    await service.markOutboxProcessed(first.id);
    await service.markOutboxProcessed(second.id);
  });
});

ddescribe('pause and resume gate claims', () => {
  test('paused runs yield no jobs; resumed runs yield them again', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer)]);
    const paused = await service.pauseRun(run.id);
    expect(paused.state).toBe('paused');
    expect(await service.claimNextAccountJob('worker-a')).toBeNull();
    const resumed = await service.resumeRun(run.id);
    expect(resumed.state).toBe('discovering');
    const claimed = await service.claimNextAccountJob('worker-a');
    expect(claimed).not.toBeNull();
    expect(claimed.run_id).toBe(run.id);
  });

  test('pausing twice is rejected', async () => {
    const run = await newRun();
    await service.pauseRun(run.id);
    await expect(service.pauseRun(run.id))
      .rejects.toMatchObject({ code: 'statement_run_state' });
    await service.resumeRun(run.id);
  });
});

ddescribe('run lifecycle validation', () => {
  test('createRun rejects bad product and inverted periods', async () => {
    await expect(service.createRun({ product: 'nope', periodFrom: PERIOD.from, periodTo: PERIOD.to }))
      .rejects.toMatchObject({ code: 'statement_job_invalid_product' });
    await expect(service.createRun({ product: 'oxsteed', periodFrom: PERIOD.to, periodTo: PERIOD.from }))
      .rejects.toMatchObject({ code: 'statement_job_invalid_period' });
    await expect(service.createRun({ product: 'oxsteed', periodFrom: 'not-a-date', periodTo: PERIOD.to }))
      .rejects.toMatchObject({ code: 'statement_job_invalid_period' });
  });

  test('stats report queue age and active leases', async () => {
    const run = await newRun();
    const customer = await newUser();
    await service.discoverAccountJobs(run.id, [accountFor(customer), accountFor(customer)]);
    await service.claimNextAccountJob('worker-a');
    const stats = await service.getRunStats(run.id);
    expect(stats.expected).toBe(2);
    expect(stats.activeLeases).toBe(1);
    expect(stats.oldestQueueAgeSec).toBeGreaterThanOrEqual(0);
  });
});

afterAll(async () => {
  await pool.end();
});
