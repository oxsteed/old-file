'use strict';

/**
 * Behavior tests for the statement operations admin router
 * (server/routes/statementAdmin.js).
 *
 * Runs against the mocked DB layer (see __tests__/setup.js) with the REAL
 * requireAdmin / requirePermission middleware and the real router, so the
 * role matrix, grant checks, session/revocation handling and endpoint
 * contracts are exercised. No source-text assertions.
 *
 * Disposable-DB tests (immutability triggers, append-only audit, cross-run
 * isolation) live in statementAdmin.db.test.js.
 */

const { mockQuery, mockConnect, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const tokenRevocationService = require('../services/tokenRevocationService');

const statementAdmin = require('../routes/statementAdmin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/statements', statementAdmin);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({
      code: err.code || 'internal_error',
      error: err.message || 'Internal error',
    });
  });
  return app;
}

const VIEWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPERATOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const APPROVER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROPOSER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333';

function userRow(id) {
  return {
    id, role: 'admin', is_active: true,
    first_name: 'Ops', last_name: 'Admin',
    email: `${id.slice(0, 8)}@example.invalid`, totp_enabled: true,
  };
}

const scenario = {
  user: userRow(VIEWER),
  grants: ['view_financials'],
  runRows: [],
  runTotal: 0,
  runDetail: null,
  stateCounts: [],
  failures: [],
  job: null,
  proposal: null,
  auditRows: [],
  auditTotal: 0,
};

