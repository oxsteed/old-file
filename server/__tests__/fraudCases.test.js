'use strict';

/**
 * Fraud case controller + route tests.
 *
 * No live database: the pg pool is mocked by __tests__/setup.js (loaded via
 * jest setupFiles) and fraudCaseService is mocked with a factory because the
 * sibling-owned service module is written by a parallel worker.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/fraudCaseService', () => ({
  createFraudCase: jest.fn(),
}));

const fraudCaseService = require('../services/fraudCaseService');
const controller = require('../controllers/fraudCaseController');
const fraudRoutes = require('../routes/fraudCases');
const { requireAdmin } = require('../middleware/adminAuth');

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const ASSIGNEE_ID = '33333333-3333-4333-8333-333333333333';

function responseDouble() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function requestDouble(overrides = {}) {
  return {
    user: { id: ADMIN_ID, role: 'admin' },
    ip: '127.0.0.1',
    headers: {},
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
}

function makeCase(overrides = {}) {
  return {
    id: CASE_ID,
    subject_type: 'user',
    subject_id: 'user-1',
    category: 'chargeback',
    severity: 'high',
    status: 'open',
    owner_admin_id: null,
    source: 'manual',
    source_ref: null,
    summary: 'Suspicious chargeback pattern',
    evidence: {},
    created_at: '2026-09-29T00:00:00.000Z',
    updated_at: '2026-09-29T00:00:00.000Z',
    resolved_at: null,
    ...overrides,
  };
}

let auditCalls;

function installFraudMock({ caseState = makeCase(), disputeExists = true, assigneeRole = 'admin' } = {}) {
  auditCalls = [];
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('INSERT INTO admin_audit_log')) {
      auditCalls.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('COUNT(*)')) {
      return { rows: [{ total: '7' }] };
    }
    if (text.includes('UPDATE fraud_cases')) {
      if (text.includes('owner_admin_id')) caseState.owner_admin_id = params[0];
      if (text.includes('SET status')) {
        caseState.status = params[0];
        if (text.includes('resolved_at = NOW()')) {
          caseState.resolved_at = '2026-09-29T01:00:00.000Z';
        }
      }
      if (text.includes('evidence =')) caseState.evidence = JSON.parse(params[0]);
      caseState.updated_at = '2026-09-29T01:00:00.000Z';
      return { rows: [caseState] };
    }
    if (text.includes('FROM fraud_cases')) {
      // Return a copy: a real DB would not let the UPDATE mutate the
      // row object this SELECT handed out.
      return { rows: caseState ? [{ ...caseState }] : [] };
    }
    if (text.includes('FROM users')) {
      return assigneeRole ? { rows: [{ id: params[0], role: assigneeRole }] } : { rows: [] };
    }
    if (text.includes('FROM disputes')) {
      return disputeExists ? { rows: [{ id: params[0] }] } : { rows: [] };
    }
    return { rows: [] };
  });
  return caseState;
}

function auditActions() {
  // action is the $2 param of the audit INSERT (admin_id, action, ...)
  return auditCalls.map((params) => params[1]);
}

beforeEach(() => {
  resetMocks();
  fraudCaseService.createFraudCase.mockReset();
});

// ─── manual creation ─────────────────────────────────────────────

test('POST /cases creates a manual case through fraudCaseService and audits it', async () => {
  installFraudMock({ caseState: null });
  const created = makeCase({ source: 'manual' });
  fraudCaseService.createFraudCase.mockResolvedValue(created);

  const res = responseDouble();
  const next = jest.fn();
  await controller.createFraudCase(
    requestDouble({
      body: {
        subject_type: 'user',
        subject_id: 'user-1',
        category: 'chargeback',
        summary: 'Suspicious chargeback pattern',
        severity: 'high',
      },
    }),
    res,
    next
  );

  expect(next).not.toHaveBeenCalled();
  expect(fraudCaseService.createFraudCase).toHaveBeenCalledWith({
    subjectType: 'user',
    subjectId: 'user-1',
    category: 'chargeback',
    severity: 'high',
    source: 'manual',
    sourceRef: null,
    summary: 'Suspicious chargeback pattern',
    evidence: {},
    db: expect.anything(),
  });
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith({ success: true, data: created });
  expect(auditActions()).toEqual(['fraud_case_create']);
});

test('POST /cases defaults severity to medium and rejects invalid enums', async () => {
  installFraudMock({ caseState: null });
  fraudCaseService.createFraudCase.mockResolvedValue(makeCase());

  const res = responseDouble();
  await controller.createFraudCase(
    requestDouble({
      body: { subject_type: 'user', subject_id: 'user-1', category: 'other', summary: 'x' },
    }),
    res,
    jest.fn()
  );
  expect(fraudCaseService.createFraudCase.mock.calls[0][0].severity).toBe('medium');
  expect(auditActions()).toEqual(['fraud_case_create']);

  const badRes = responseDouble();
  const next = jest.fn();
  await controller.createFraudCase(
    requestDouble({
      body: { subject_type: 'alien', subject_id: 'user-1', category: 'nope', summary: '' },
    }),
    badRes,
    next
  );
  expect(next).toHaveBeenCalled();
  const err = next.mock.calls[0][0];
  expect(err.statusCode).toBe(400);
  expect(err.code).toBe('validation_failed');
  expect(fraudCaseService.createFraudCase).toHaveBeenCalledTimes(1);
});

// ─── lifecycle ───────────────────────────────────────────────────

test('lifecycle: open -> investigating -> resolved sets resolved_at', async () => {
  const caseState = installFraudMock();

  const res1 = responseDouble();
  await controller.investigateFraudCase(
    requestDouble({ params: { id: CASE_ID } }),
    res1,
    jest.fn()
  );
  expect(res1.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ status: 'investigating' }) });

  const res2 = responseDouble();
  await controller.resolveFraudCase(
    requestDouble({ params: { id: CASE_ID } }),
    res2,
    jest.fn()
  );
  const resolved = res2.json.mock.calls[0][0].data;
  expect(resolved.status).toBe('resolved');
  expect(resolved.resolved_at).not.toBeNull();
  expect(auditActions()).toEqual(['fraud_case_investigate', 'fraud_case_resolve']);
});

test('resolved case cannot move back to investigating (400 invalid_transition)', async () => {
  installFraudMock({ caseState: makeCase({ status: 'resolved', resolved_at: '2026-09-29T01:00:00.000Z' }) });

  const res = responseDouble();
  const next = jest.fn();
  await controller.investigateFraudCase(
    requestDouble({ params: { id: CASE_ID } }),
    res,
    next
  );

  expect(next).toHaveBeenCalled();
  const err = next.mock.calls[0][0];
  expect(err.statusCode).toBe(400);
  expect(err.code).toBe('invalid_transition');
  expect(res.json).not.toHaveBeenCalled();
  expect(auditActions()).toEqual([]);
});

test('dismiss from open sets dismissed + resolved_at and is audited', async () => {
  installFraudMock();

  const res = responseDouble();
  await controller.dismissFraudCase(
    requestDouble({ params: { id: CASE_ID } }),
    res,
    jest.fn()
  );
  const dismissed = res.json.mock.calls[0][0].data;
  expect(dismissed.status).toBe('dismissed');
  expect(dismissed.resolved_at).not.toBeNull();
  expect(auditActions()).toEqual(['fraud_case_dismiss']);
});

test('dismissed case cannot be resolved', async () => {
  installFraudMock({ caseState: makeCase({ status: 'dismissed' }) });

  const next = jest.fn();
  await controller.resolveFraudCase(
    requestDouble({ params: { id: CASE_ID } }),
    responseDouble(),
    next
  );
  expect(next.mock.calls[0][0].statusCode).toBe(400);
});

// ─── assign ──────────────────────────────────────────────────────

test('assign sets owner_admin_id and audits before/after', async () => {
  installFraudMock();

  const res = responseDouble();
  await controller.assignFraudCase(
    requestDouble({ params: { id: CASE_ID }, body: { admin_id: ASSIGNEE_ID } }),
    res,
    jest.fn()
  );

  const data = res.json.mock.calls[0][0].data;
  expect(data.owner_admin_id).toBe(ASSIGNEE_ID);
  expect(auditActions()).toEqual(['fraud_case_assign']);
  const assignAudit = auditCalls[0];
  expect(assignAudit[1]).toBe('fraud_case_assign');
  // before_state is $9, after_state is $10 in the audit INSERT
  expect(JSON.parse(assignAudit[8])).toEqual({ owner_admin_id: null });
  expect(JSON.parse(assignAudit[9])).toEqual({ owner_admin_id: ASSIGNEE_ID });
});

test('assign rejects a non-UUID admin_id and a non-admin user', async () => {
  installFraudMock();

  const next1 = jest.fn();
  await controller.assignFraudCase(
    requestDouble({ params: { id: CASE_ID }, body: { admin_id: 'not-a-uuid' } }),
    responseDouble(),
    next1
  );
  expect(next1.mock.calls[0][0].statusCode).toBe(400);

  installFraudMock({ assigneeRole: 'helper' });
  const next2 = jest.fn();
  await controller.assignFraudCase(
    requestDouble({ params: { id: CASE_ID }, body: { admin_id: ASSIGNEE_ID } }),
    responseDouble(),
    next2
  );
  expect(next2.mock.calls[0][0].statusCode).toBe(400);
});

// ─── link-dispute ────────────────────────────────────────────────

test('link-dispute appends to evidence.disputes, dedupes, and audits', async () => {
  installFraudMock();

  const req = () => requestDouble({ params: { id: CASE_ID }, body: { dispute_id: 42 } });

  const res1 = responseDouble();
  await controller.linkDispute(req(), res1, jest.fn());
  expect(res1.json.mock.calls[0][0].data.evidence.disputes).toEqual([42]);

  // linking the same dispute twice does not duplicate it
  const res2 = responseDouble();
  await controller.linkDispute(req(), res2, jest.fn());
  expect(res2.json.mock.calls[0][0].data.evidence.disputes).toEqual([42]);

  expect(auditActions()).toEqual(['fraud_case_link_dispute', 'fraud_case_link_dispute']);
});

test('link-dispute 404s on an unknown dispute', async () => {
  installFraudMock({ disputeExists: false });

  const next = jest.fn();
  await controller.linkDispute(
    requestDouble({ params: { id: CASE_ID }, body: { dispute_id: 999 } }),
    responseDouble(),
    next
  );
  expect(next.mock.calls[0][0].statusCode).toBe(404);
  expect(next.mock.calls[0][0].code).toBe('dispute_not_found');
});

// ─── list ────────────────────────────────────────────────────────

test('list applies filters and pagination and returns the contract shape', async () => {
  installFraudMock();
  const rows = [makeCase(), makeCase({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })];
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('INSERT INTO admin_audit_log')) return { rows: [], rowCount: 1 };
    if (text.includes('COUNT(*)')) return { rows: [{ total: '7' }] };
    return { rows };
  });

  const res = responseDouble();
  await controller.listFraudCases(
    requestDouble({
      query: {
        category: 'chargeback',
        severity: 'high',
        status: 'open',
        subject_type: 'user',
        subject_id: 'user-1',
        page: '2',
        limit: '50',
      },
    }),
    res,
    jest.fn()
  );

  const listSql = mockQuery.mock.calls.find(([sql]) => String(sql).includes('FROM fraud_cases') && String(sql).includes('LIMIT'))[0];
  expect(String(listSql)).toContain('category = $1');
  expect(String(listSql)).toContain('subject_id = $5');
  expect(String(listSql)).toContain('LIMIT $6 OFFSET $7');
  const listParams = mockQuery.mock.calls.find(([sql]) => String(sql).includes('LIMIT $6'))[1];
  expect(listParams).toEqual(['chargeback', 'high', 'open', 'user', 'user-1', 50, 50]);

  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: { cases: rows, total: 7, page: 2, limit: 50 },
  });
});

test('list rejects invalid filter enums with 400', async () => {
  installFraudMock();

  const next = jest.fn();
  await controller.listFraudCases(
    requestDouble({ query: { severity: 'extreme' } }),
    responseDouble(),
    next
  );
  expect(next.mock.calls[0][0].statusCode).toBe(400);
});

// ─── route gating ────────────────────────────────────────────────

test('every fraud route is gated by requireAdmin', () => {
  const layers = fraudRoutes.stack.filter((l) => l.route);
  const summary = layers.map((l) => ({
    path: l.route.path,
    methods: Object.keys(l.route.methods),
  }));

  expect(summary).toEqual(
    expect.arrayContaining([
      { path: '/cases', methods: ['get'] },
      { path: '/cases', methods: ['post'] },
      { path: '/cases/:id/assign', methods: ['post'] },
      { path: '/cases/:id/investigate', methods: ['post'] },
      { path: '/cases/:id/resolve', methods: ['post'] },
      { path: '/cases/:id/dismiss', methods: ['post'] },
      { path: '/cases/:id/link-dispute', methods: ['post'] },
    ])
  );

  for (const layer of layers) {
    const handles = layer.route.stack.map((s) => s.handle);
    expect(handles).toContain(requireAdmin);
  }
});
