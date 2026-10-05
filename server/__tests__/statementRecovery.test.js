'use strict';

jest.unmock('pg');
const { disposableDatabaseOptIn, isDisposableDatabase, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const url = disposableDatabaseOptIn('STATEMENT_JOB_TEST_DATABASE_URL');
const canRun = isDisposableDatabase(url);
if (canRun) process.env.DATABASE_URL = url;
const dbDescribe = canRun ? describe : describe.skip;

jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, _res, next) => { req.user = { id: req.get('x-test-admin') }; next(); },
  requirePermission: () => (_req, _res, next) => next(),
}));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/statementIssuanceService', () => {
  const actual = jest.requireActual('../services/statementIssuanceService');
  return { ...actual, discoverEligibleAccounts: jest.fn(), recordSkippedJobs: jest.fn().mockResolvedValue(0),
    reviveEligibleSkips: jest.fn().mockResolvedValue(0), issueAccountStatement: jest.fn(),
    processStatementReadyOutbox: jest.fn().mockResolvedValue({ processed: 0 }) };
});
jest.mock('../services/statementAmendmentService', () => ({ processStatementAmendedOutbox: jest.fn().mockResolvedValue({ processed: 0 }) }));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const jobs = require('../services/statementJobService');
const issuance = require('../services/statementIssuanceService');
const scheduler = require('../jobs/statementIssuanceScheduler');
const policy = require('../services/statementIssuancePolicy');
const { logAdminAction } = require('../services/auditService');
const { assertRequiredResults, REQUIRED } = require('../../scripts/assert-statement-db-tests.cjs');

test('DB opt-in and required-suite gate reject unsafe targets and hidden skips', () => {
  expect(isDisposableDatabase('postgresql://remote.example/credit_statement_test')).toBe(false);
  expect(isDisposableDatabase('postgresql://localhost/production')).toBe(false);
  const report = { testResults: REQUIRED.map(name => ({ name, status: 'passed', assertionResults: [{ status: 'passed' }, { status: 'passed' }] })) };
  expect(assertRequiredResults(report)).toBe(REQUIRED.length);
  report.testResults[0].assertionResults[1].status = 'pending';
  expect(() => assertRequiredResults(report)).toThrow('skipped');
  expect(() => assertRequiredResults({ testResults: [] })).toThrow('did not execute');
});

