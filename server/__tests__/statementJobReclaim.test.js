'use strict';

/**
 * Behavior tests for reclaiming statement jobs stranded in intermediate
 * pipeline states (snapshotted/artifact_ready/notified) after worker loss.
 *
 * Runs against the disposable `credit_statement_test` database only.
 * Run with e.g.
 *   STATEMENT_JOB_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/credit_statement_test?sslmode=disable
 *     npx jest __tests__/statementJobReclaim.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_JOB_TEST_DATABASE_URL || '';

function isDisposableDatabase(urlText) {
  let url;
  try {
    url = new URL(urlText);
  } catch {
    return false;
  }
  const localhost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  return ['postgres:', 'postgresql:'].includes(url.protocol) && localhost
    && url.pathname === '/credit_statement_test';
}

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
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

function issuanceKey(customerId, n) {
  return `stmt:v1:oxsteed:${n}:USD:${PERIOD.from}:${PERIOD.to}:${customerId}`;
}

// Insert a job directly in an intermediate state with a controlled lease,
// simulating a worker that died mid-pipeline.
async function seedStrandedJob({ state, leaseExpired }) {
  const customerId = await newUser();
  const run = await service.createRun({ product: 'oxsteed', periodFrom: PERIOD.from, periodTo: PERIOD.to });
  const key = issuanceKey(customerId, Math.floor(Math.random() * 1e9) + 500000);
  const { rows: [job] } = await pool.query(
    `INSERT INTO statement_account_jobs
       (id, run_id, customer_id, product, account_id, currency_code, issuance_key,
        state, attempt_count, max_attempts, lease_owner, lease_expires_at,
        fencing_token, updated_at)
     VALUES ($1,$2,$3,'oxsteed',910001,'USD',$4,$5,1,8,'dead-worker',
       transaction_timestamp() + ($6 * interval '1 second'), 3, transaction_timestamp())
     RETURNING *`,
    [crypto.randomUUID(), run.id, customerId, key, state, leaseExpired ? -5 : 600]
  );
  return job;
}

ddescribe('reclaim of stranded intermediate-state jobs', () => {
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE statement_outbox, statement_account_jobs, statement_issuance_runs RESTART IDENTITY CASCADE');
  });

  test('reclaims a snapshotted job past its lease back to leased', async () => {
    const seeded = await seedStrandedJob({ state: 'snapshotted', leaseExpired: true });
    const claimed = await service.claimNextAccountJob('reclaim-worker-1');
    expect(claimed).not.toBeNull();
    expect(claimed.id).toBe(seeded.id);
    expect(claimed.state).toBe('leased');
    expect(claimed.lease_owner).toBe('reclaim-worker-1');
    expect(Number(claimed.fencing_token)).toBe(Number(seeded.fencing_token) + 1);
    expect(claimed.last_error).toMatch(/Reclaimed after worker loss in state snapshotted/);
  });

  test('reclaims artifact_ready and notified jobs past their leases', async () => {
    for (const state of ['artifact_ready', 'notified']) {
      const seeded = await seedStrandedJob({ state, leaseExpired: true });
      const claimed = await service.claimNextAccountJob(`reclaim-worker-${state}`);
      expect(claimed && claimed.id).toBe(seeded.id);
      expect(claimed.state).toBe('leased');
      // Clean up so the next iteration's claim is unambiguous.
      await service.failJob(claimed.id, `reclaim-worker-${state}`, claimed.fencing_token, 'test cleanup', false);
    }
  });

  test('does not reclaim intermediate-state jobs with live leases', async () => {
    await seedStrandedJob({ state: 'artifact_ready', leaseExpired: false });
    const claimed = await service.claimNextAccountJob('reclaim-worker-live');
    expect(claimed).toBeNull();
  });

  test('reclaimed job advances through stages; stale fencing token is rejected', async () => {
    const seeded = await seedStrandedJob({ state: 'snapshotted', leaseExpired: true });
    const claimed = await service.claimNextAccountJob('reclaim-worker-stage');
    expect(claimed.id).toBe(seeded.id);
    // The dead worker's old fencing token no longer works.
    await expect(
      service.completeJobStage(seeded.id, 'dead-worker', seeded.fencing_token, 'artifact_ready')
    ).rejects.toThrow();
    // The new holder re-drives the pipeline from the start; forward-only
    // stages still apply, and each stage is idempotent downstream.
    const resnapshotted = await service.completeJobStage(
      claimed.id, 'reclaim-worker-stage', claimed.fencing_token, 'snapshotted');
    expect(resnapshotted.state).toBe('snapshotted');
    const advanced = await service.completeJobStage(
      claimed.id, 'reclaim-worker-stage', resnapshotted.fencing_token, 'artifact_ready');
    expect(advanced.state).toBe('artifact_ready');
  });

  test('expired-lease leased jobs still reclaim as before', async () => {
    const seeded = await seedStrandedJob({ state: 'leased', leaseExpired: true });
    const claimed = await service.claimNextAccountJob('reclaim-worker-leased');
    expect(claimed && claimed.id).toBe(seeded.id);
    expect(claimed.state).toBe('leased');
  });
});
