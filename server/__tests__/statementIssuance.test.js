'use strict';

/**
 * Behavior tests for automatic monthly statement issuance (workstream 1):
 * the per-job pipeline, discovery eligibility, the scheduler's period math,
 * and the statement.ready outbox ordering guarantees.
 *
 * These tests run ONLY against the disposable localhost credit_statement_test
 * database (same guard family as the Phase 2 statement suites). They exercise
 * real DB behavior — leases, fencing, unique constraints, crash recovery —
 * with no source-text assertions. Without the disposable DB the DB describes
 * skip (fail closed) instead of touching a real database.
 */

jest.unmock('pg');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL
  || 'postgresql://postgres:postgres@127.0.0.1:5432/credit_statement_test?sslmode=disable';

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
  if (!CAN_RUN_DB) {
    // eslint-disable-next-line no-console
    console.log('statementIssuance DB tests skipped: set STATEMENT_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.STATEMENT_ARTIFACT_BUCKET = 'statement-test-bucket';
  process.env.STATEMENT_ARTIFACT_PREFIX = 'test-statements';
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const pool = require('../db');
const jobs = require('../services/statementJobService');
const issuance = require('../services/statementIssuanceService');
const statements = require('../services/creditStatementService');
const scheduler = require('../jobs/statementIssuanceScheduler');
const { tNotif } = require('../utils/i18n');

jest.setTimeout(120000);

// --- in-memory fake implementing the storage.js interface -------------------
function makeFakeStorage() {
  const objects = new Map();
  return {
    async uploadFile(key, buffer) {
      objects.set(key, Buffer.from(buffer));
      return key;
    },
    async getObjectStream(key) {
      const stored = objects.get(key);
      if (!stored) return null;
      return Readable.from([stored]);
    },
    async deleteFile(key) {
      objects.delete(key);
    },
    async getSignedDownloadUrl(key, expiresIn) {
      return `https://signed.invalid/${key}?ttl=${expiresIn}`;
    },
  };
}

// --- fixtures ---------------------------------------------------------------
async function createUser(role = 'customer') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'synthetic-unusable-hash', 'Issuance', 'Fixture', $3, TRUE, TRUE)`,
    [id, `${id}@example.invalid`, role]);
  return id;
}

async function createWallet(customerId, { currency = 'USD', status = 'active', createdAt = '2026-01-15T12:00:00.000Z' } = {}) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, status, created_at)
     VALUES ('customer_wallet', $1, $2, $3, $4)
     RETURNING id`,
    [customerId, currency, status, createdAt]);
  return Number(row.id);
}

// One customer holds at most one wallet per currency
// (uq_oxsteed_credit_customer_account), so each wallet fixture gets its own user.
async function createUserWithWallet(options) {
  const customerId = await createUser();
  const walletId = await createWallet(customerId, options);
  return { customerId, walletId };
}