dbDescribe('run recovery on the fully migrated disposable DB', () => {
  let userId;
  const app = express();
  app.use(express.json());
  app.use('/issuance', require('../routes/statementIssuance'));
  app.use('/admin', require('../routes/statementAdmin'));
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code, message: err.message }));
  const period = { periodFrom: '2026-09-01', periodTo: '2026-09-30' };
  const runRow = async id => (await pool.query('SELECT * FROM statement_issuance_runs WHERE id=$1', [id])).rows[0];

  beforeAll(async () => { await assertMigratedSchema(pool); });
  beforeEach(async () => {
    await pool.query('TRUNCATE statement_account_jobs, statement_issuance_runs CASCADE');
    userId = crypto.randomUUID();
    await pool.query(`INSERT INTO users (id,email,password_hash,first_name,last_name,role,email_verified,is_active)
      VALUES ($1,$2,'synthetic','Recovery','Fixture','admin',TRUE,TRUE)`, [userId, `${userId}@example.invalid`]);
    delete process.env.STATEMENT_ISSUANCE_ACTIVATION_MONTH;
    issuance.discoverEligibleAccounts.mockReset().mockResolvedValue({ eligible: [], skipped: [], nextCursor: null });
    logAdminAction.mockReset().mockResolvedValue(undefined);
    issuance.issueAccountStatement.mockReset().mockImplementation(async ({ job, workerId }) => {
      for (const stage of ['snapshotted','artifact_ready','notified','complete']) {
        await jobs.completeJobStage(job.id, workerId, job.fencing_token, stage);
      }
    });
  });
  afterAll(async () => { delete process.env.STATEMENT_ISSUANCE_ACTIVATION_MONTH; await pool.end(); });

  async function runWithJob(product = 'oxsteed') {
    const run = await jobs.createRun({ product, ...period });
    await jobs.discoverAccountJobs(run.id, [{ product, customerId: userId, currencyCode: 'USD',
      ...(product === 'helper_earnings' ? { accountUuid: userId } : { accountId: 999999 }) }]);
    const job = (await pool.query('SELECT * FROM statement_account_jobs WHERE run_id=$1', [run.id])).rows[0];
    return { run, job };
  }

  test('discovery is bounded, persists its cursor, and resumes the discovery phase', async () => {
    const run = await jobs.createRun({ product: 'oxsteed', ...period });
    issuance.discoverEligibleAccounts.mockImplementation(async ({ cursor }) => ({ eligible: [], skipped: [],
      nextCursor: Number(cursor || 0) < 10 ? String(Number(cursor || 0) + 1) : null }));
    expect((await scheduler.runDiscoveryPass(run)).complete).toBe(false);
    expect(issuance.discoverEligibleAccounts).toHaveBeenCalledTimes(policy.MAX_DISCOVERY_BATCHES_PER_CYCLE);
    expect((await runRow(run.id)).discovery_cursor).toBe('10');
    await jobs.pauseRun(run.id);
    expect((await jobs.resumeRun(run.id)).state).toBe('discovering');
    expect((await scheduler.runDiscoveryPass(await runRow(run.id))).complete).toBe(true);
    expect(issuance.discoverEligibleAccounts.mock.calls.at(-1)[0].cursor).toBe('10');
    expect((await runRow(run.id)).state).toBe('running');
  });

  test('pause during a discovery batch retains the phase and cursor', async () => {
    const run = await jobs.createRun({ product: 'business', ...period });
    issuance.discoverEligibleAccounts.mockImplementationOnce(async () => {
      await jobs.pauseRun(run.id);
      return { eligible: [], skipped: [], nextCursor: '500:USD' };
    });
    await scheduler.runDiscoveryPass(run);
    expect((await runRow(run.id)).state).toBe('paused');
    expect((await jobs.resumeRun(run.id)).state).toBe('discovering');
    expect((await runRow(run.id)).discovery_cursor).toBe('500:USD');
  });

  test('overlapping discovery workers cannot advance the same cursor', async () => {
    const run = await jobs.createRun({ product:'business', ...period });
    let started; let finish;
    const waiting = new Promise(resolve => { started=resolve; });
    const released = new Promise(resolve => { finish=resolve; });
    issuance.discoverEligibleAccounts.mockImplementationOnce(async () => {
      started(); await released;
      return { eligible:[],skipped:[],nextCursor:null };
    });
    const first=scheduler.runDiscoveryPass(run);
    await waiting;
    expect((await scheduler.runDiscoveryPass(run)).busy).toBe(true);
    finish();
    expect((await first).complete).toBe(true);
    expect(issuance.discoverEligibleAccounts).toHaveBeenCalledTimes(1);
  });

  test('explicit catch-up fences a discovery cursor from an earlier pass', async () => {
    const run=await jobs.createRun({ product:'business', ...period });
    issuance.discoverEligibleAccounts.mockImplementationOnce(async () => {
      await jobs.requestCatchUp(run.id);
      return { eligible:[],skipped:[],nextCursor:'500:USD' };
    });
    expect((await scheduler.runDiscoveryPass(run)).complete).toBe(false);
    const current=await runRow(run.id);
    expect(current.discovery_cursor).toBeNull();
    expect(Number(current.discovery_generation)).toBe(1);
    expect((await scheduler.runDiscoveryPass(current)).complete).toBe(true);
  });

  test('an incomplete discovery cannot complete even with no open jobs', async () => {
    const run = await jobs.createRun({ product: 'oxsteed', ...period });
    expect(await scheduler.maybeCompleteRun(run.id)).toBeNull();
    expect((await runRow(run.id)).state).toBe('discovering');
  });

  test.each(['failed','complete'])('operator retry reopens a %s run and extends exhausted budget without erasing history', async state => {
    const { run, job } = await runWithJob();
    await pool.query("UPDATE statement_issuance_runs SET state=$2,discovery_phase='running',completed_at=NOW() WHERE id=$1", [run.id, state]);
    await pool.query("UPDATE statement_account_jobs SET state='dead_letter',attempt_count=8,max_attempts=8,last_error='storage outage' WHERE id=$1", [job.id]);
    await request(app).post(`/admin/ops/jobs/${job.id}/retry`).set('x-test-admin', userId).send({ reason: 'Storage repaired' }).expect(200);
    expect((await runRow(run.id)).state).toBe('running');
    expect((await runRow(run.id)).completed_at).toBeNull();
    const claimed = await jobs.claimNextAccountJob('recovered', 120, { product: 'oxsteed' });
    expect(claimed.id).toBe(job.id);
    expect(claimed.attempt_count).toBe(9);
    expect(claimed.max_attempts).toBe(16);
  });

  test('retry audit failure rolls back both run reopening and requeue', async () => {
    const { run, job } = await runWithJob();
    await pool.query("UPDATE statement_issuance_runs SET state='complete',discovery_phase='running' WHERE id=$1", [run.id]);
    await pool.query("UPDATE statement_account_jobs SET state='dead_letter',last_error='storage outage' WHERE id=$1", [job.id]);
    logAdminAction.mockRejectedValueOnce(new Error('audit unavailable'));
    await request(app).post(`/admin/ops/jobs/${job.id}/retry`).set('x-test-admin', userId).send({ reason: 'Repair' }).expect(500);
    expect((await runRow(run.id)).state).toBe('complete');
    expect((await pool.query('SELECT state FROM statement_account_jobs WHERE id=$1',[job.id])).rows[0].state).toBe('dead_letter');
  });

  test('a completion racing operator retry cannot strand the pending job', async () => {
    const {run,job}=await runWithJob();
    await pool.query("UPDATE statement_issuance_runs SET state='running',discovery_phase='running' WHERE id=$1",[run.id]);
    await pool.query("UPDATE statement_account_jobs SET state='dead_letter',last_error='storage outage' WHERE id=$1",[job.id]);
    const [,retry]=await Promise.all([scheduler.maybeCompleteRun(run.id),
      request(app).post(`/admin/ops/jobs/${job.id}/retry`).set('x-test-admin',userId).send({reason:'Repair'})]);
    expect(retry.status).toBe(200);
    expect((await runRow(run.id)).state).toBe('running');
    expect((await jobs.claimNextAccountJob('race-recovery', 120, { product: 'oxsteed' })).id).toBe(job.id);
  });

  test('dead letters fail coverage; policy skips remain separate and cannot be retried unconditionally', async () => {
    const { run, job } = await runWithJob();
    await pool.query("UPDATE statement_issuance_runs SET state='running',discovery_phase='running' WHERE id=$1", [run.id]);
    await pool.query("UPDATE statement_account_jobs SET state='dead_letter',last_error='storage outage' WHERE id=$1", [job.id]);
    expect((await scheduler.maybeCompleteRun(run.id)).state).toBe('failed');
    await pool.query("UPDATE statement_account_jobs SET last_error='skip:account-created-after-period' WHERE id=$1",[job.id]);
    const stats = await jobs.getRunStats(run.id);
    expect(stats.expected).toBe(0); expect(stats.skipped).toBe(1); expect(stats.deadLetter).toBe(0);
    await request(app).post(`/admin/ops/jobs/${job.id}/retry`).set('x-test-admin',userId).send({ reason:'Try anyway' }).expect(409);
  });

  test('coverage alerts inspect eligible job completion even on a legacy complete run', async () => {
    const {run,job}=await runWithJob();
    process.env.STATEMENT_ISSUANCE_ACTIVATION_MONTH='2026-09';
    await pool.query("UPDATE statement_issuance_runs SET state='complete',discovery_phase='running' WHERE id=$1",[run.id]);
    await pool.query("UPDATE statement_account_jobs SET state='dead_letter',last_error='storage outage' WHERE id=$1",[job.id]);
    const response=await request(app).get('/admin/ops/alerts').expect(200);
    const missing=response.body.alerts.find(alert=>alert.code==='missing_monthly_coverage' && alert.product==='oxsteed');
    expect(missing.context).toMatchObject({month:'2026-09',expected:1,issued:0});
  });

  test('catch-up reopens terminal runs and respects a paused run', async () => {
    const run = await jobs.createRun({ product:'helper_earnings', ...period });
    await pool.query("UPDATE statement_issuance_runs SET state='complete',discovery_phase='running' WHERE id=$1",[run.id]);
    issuance.discoverEligibleAccounts.mockResolvedValue({ eligible:[{ product:'helper_earnings',customerId:userId,
      accountUuid:userId,currencyCode:'USD' }],skipped:[],nextCursor:null });
    await request(app).post(`/issuance/runs/${run.id}/catch-up`).expect(200);
    expect((await runRow(run.id)).state).toBe('running');
    expect((await jobs.claimNextAccountJob('catch-up', 120, { product: 'helper_earnings' })).account_uuid).toBe(userId);
    await jobs.pauseRun(run.id);
    await request(app).post(`/issuance/runs/${run.id}/catch-up`).expect(409);
  });

  test.each(policy.PRODUCTS)('manual operator controls accept %s and concurrent creation converges', async product => {
    const [a,b] = await Promise.all([request(app).post('/issuance/runs').send({ product,...period }),
      request(app).post('/issuance/runs').send({ product,...period })]);
    expect([200,201]).toContain(a.status); expect([200,201]).toContain(b.status);
    expect(a.body.run.id).toBe(b.body.run.id);
  });

  test('a two-month outage discovers every approved product-period and never earlier months', async () => {
    process.env.STATEMENT_ISSUANCE_ACTIVATION_MONTH='2026-07';
    await scheduler.pollIssuanceCycle({ workerId:'outage',now:new Date('2026-10-15T00:00:00Z'),maxJobsPerProduct:0 });
    await scheduler.pollIssuanceCycle({ workerId:'outage',now:new Date('2026-10-15T00:00:00Z'),maxJobsPerProduct:0 });
    const { rows } = await pool.query('SELECT product,period_from::text FROM statement_issuance_runs ORDER BY product,period_from');
    expect(rows).toHaveLength(15);
    for (const product of policy.PRODUCTS) expect(rows.filter(r=>r.product===product).map(r=>r.period_from))
      .toEqual(['2026-07-01','2026-08-01','2026-09-01']);
  });

  test('old jobs drain even with terminal current months and no automatic activation', async () => {
    const { run,job } = await runWithJob('restaurant_settlement');
    await pool.query("UPDATE statement_issuance_runs SET state='running',discovery_phase='running' WHERE id=$1",[run.id]);
    for (const product of policy.PRODUCTS) {
      const latest = await jobs.createRun({ product,periodFrom:'2026-10-01',periodTo:'2026-10-31' });
      await pool.query("UPDATE statement_issuance_runs SET state='complete',discovery_phase='running' WHERE id=$1",[latest.id]);
    }
    const summary=await scheduler.pollIssuanceCycle({ workerId:'old-jobs',now:new Date('2026-11-01T00:00:00Z') });
    expect(summary.graceElapsed).toBe(false); expect(summary.jobs.issued).toBe(1);
    expect((await pool.query('SELECT state FROM statement_account_jobs WHERE id=$1',[job.id])).rows[0].state).toBe('complete');
    expect((await runRow(run.id)).state).toBe('complete');
  });

  test('automatic discovery stays disabled without approval and rejects pre-activation manual runs', async () => {
    await scheduler.pollIssuanceCycle({ workerId:'unconfigured',now:new Date('2026-10-15T00:00:00Z'),maxJobsPerProduct:0 });
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM statement_issuance_runs')).rows[0].n).toBe(0);
    process.env.STATEMENT_ISSUANCE_ACTIVATION_MONTH='2026-10';
    await request(app).post('/issuance/runs').send({ product:'oxsteed',...period }).expect(409);
  });

  test('the drain budget prevents one product from consuming another product\'s slots', async () => {
    const a=await runWithJob('oxsteed');
    await jobs.discoverAccountJobs(a.run.id,[{ product:'oxsteed',customerId:userId,accountId:999998,currencyCode:'USD' }]);
    await runWithJob('business');
    const summary=await scheduler.pollIssuanceCycle({workerId:'fair-drain',now:new Date('2026-10-15T00:00:00Z'),maxJobsPerProduct:1});
    expect(summary.jobs.issued).toBe(2);
    expect(issuance.issueAccountStatement.mock.calls.map(([call])=>call.job.product)).toEqual(['oxsteed','business']);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM statement_account_jobs WHERE product='oxsteed' AND state='pending'")).rows[0].n).toBe(1);
  });
});