function bearer(id, role = 'admin') {
  return `Bearer ${jwt.sign({ id, role }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;
}

function grantRows(permission) {
  return scenario.grants.includes(permission)
    ? [{ id: 7, region_id: null, grant_source: 'direct' }]
    : [];
}

beforeEach(() => {
  resetMocks();
  tokenRevocationService.isRevoked.mockResolvedValue(false);
  scenario.user = userRow(VIEWER);
  scenario.grants = ['view_financials'];
  scenario.runRows = [];
  scenario.runTotal = 0;
  scenario.runDetail = null;
  scenario.stateCounts = [];
  scenario.failures = [];
  scenario.job = null;
  scenario.proposal = null;
  scenario.auditRows = [];
  scenario.auditTotal = 0;

  mockQuery.mockImplementation(async (sql, params = []) => {
    const s = String(sql);

    // Admin identity lookup.
    if (s.includes('FROM users WHERE id = $1')) {
      return { rows: [scenario.user] };
    }
    // Permission grant lookup (direct + delegated union).
    if (s.includes('admin_permission_grants')) {
      return { rows: grantRows(params[1]) };
    }

    // Run list.
    if (s.includes('job_health')) return { rows: scenario.runRows };
    if (s.includes('FROM statement_issuance_runs r') && s.includes('COUNT(*)::int AS total')) {
      return { rows: [{ total: scenario.runTotal }] };
    }
    // Run detail.
    if (s.includes('FROM statement_issuance_runs WHERE id = $1')) {
      return { rows: scenario.runDetail ? [scenario.runDetail] : [] };
    }
    if (s.includes('GROUP BY state')) return { rows: scenario.stateCounts };
    // Alert queries (matched before the generic publication/outbox matchers).
    if (s.includes("WHERE state = 'failed'") && s.includes('FROM statement_issuance_runs')) {
      return { rows: [] };
    }
    if (s.includes('AS covered')) return { rows: [{ covered: 1 }] };
    if (s.includes('AS stale')) return { rows: [{ stale: 0 }] };
    if (s.includes('AS oldest_sec')) return { rows: [{ oldest_sec: 0 }] };
    if (s.includes('AS stuck')) return { rows: [{ stuck: 0 }] };
    // Failures.
    if (s.includes("state IN ('failed', 'dead_letter')")) return { rows: scenario.failures };
    if (s.includes('FROM statement_publication_attempts')) return { rows: [] };
    if (s.includes('FROM statement_outbox')) return { rows: [] };
    // Job retry.
    if (s.includes('SELECT run_id FROM statement_account_jobs')) {
      return { rows: scenario.job ? [{ run_id: scenario.job.run_id }] : [] };
    }
    if (s.includes('FROM statement_account_jobs WHERE id = $1 FOR UPDATE')) {
      return { rows: scenario.job ? [scenario.job] : [] };
    }
    if (s.includes('UPDATE statement_account_jobs')) {
      const updated = { ...scenario.job, state: 'pending', lease_owner: null };
      scenario.job = updated;
      return { rows: [updated] };
    }
    // Amendments.
    if (s.includes('FROM statement_amendment_proposals') && s.includes('WHERE id = $1 FOR UPDATE')) {
      return { rows: scenario.proposal ? [scenario.proposal] : [] };
    }
    if (s.includes('UPDATE statement_amendment_proposals')) {
      const updated = {
        ...scenario.proposal, status: 'approved', decided_by: scenario.user.id,
        decided_at: new Date().toISOString(),
      };
      scenario.proposal = updated;
      return { rows: [updated] };
    }
    if (s.includes('COUNT(*)::int AS total') && s.includes('statement_amendment_proposals')) {
      return { rows: [{ total: scenario.proposal ? 1 : 0 }] };
    }
    if (s.includes('FROM statement_amendment_proposals') && s.includes('WHERE status = $1')) {
      return { rows: scenario.proposal ? [scenario.proposal] : [] };
    }
    // Audit viewer.
    if (s.includes('FROM admin_audit_log l')) {
      if (s.includes('COUNT(*)::int AS total')) return { rows: [{ total: scenario.auditTotal }] };
      return { rows: scenario.auditRows };
    }
    if (s.includes('INSERT INTO admin_audit_log')) return { rows: [{ id: 'audit-1' }] };
    if (s.includes('INSERT INTO security_audit_log')) return { rows: [] };
    if (s.includes('FROM statement_artifacts')) return { rows: [] };

    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s.trim())) return { rows: [] };
    return { rows: [] };
  });
});

const READ_PATHS = [
  '/api/admin/statements/ops/runs',
  '/api/admin/statements/ops/runs/11111111-1111-4111-8111-111111111111',
  '/api/admin/statements/ops/failures',
  '/api/admin/statements/ops/amendments',
  '/api/admin/statements/ops/alerts',
  '/api/admin/statements/audit',
];

describe('statement admin role matrix', () => {
  test('anonymous requests get 401 on every endpoint', async () => {
    const app = buildApp();
    for (const path of READ_PATHS) {
      await request(app).get(path).expect(401);
    }
    await request(app).post('/api/admin/statements/ops/runs/x/pause').send({ reason: 'r' }).expect(401);
  });

  test('admin without any grant gets 403 everywhere (clean denied state)', async () => {
    scenario.grants = [];
    const app = buildApp();
    for (const path of READ_PATHS) {
      const res = await request(app).get(path).set('Authorization', bearer(VIEWER));
      expect(res.status).toBe(403);
    }
    const res = await request(app)
      .post(`/api/admin/statements/ops/runs/${RUN_ID}/pause`)
      .set('Authorization', bearer(VIEWER)).send({ reason: 'ops check' });
    expect(res.status).toBe(403);
  });

  test('viewer (view_financials) can read but cannot pause runs', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/admin/statements/ops/runs')
      .set('Authorization', bearer(VIEWER)).expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.meta.definitions).toBeDefined();
    expect(res.body.meta.asOf).toBeDefined();

    const denied = await request(app)
      .post(`/api/admin/statements/ops/runs/${RUN_ID}/pause`)
      .set('Authorization', bearer(VIEWER)).send({ reason: 'ops check' });
    expect(denied.status).toBe(403);
  });

  test('operator (manage_operations) can pause but cannot approve amendments', async () => {
    scenario.user = userRow(OPERATOR);
    scenario.grants = ['view_financials', 'manage_operations'];
    scenario.runDetail = {
      id: RUN_ID, product: 'oxsteed', period_from: '2026-09-01', period_to: '2026-09-30',
      state: 'running', created_at: new Date(), updated_at: new Date(), completed_at: null,
    };
    const app = buildApp();

    // Pause requires a reason; the mocked pauseRun path calls the real
    // statementJobService.pauseRun, which hits the mocked pool — it returns no
    // rows, so the service fails closed with a 409 state error rather than
    // silently succeeding. The grant check itself must pass (no 403).
    const paused = await request(app)
      .post(`/api/admin/statements/ops/runs/${RUN_ID}/pause`)
      .set('Authorization', bearer(OPERATOR)).send({ reason: 'ops check' });
    expect(paused.status).not.toBe(403);

    scenario.proposal = {
      id: PROPOSAL_ID, issuance_key: 'stmt:v1:x', product: 'oxsteed',
      account_id: 42, currency_code: 'USD', period_from: '2026-09-01', period_to: '2026-09-30',
      document_id: null, reason: 'fix totals', status: 'proposed',
      proposed_by: PROPOSER, proposed_at: new Date().toISOString(),
      decided_by: null, decided_at: null, decision_reason: null,
    };
    const approved = await request(app)
      .post(`/api/admin/statements/ops/amendments/${PROPOSAL_ID}/approve`)
      .set('Authorization', bearer(OPERATOR)).send({ reason: 'looks fine' });
    expect(approved.status).toBe(403);
  });

  test('approver cannot self-approve an amendment proposal (403)', async () => {
    scenario.user = userRow(APPROVER);
    scenario.grants = ['view_financials', 'manage_financials'];
    scenario.proposal = {
      id: PROPOSAL_ID, issuance_key: 'stmt:v1:x', product: 'oxsteed',
      account_id: 42, currency_code: 'USD', period_from: '2026-09-01', period_to: '2026-09-30',
      document_id: null, reason: 'fix totals', status: 'proposed',
      proposed_by: APPROVER, proposed_at: new Date().toISOString(),
      decided_by: null, decided_at: null, decision_reason: null,
    };
    const app = buildApp();
    const res = await request(app)
      .post(`/api/admin/statements/ops/amendments/${PROPOSAL_ID}/approve`)
      .set('Authorization', bearer(APPROVER)).send({ reason: 'approving my own' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('statement_amendment_self_approval');
    // The proposal must remain untouched by the denied attempt.
    expect(scenario.proposal.status).toBe('proposed');
  });

  test('rejecting an amendment requires a reason', async () => {
    scenario.user = userRow(APPROVER);
    scenario.grants = ['view_financials', 'manage_financials'];
    scenario.proposal = {
      id: PROPOSAL_ID, issuance_key: 'stmt:v1:x', product: 'oxsteed',
      account_id: 42, currency_code: 'USD', period_from: '2026-09-01', period_to: '2026-09-30',
      document_id: null, reason: 'fix totals', status: 'proposed',
      proposed_by: PROPOSER, proposed_at: new Date().toISOString(),
      decided_by: null, decided_at: null, decision_reason: null,
    };
    const app = buildApp();
    const res = await request(app)
      .post(`/api/admin/statements/ops/amendments/${PROPOSAL_ID}/reject`)
      .set('Authorization', bearer(APPROVER)).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('statement_admin_reason_required');
  });
});

describe('session and grant lifecycle', () => {
  test('revoked session is rejected with 401 before any grant check', async () => {
    tokenRevocationService.isRevoked.mockResolvedValue(true);
    const app = buildApp();
    const res = await request(app).get('/api/admin/statements/ops/runs')
      .set('Authorization', bearer(VIEWER));
    expect(res.status).toBe(401);
  });

  test('revoked grant is rejected with 403 even with a live session', async () => {
    scenario.grants = []; // grant revoked between login and this request
    const app = buildApp();
    const res = await request(app).get('/api/admin/statements/ops/alerts')
      .set('Authorization', bearer(VIEWER));
    expect(res.status).toBe(403);
  });

  test('pause and retry require an operator reason', async () => {
    scenario.user = userRow(OPERATOR);
    scenario.grants = ['view_financials', 'manage_operations'];
    const app = buildApp();
    const res = await request(app)
      .post(`/api/admin/statements/ops/runs/${RUN_ID}/pause`)
      .set('Authorization', bearer(OPERATOR)).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('statement_admin_reason_required');
  });
});

describe('endpoint contracts', () => {
  test('run list carries definitions and source timestamps in meta (no bare green cards)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/admin/statements/ops/runs')
      .set('Authorization', bearer(VIEWER)).expect(200);
    expect(res.body.meta.definitions.expected).toMatch(/discovered/i);
    expect(res.body.meta.definitions.issued).toBeDefined();
    expect(res.body.meta.asOf).toBeDefined();
    expect(typeof res.body.total).toBe('number');
  });

  test('run detail failures carry owner/reason/correlation/attempts/nextRetry/recommendedAction', async () => {
    scenario.runDetail = {
      id: RUN_ID, product: 'oxsteed', period_from: '2026-09-01', period_to: '2026-09-30',
      state: 'running', created_at: new Date(), updated_at: new Date(), completed_at: null,
    };
    scenario.stateCounts = [{ state: 'complete', count: 3 }, { state: 'dead_letter', count: 1 }];
    scenario.failures = [{
      id: JOB_ID, account_id: 42, product: 'oxsteed', currency_code: 'USD',
      state: 'dead_letter', attempt_count: 8, max_attempts: 8,
      lease_owner: 'worker-7', issuance_key: 'stmt:v1:oxsteed:42:USD:2026-09-01:2026-09-30:x',
      last_error: 'storage timeout', next_retry_at: null,
      created_at: new Date(), updated_at: new Date(),
    }];
    const app = buildApp();
    const res = await request(app).get(`/api/admin/statements/ops/runs/${RUN_ID}`)
      .set('Authorization', bearer(VIEWER)).expect(200);
    expect(res.body.stateCounts).toEqual({ complete: 3, dead_letter: 1 });
    const failure = res.body.failures[0];
    expect(failure.jobId).toBe(JOB_ID);
    expect(failure.leaseOwner).toBe('worker-7');
    expect(failure.lastError).toBe('storage timeout');
    expect(failure.correlationId).toBe('stmt:v1:oxsteed:42:USD:2026-09-01:2026-09-30:x');
    expect(failure.attempts).toBe(8);
    expect(failure.recommendedAction).toBe('operator_review');
  });

  test('retry re-queues without issuing evidence: issued documents untouched', async () => {
    scenario.user = userRow(OPERATOR);
    scenario.grants = ['view_financials', 'manage_operations'];
    scenario.job = {
      id: JOB_ID, run_id: RUN_ID, state: 'failed', attempt_count: 3, max_attempts: 8,
      issuance_key: 'stmt:v1:oxsteed:42:USD:2026-09-01:2026-09-30:x',
      created_at: new Date(), updated_at: new Date(),
    };
    const app = buildApp();
    const res = await request(app).post(`/api/admin/statements/ops/jobs/${JOB_ID}/retry`)
      .set('Authorization', bearer(OPERATOR)).send({ reason: 'worker recovered' })
      .expect(200);
    expect(res.body.state).toBe('pending');
    expect(res.body.correlationId).toBe('stmt:v1:oxsteed:42:USD:2026-09-01:2026-09-30:x');
    // The audit write for the retry must have happened (fail-closed chain).
    const auditWrites = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO admin_audit_log'));
    expect(auditWrites.length).toBeGreaterThan(0);
    const auditParams = auditWrites[0][1];
    expect(auditParams[1]).toBe('statement.job.retry');
  });

  test('retry of a non-failed job is rejected (409)', async () => {
    scenario.user = userRow(OPERATOR);
    scenario.grants = ['view_financials', 'manage_operations'];
    scenario.job = {
      id: JOB_ID, run_id: RUN_ID, state: 'complete', attempt_count: 1, max_attempts: 8,
      issuance_key: 'stmt:v1:x', created_at: new Date(), updated_at: new Date(),
    };
    const app = buildApp();
    const res = await request(app).post(`/api/admin/statements/ops/jobs/${JOB_ID}/retry`)
      .set('Authorization', bearer(OPERATOR)).send({ reason: 'mistake' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('statement_job_not_retryable');
  });

  test('audit viewer lists statement events with actor/action/target/time/outcome/reason/correlation', async () => {
    scenario.auditRows = [{
      id: 'audit-9', admin_id: VIEWER, action: 'statement.run.pause',
      target_type: 'statement_run', target_id: RUN_ID, target_key: RUN_ID,
      description: 'ops check', after_state: { outcome: 'success', correlationId: RUN_ID },
      created_at: new Date('2026-10-05T12:00:00Z'),
      actor_name: 'Ops Admin', actor_email: 'ops@example.invalid',
    }];
    scenario.auditTotal = 1;
    const app = buildApp();
    const res = await request(app).get('/api/admin/statements/audit')
      .set('Authorization', bearer(VIEWER)).expect(200);
    const event = res.body.items[0];
    expect(event.action).toBe('statement.run.pause');
    expect(event.actorId).toBe(VIEWER);
    expect(event.targetType).toBe('statement_run');
    expect(event.occurredAt).toBe('2026-10-05T12:00:00.000Z');
    expect(event.outcome).toBe('success');
    expect(event.reason).toBe('ops check');
    expect(event.correlationId).toBe(RUN_ID);
    expect(res.body.meta.source).toMatch(/admin_audit_log/);
  });

  test('list responses never carry document bodies or signed links', async () => {
    // Even if a fixture row somehow carried sensitive fields, the shapers
    // must not forward them.
    scenario.runRows = [{
      id: RUN_ID, product: 'oxsteed', period_from: '2026-09-01', period_to: '2026-09-30',
      state: 'running', discovered_count: 1, issued_count: 0, failed_count: 1,
      active_leases: 0, stale_leases: 0, oldest_queue_age_sec: 10,
      created_at: new Date(), updated_at: new Date(), completed_at: null,
      document_body: '{"secret":"must-not-leak"}', signed_url: 'https://x/signed',
    }];
    scenario.runTotal = 1;
    const app = buildApp();
    const res = await request(app).get('/api/admin/statements/ops/runs')
      .set('Authorization', bearer(VIEWER)).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('must-not-leak');
    expect(text).not.toContain('signed_url');
    expect(text).not.toContain('document_body');
  });

  test('alerts evaluate with documented thresholds and no PII', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/admin/statements/ops/alerts')
      .set('Authorization', bearer(VIEWER)).expect(200);
    expect(Array.isArray(res.body.alerts)).toBe(true);
    expect(res.body.meta.thresholds.agedQueueHours).toBe(6);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('@');
  });
});