async function postMovement({ debit, credit, amount, type, date, actorId, actorType = 'admin' }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: balances } = await client.query(
      'SELECT * FROM oxsteed_credit_accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [[debit, credit]]);
    const debitAccount = balances.find((value) => String(value.id) === String(debit));
    const creditAccount = balances.find((value) => String(value.id) === String(credit));
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO oxsteed_credit_transactions
        (id, transaction_type, status, debit_account_id, credit_account_id, amount_cents, currency_code,
         idempotency_key, reference_id, description, reason, actor_type, actor_user_id, posted_at, created_at)
       VALUES ($1,$2,'posted',$3,$4,$5,'USD',$6,$9,'Synthetic issuance fixture',
         'Local synthetic fixture only',$10,$7,$8,$8)`,
      [id, type, debit, credit, amount, `${id}`, actorId, date, id, actorType]);
    await client.query("SELECT set_config('oxsteed.credit_ledger_transaction_id', $1, TRUE)", [id]);
    for (const [source, side, sign] of [[debitAccount, 'debit', -1n], [creditAccount, 'credit', 1n]]) {
      const balance = BigInt(source.balance_cents) + sign * BigInt(amount);
      const sequence = BigInt(source.ledger_version) + 1n;
      const entryHash = crypto.createHash('sha256').update(`${id}:${source.id}`).digest('hex');
      await client.query(
        `INSERT INTO oxsteed_credit_transaction_entries
          (transaction_id, account_id, entry_side, amount_cents, balance_after_cents, sequence,
           previous_entry_hash, entry_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, source.id, side, amount, String(balance), String(sequence), source.last_entry_hash, entryHash, date]);
      await client.query(
        `UPDATE oxsteed_credit_accounts SET balance_cents=$2, ledger_version=$3, last_entry_hash=$4, last_posted_at=$5
         WHERE id=$1`,
        [source.id, String(balance), String(sequence), entryHash, date]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function jobSpec(customerId, accountId, product = 'oxsteed', currencyCode = 'USD') {
  return { customerId, product, accountId, currencyCode };
}

async function jobRow(jobId) {
  const { rows: [row] } = await pool.query('SELECT * FROM statement_account_jobs WHERE id = $1', [jobId]);
  return row;
}

async function countSnapshots(issuanceKey) {
  const { rows: [{ n }] } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM statement_snapshots WHERE issuance_key = $1', [issuanceKey]);
  return n;
}

async function countDocuments(customerId, accountId, from, to) {
  const { rows: [{ n }] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM credit_statement_documents
     WHERE customer_id = $1 AND product = 'oxsteed' AND account_id = $2
       AND currency_code = 'USD' AND period_from = $3 AND period_to = $4`,
    [customerId, accountId, from, to]);
  return n;
}

async function countArtifacts(issuanceKey) {
  const { rows: [{ n }] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM statement_artifacts a
     JOIN statement_snapshots s ON s.id = a.snapshot_id
     WHERE s.issuance_key = $1 AND a.kind = 'original'`,
    [issuanceKey]);
  return n;
}

// Claims are global across runs: drain claimable leftovers before each test
// so one test never picks up another's unfinished jobs.
async function drainClaimableJobs() {
  for (let i = 0; i < 300; i += 1) {
    const job = await jobs.claimNextAccountJob('test-drain');
    if (!job) return;
    if (job.state === 'leased') {
      await jobs.failJob(job.id, 'test-drain', job.fencing_token, 'test drain', false);
    }
  }
  throw new Error('test drain did not converge');
}

const P_RACE = { from: '2026-09-01', to: '2026-09-30' };
const P_CRASH = { from: '2026-08-01', to: '2026-08-31' };
const P_ZERO = { from: '2026-07-01', to: '2026-07-31' };
const P_PAUSE = { from: '2026-06-01', to: '2026-06-30' };
const P_OUTBOX = { from: '2026-05-01', to: '2026-05-31' };
const P_REDRIVE = { from: '2026-03-01', to: '2026-03-31' };
const P_DISCOVER = { from: '2026-04-01', to: '2026-04-30' };

ddescribe('automatic monthly issuance', () => {
  let owner;
  let activeWallet;
  let quietOwner;
  let quietWallet;
  let admin;

  beforeAll(async () => {
    for (const migration of ['682_credit_statement_documents.sql', '683_statement_issuance_jobs.sql', '684_statement_artifacts.sql']) {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', migration), 'utf8');
      await pool.query(sql);
    }
    owner = await createUser();
    admin = await createUser('super_admin');
    activeWallet = await createWallet(owner);
    ({ customerId: quietOwner, walletId: quietWallet } = await createUserWithWallet());
    const { rows: [treasuryRow] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, currency_code, created_at)
       VALUES ('platform_treasury', 'USD', '2026-01-01T00:00:00.000Z')
       ON CONFLICT DO NOTHING RETURNING id`);
    const treasuryId = treasuryRow
      ? Number(treasuryRow.id)
      : Number((await pool.query(
        `SELECT id FROM oxsteed_credit_accounts WHERE account_type = 'platform_treasury' AND currency_code = 'USD' LIMIT 1`)).rows[0].id);
    // Carryover balances posted before every test period, in chronological
    // order so balance_after chains consistently with entry dates.
    await postMovement({ debit: treasuryId, credit: activeWallet, amount: 6000, type: 'load', date: '2026-01-20T12:00:00.000Z', actorId: admin });
    await postMovement({ debit: treasuryId, credit: quietWallet, amount: 2500, type: 'load', date: '2026-01-20T12:00:00.000Z', actorId: admin });
    // In-period activity for the crash-recovery period (August).
    await postMovement({ debit: treasuryId, credit: activeWallet, amount: 1500, type: 'load', date: '2026-08-15T12:00:00.000Z', actorId: admin });
    // In-period activity for the race/outbox wallets (September).
    await postMovement({ debit: treasuryId, credit: activeWallet, amount: 2000, type: 'load', date: '2026-09-15T12:00:00.000Z', actorId: admin });
  }, 120000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await drainClaimableJobs();
  });

  test('(a) two workers racing never issue two originals for the same account-period', async () => {
    const run = await jobs.createRun({ product: 'oxsteed', periodFrom: P_RACE.from, periodTo: P_RACE.to });
    await jobs.discoverAccountJobs(run.id, [jobSpec(owner, activeWallet)]);
    const job = await jobs.claimNextAccountJob('worker-a');
    expect(job).not.toBeNull();
    const issuanceKey = job.issuance_key;

    // Race the full issuance pipeline against an on-demand monthly statement
    // build: both converge on the same immutable documents table.
    await Promise.all([
      issuance.issueAccountStatement({ job, workerId: 'worker-a', storage: makeFakeStorage() }),
      statements.getStatement(owner, { product: 'oxsteed', currencyCode: 'USD', from: P_RACE.from, to: P_RACE.to }),
    ]);

    expect(await countDocuments(owner, activeWallet, P_RACE.from, P_RACE.to)).toBe(1);
    expect(await countSnapshots(issuanceKey)).toBe(1);
    expect(await countArtifacts(issuanceKey)).toBe(1);
    expect((await jobRow(job.id)).state).toBe('complete');
  });

  test('(b) crash between snapshot and artifact stages resumes without resnapshotting', async () => {
    const run = await jobs.createRun({ product: 'oxsteed', periodFrom: P_CRASH.from, periodTo: P_CRASH.to });
    await jobs.discoverAccountJobs(run.id, [jobSpec(owner, activeWallet)]);
    const job = await jobs.claimNextAccountJob('worker-a');
    const issuanceKey = job.issuance_key;

    await expect(issuance.issueAccountStatement({
      job,
      workerId: 'worker-a',
      storage: makeFakeStorage(),
      hooks: { afterSnapshot: async () => { throw new Error('simulated crash between snapshot and artifact'); } },
    })).rejects.toThrow('simulated crash');
    expect((await jobRow(job.id)).state).toBe('failed');
    expect(await countSnapshots(issuanceKey)).toBe(1);
    const { rows: [{ id: firstSnapshotId }] } = await pool.query(
      'SELECT id FROM statement_snapshots WHERE issuance_key = $1', [issuanceKey]);

    // Fast-forward the backoff, reclaim with a second worker, resume.
    await pool.query(
      `UPDATE statement_account_jobs SET next_retry_at = transaction_timestamp() - interval '1 second' WHERE id = $1`,
      [job.id]);
    const reclaimed = await jobs.claimNextAccountJob('worker-b');
    expect(reclaimed.id).toBe(job.id);
    await issuance.issueAccountStatement({ job: reclaimed, workerId: 'worker-b', storage: makeFakeStorage() });

    // No resnapshot: still exactly one frozen snapshot, and the artifact was
    // published from that same snapshot.
    expect(await countSnapshots(issuanceKey)).toBe(1);
    const { rows: [artifact] } = await pool.query(
      `SELECT a.snapshot_id FROM statement_artifacts a
       JOIN statement_snapshots s ON s.id = a.snapshot_id
       WHERE s.issuance_key = $1 AND a.kind = 'original'`,
      [issuanceKey]);
    expect(artifact.snapshot_id).toBe(firstSnapshotId);
    expect(await countDocuments(owner, activeWallet, P_CRASH.from, P_CRASH.to)).toBe(1);
    expect((await jobRow(job.id)).state).toBe('complete');
  });

  test('(c) zero-activity carryover account gets a statement', async () => {
    const run = await jobs.createRun({ product: 'oxsteed', periodFrom: P_ZERO.from, periodTo: P_ZERO.to });
    await jobs.discoverAccountJobs(run.id, [jobSpec(quietOwner, quietWallet)]);
    const job = await jobs.claimNextAccountJob('worker-a');
    await issuance.issueAccountStatement({ job, workerId: 'worker-a', storage: makeFakeStorage() });

    expect((await jobRow(job.id)).state).toBe('complete');
    const { rows: [doc] } = await pool.query(
      `SELECT document FROM credit_statement_documents
       WHERE customer_id = $1 AND product = 'oxsteed' AND account_id = $2
         AND currency_code = 'USD' AND period_from = $3 AND period_to = $4`,
      [quietOwner, quietWallet, P_ZERO.from, P_ZERO.to]);
    expect(doc).toBeTruthy();
    expect(doc.document.transactionCount).toBe(0);
    expect(doc.document.openingBalanceCents).toBe(doc.document.closingBalanceCents);
    expect(doc.document.closingBalanceCents).toBe(2500);
  });

  test('(d) pause blocks claiming', async () => {
    const run = await jobs.createRun({ product: 'oxsteed', periodFrom: P_PAUSE.from, periodTo: P_PAUSE.to });
    await jobs.discoverAccountJobs(run.id, [jobSpec(owner, activeWallet)]);
    await jobs.pauseRun(run.id);
    expect(await jobs.claimNextAccountJob('worker-a')).toBeNull();
    await jobs.resumeRun(run.id);
    const job = await jobs.claimNextAccountJob('worker-a');
    expect(job).not.toBeNull();
    expect(job.run_id).toBe(run.id);
    await jobs.failJob(job.id, 'worker-a', job.fencing_token, 'test cleanup', false);
  });

  test('(e) statement.ready is never queued before the document row + artifact commit', async () => {
    const run = await jobs.createRun({ product: 'oxsteed', periodFrom: P_OUTBOX.from, periodTo: P_OUTBOX.to });
    await jobs.discoverAccountJobs(run.id, [jobSpec(owner, activeWallet)]);
    const job = await jobs.claimNextAccountJob('worker-a');

    // Simulate a crash after the artifact publish but before the
    // document-row + outbox transaction.
    await expect(issuance.issueAccountStatement({
      job,
      workerId: 'worker-a',
      storage: makeFakeStorage(),
      hooks: { beforeDocument: async () => { throw new Error('simulated crash before document insert'); } },
    })).rejects.toThrow('simulated crash');

    // The artifact WAS published (stage c committed), but no notification
    // event may exist for the job: statement.ready fires only inside the
    // stage-(d) transaction, after the document row is committed.
    expect(await countArtifacts(job.issuance_key)).toBe(1);
    const { rows: [{ n }] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM statement_outbox
       WHERE event_type = 'statement.ready' AND aggregate_id = $1`,
      [job.id]);
    expect(n).toBe(0);

    // Recover and finish; exactly one event is queued for the completed job.
    await pool.query(
      `UPDATE statement_account_jobs SET next_retry_at = transaction_timestamp() - interval '1 second' WHERE id = $1`,
      [job.id]);
    const reclaimed = await jobs.claimNextAccountJob('worker-b');
    await issuance.issueAccountStatement({ job: reclaimed, workerId: 'worker-b', storage: makeFakeStorage() });
    const { rows: events } = await pool.query(
      `SELECT * FROM statement_outbox WHERE event_type = 'statement.ready' AND aggregate_id = $1`,
      [job.id]);
    expect(events).toHaveLength(1);
    expect(events[0].processed_at).toBeNull();

    // Draining the outbox delivers the localized in-app notification and
    // marks the event processed.
    const drained = await issuance.processStatementReadyOutbox({ workerId: 'worker-c' });
    expect(drained.processed).toBeGreaterThanOrEqual(1);
    const { rows: [notification] } = await pool.query(
      `SELECT type, title, body FROM notifications
       WHERE user_id = $1 AND type = 'statement_ready'
       ORDER BY created_at DESC LIMIT 1`,
      [owner]);
    expect(notification).toBeTruthy();
    expect(notification.title).toBeTruthy();
    const { rows: [done] } = await pool.query(
      'SELECT processed_at FROM statement_outbox WHERE id = $1', [events[0].id]);
    expect(done.processed_at).not.toBeNull();
  });

  test('(h) crash after the document transaction still queues exactly one statement.ready event', async () => {
    // Own period: issuance keys are deterministic per account-period, so
    // reusing another test's period would collide on ON CONFLICT DO NOTHING.
    const run = await jobs.createRun({ product: 'oxsteed', periodFrom: P_REDRIVE.from, periodTo: P_REDRIVE.to });
    await jobs.discoverAccountJobs(run.id, [jobSpec(owner, activeWallet)]);
    const job = await jobs.claimNextAccountJob('worker-a');

    // Simulate a crash after the document-row + outbox transaction committed
    // but before the job is marked notified.
    await expect(issuance.issueAccountStatement({
      job,
      workerId: 'worker-a',
      storage: makeFakeStorage(),
      hooks: { afterDocument: async () => { throw new Error('simulated crash after document commit'); } },
    })).rejects.toThrow('simulated crash');

    // The first attempt committed its transaction: exactly one
    // statement.ready event exists for the job.
    const { rows: [{ n }] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM statement_outbox
       WHERE event_type = 'statement.ready' AND aggregate_id = $1`,
      [job.id]);
    expect(n).toBe(1);

    // Recover and finish; the idempotent re-drive must NOT queue a second
    // event, and the job completes exactly once.
    await pool.query(
      `UPDATE statement_account_jobs SET next_retry_at = transaction_timestamp() - interval '1 second' WHERE id = $1`,
      [job.id]);
    const reclaimed = await jobs.claimNextAccountJob('worker-b');
    const result = await issuance.issueAccountStatement({
      job: reclaimed, workerId: 'worker-b', storage: makeFakeStorage(),
    });
    expect(result.documentId).toBeTruthy();
    const { rows: events } = await pool.query(
      `SELECT * FROM statement_outbox WHERE event_type = 'statement.ready' AND aggregate_id = $1`,
      [job.id]);
    expect(events).toHaveLength(1);
    const { rows: [finalJob] } = await pool.query(
      'SELECT state FROM statement_account_jobs WHERE id = $1', [job.id]);
    expect(finalJob.state).toBe('complete');
  });

  test('(f) statement-ready notification text contains no balance or amount digits', () => {
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      const { title, body } = tNotif('statement_ready', lang);
      expect(title).toBeTruthy();
      expect(body).toBeTruthy();
      expect(title).not.toMatch(/\d/);
      expect(body).not.toMatch(/\d/);
    }
    // The composed scheduler payload carries no amounts anywhere user-visible:
    // no amount/balance fields, no digits in the link, no tokens.
    const payload = issuance.composeStatementReadyPayload({
      job: { customer_id: owner },
      payload: {
        documentId: crypto.randomUUID(),
        issuanceKey: `stmt:v1:oxsteed:123:USD:${P_OUTBOX.from}:${P_OUTBOX.to}:${owner}`,
        product: 'oxsteed',
        periodFrom: P_OUTBOX.from,
        periodTo: P_OUTBOX.to,
      },
    });
    expect(payload.type).toBe('statement_ready');
    expect(payload.action_url).not.toMatch(/\d/);
    const dataText = JSON.stringify(payload.data).toLowerCase();
    expect(dataText).not.toMatch(/amount|balance|cents/);
    expect(payload.idempotencyKey).toBeTruthy();
  });

  test('(g) leap-year February boundaries and year rollover in period computation', () => {
    expect(issuance.latestClosedMonthPeriod(new Date('2024-03-15T12:00:00.000Z')))
      .toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(issuance.latestClosedMonthPeriod(new Date('2024-03-01T00:00:00.000Z')))
      .toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(issuance.latestClosedMonthPeriod(new Date('2023-03-10T00:00:00.000Z')))
      .toEqual({ from: '2023-02-01', to: '2023-02-28' });
    expect(issuance.latestClosedMonthPeriod(new Date('2025-01-05T00:00:00.000Z')))
      .toEqual({ from: '2024-12-01', to: '2024-12-31' });
    // Grace period: September 2026 ends at 2026-10-01T00:00Z; +72h = 2026-10-04T00:00Z.
    expect(issuance.issuanceGraceElapsed('2026-09-30', new Date('2026-10-03T23:59:59.000Z'))).toBe(false);
    expect(issuance.issuanceGraceElapsed('2026-09-30', new Date('2026-10-04T00:00:00.000Z'))).toBe(true);
  });

  test('discovery records policy skips with reasons and never backfills', async () => {
    const { walletId: suspended } = await createUserWithWallet({ status: 'suspended' });
    const { walletId: closed } = await createUserWithWallet({ status: 'closed' });
    const { walletId: future } = await createUserWithWallet({ createdAt: '2026-05-15T12:00:00.000Z' });
    const run = await jobs.createRun({ product: 'oxsteed', periodFrom: P_DISCOVER.from, periodTo: P_DISCOVER.to });
    const pass = await scheduler.runDiscoveryPass(run);
    expect(pass.discovered).toBeGreaterThan(0);

    const rowsFor = async (accountId) => (await pool.query(
      `SELECT state, last_error FROM statement_account_jobs WHERE run_id = $1 AND account_id = $2`,
      [run.id, accountId])).rows;

    // Eligible: active wallets (at least the fixture wallets).
    const activeRows = await rowsFor(activeWallet);
    expect(activeRows.length).toBe(1);
    expect(activeRows[0].state).toBe('pending');

    // Skipped with recorded reasons, never claimed.
    for (const [accountId, reason] of [[suspended, 'skip:account-suspended'], [closed, 'skip:account-closed'], [future, 'skip:account-created-after-period']]) {
      const rows = await rowsFor(accountId);
      expect(rows.length).toBe(1);
      expect(rows[0].state).toBe('dead_letter');
      expect(rows[0].last_error).toBe(reason);
    }

    // Re-running discovery is idempotent: no duplicate jobs or skips.
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM statement_account_jobs WHERE run_id = $1', [run.id]);
    await scheduler.runDiscoveryPass(run);
    const after = await pool.query('SELECT COUNT(*)::int AS n FROM statement_account_jobs WHERE run_id = $1', [run.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  test('scheduler creates no run before the grace period elapses', async () => {
    // 2026-10-02: September 2026 closed 2 days ago; the 72h grace has not elapsed.
    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM statement_issuance_runs
       WHERE product = 'oxsteed' AND period_from = '2026-09-01' AND period_to = '2026-09-30'`);
    const summary = await scheduler.pollIssuanceCycle({
      workerId: 'test-grace',
      now: new Date('2026-10-02T12:00:00.000Z'),
    });
    expect(summary.graceElapsed).toBe(false);
    expect(summary.period).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(summary.products).toEqual({});
    const after = await pool.query(
      `SELECT COUNT(*)::int AS n FROM statement_issuance_runs
       WHERE product = 'oxsteed' AND period_from = '2026-09-01' AND period_to = '2026-09-30'`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
