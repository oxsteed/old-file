'use strict';

/**
 * DB tests: F-22 pay-run records (migration 99917) — immutable payroll
 * snapshots with a native CSV export.
 *
 *   - create builds a draft from the current labor computation;
 *   - finalize snapshots totals and is append-only (second finalize 409s);
 *   - finalize fails closed when employees have hours but no wage rate;
 *   - the CSV export always reflects the finalized snapshot (drafts 409);
 *   - void moves to the voided state, never deletes; double void 409s;
 *   - every action is audited; payroll.manage gates mutations and
 *     payroll.view gates reads/exports (manager default: neither).
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
*   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantPayRuns.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'pay-run-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));

const { resolveRestaurantAccess } = require('../services/scopeModel');
const pool = require('../db');
const controller = require('../controllers/restaurantPayrollController');

jest.setTimeout(60000);

const accessByUser = new Map();
resolveRestaurantAccess.mockImplementation(async (userId) => {
  const row = accessByUser.get(String(userId));
  if (!row) {
    const err = new Error('Restaurant not found');
    err.statusCode = 404;
    err.code = 'restaurant_not_found';
    throw err;
  }
  return row;
});

function mockReq({ params = {}, query = {}, body = {}, user = { id: 'nobody' } } = {}) {
  return { params, query, body, user, headers: {}, get: () => undefined };
}
function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; return res; });
  res.send = jest.fn((body) => { res.body = body; return res; });
  return res;
}
async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

async function makeUser() {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Pay', 'Run', 'customer', TRUE, TRUE)`,
    [id, `payrun-${id}@example.invalid`]
  );
  return id;
}

async function auditCount(businessId, action) {
  const { rows: [row] } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM business_audit_log WHERE business_id = $1 AND action = $2',
    [businessId, action]
  );
  return row.n;
}

ddescribe('F-22 pay-run records', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const manager = await makeUser();
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Pay Run ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
      [biz.id, owner, 'Pay Run Diner']
    );
    const { rows: [membership] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active') RETURNING id`,
      [biz.id, owner, manager, `mgr-${manager.slice(0, 8)}@example.invalid`]
    );
    const base = {
      id: rest.id, business_id: biz.id, timezone: 'America/New_York', currency_code: 'USD',
    };
    accessByUser.set(String(owner), { ...base, effective_role: 'owner', effective_membership_id: null });
    // Phase 5 checker: a second payroll.manage holder, distinct from
    // the maker. Owner role holds every permission in the mock, same
    // as the maker, so the only difference is identity.
    accessByUser.set(String(checker), { ...base, effective_role: 'owner', effective_membership_id: null });
    accessByUser.set(String(manager), {
      ...base, effective_role: 'manager', effective_membership_id: membership.id,
    });
    F = { owner, checker, manager, businessId: biz.id, restaurantId: rest.id };
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  const period = () => ({ periodFrom: '2026-10-01', periodTo: '2026-10-15' });

  test('create builds a draft; finalize snapshots totals; export matches the snapshot', async () => {
    const created = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(created.err).toBeNull();
    expect(created.res.statusCode).toBe(201);
    const run = created.res.payload.payRun;
    expect(run.status).toBe('draft');
    expect(new Date(run.period_from).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(new Date(run.period_to).toISOString().slice(0, 10)).toBe('2026-10-15');
    expect(Array.isArray(run.lines)).toBe(true);

    // Drafts cannot be exported: nothing approved yet.
    const draftExport = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(draftExport.err).toMatchObject({ code: 'pay_run_not_finalized' });

    const finalized = await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(finalized.err).toBeNull();
    expect(finalized.res.payload.payRun.status).toBe('finalized');
    expect(finalized.res.payload.payRun.totals.currency).toBe('USD');
    expect(finalized.res.payload.payRun.finalized_by).toBe(F.owner);

    // Finalizing twice fails closed.
    const again = await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(again.err).toMatchObject({ code: 'pay_run_not_draft' });

    // Phase 5: a finalized-but-unapproved run cannot export.
    const unapprovedExport = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(unapprovedExport.err).toMatchObject({ code: 'pay_run_not_approved' });

    // The maker cannot approve their own run.
    const selfApprove = await call(
      controller.approvePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(selfApprove.err).toMatchObject({ code: 'pay_run_self_approval' });

    const approved = await call(
      controller.approvePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.checker } })
    );
    expect(approved.err).toBeNull();
    expect(approved.res.payload.payRun.approved_by).toBe(F.checker);
    expect(approved.res.payload.payRun.approved_at).not.toBeNull();

    const exported = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(exported.err).toBeNull();
    expect(exported.res.headers['Content-Type']).toContain('text/csv');
    expect(exported.res.headers['Content-Disposition']).toContain(`pay-run-${run.id}`);
    expect(exported.res.body).toContain('employee_name,user_id,regular_hours');
    expect(exported.res.body).toContain('tip_out_cents,tip_in_cents');
    expect(exported.res.body).toContain(`run ${run.id}`);

    const listed = await call(
      controller.listPayRuns,
      mockReq({ params: { restaurantId: F.restaurantId }, user: { id: F.owner } })
    );
    expect(listed.err).toBeNull();
    expect(listed.res.payload.payRuns.some((r) => Number(r.id) === Number(run.id))).toBe(true);

    F.finalizedRunId = run.id;
  });

  test('void is append-only; double void fails closed', async () => {
    // Finding 41: voiding a finalized run is two-step. The request
    // records the maker and returns 202 with the run still finalized.
    const requested = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.owner } })
    );
    expect(requested.err).toBeNull();
    expect(requested.res.statusCode).toBe(202);
    expect(requested.res.payload.payRun.status).toBe('finalized');
    expect(requested.res.payload.payRun.void_requested_by).toBe(F.owner);
    expect(requested.res.payload.payRun.voidPending).toBe(true);
    // A second request while one is pending is a 409.
    const dup = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.owner } })
    );
    expect(dup.err).toMatchObject({ code: 'pay_run_void_already_requested' });
    // A second payroll manager completes the void.
    const voided = await call(
      controller.approveVoidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.checker } })
    );
    expect(voided.err).toBeNull();
    expect(voided.res.payload.payRun.status).toBe('voided');
    expect(voided.res.payload.payRun.void_approved_by).toBe(F.checker);
    expect(voided.res.payload.payRun.voidPending).toBe(false);
    // The row still exists with its snapshot intact.
    const fetched = await call(
      controller.getPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.owner } })
    );
    expect(fetched.err).toBeNull();
    expect(fetched.res.payload.payRun.totals.currency).toBe('USD');

    const again = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.owner } })
    );
    expect(again.err).toMatchObject({ code: 'pay_run_already_voided' });
    const againApprove = await call(
      controller.approveVoidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.checker } })
    );
    expect(againApprove.err).toMatchObject({ code: 'pay_run_already_voided' });
  });

  test('finding 41: the void requester and the finalizer cannot approve the void; drafts still void in one step', async () => {
    const approver = await makeUser();
    accessByUser.set(String(approver), {
      id: F.restaurantId, business_id: F.businessId, timezone: 'America/New_York', currency_code: 'USD',
      effective_role: 'owner', effective_membership_id: null,
    });
    const created = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(created.err).toBeNull();
    const runId = created.res.payload.payRun.id;
    const finalized = await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(finalized.err).toBeNull();
    // The void requester is the checker here, not the finalizer.
    const requested = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.checker } })
    );
    expect(requested.err).toBeNull();
    expect(requested.res.statusCode).toBe(202);
    // Neither the requester nor the finalizer can approve the void.
    const selfApprove = await call(
      controller.approveVoidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.checker } })
    );
    expect(selfApprove.err).toMatchObject({ code: 'pay_run_void_self_approval', statusCode: 403 });
    const finalizerApprove = await call(
      controller.approveVoidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(finalizerApprove.err).toMatchObject({ code: 'pay_run_void_finalizer_approval', statusCode: 403 });
    const voided = await call(
      controller.approveVoidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: approver } })
    );
    expect(voided.err).toBeNull();
    expect(voided.res.payload.payRun.status).toBe('voided');

    // A draft run still voids in one step by one manager.
    const draft = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(draft.err).toBeNull();
    const draftVoided = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: draft.res.payload.payRun.id }, user: { id: F.owner } })
    );
    expect(draftVoided.err).toBeNull();
    expect(draftVoided.res.statusCode).toBe(200);
    expect(draftVoided.res.payload.payRun.status).toBe('voided');
    expect(draftVoided.res.payload.payRun.void_requested_by).toBeNull();
  });

  test('finalize fails closed when hours lack a wage rate', async () => {
    const created = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(created.err).toBeNull();
    const runId = created.res.payload.payRun.id;
    // Simulate an employee with clocked hours but no wage rate on record.
    await pool.query(
      `INSERT INTO restaurant_pay_run_lines
         (pay_run_id, staff_label, regular_hours, overtime_hours,
          hourly_wage_cents, wages_cents, gross_tips_cents, net_tips_cents, total_pay_cents)
       VALUES ($1, 'Wageless Worker', 8, 0, NULL, NULL, 0, 0, 0)`,
      [runId]
    );
    const finalized = await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(finalized.err).toMatchObject({ code: 'pay_run_missing_wages' });
    // Still a draft: nothing was snapshotted.
    const fetched = await call(
      controller.getPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(fetched.res.payload.payRun.status).toBe('draft');
  });

  test('payroll.manage gates mutations; payroll.view gates reads (manager default: neither)', async () => {
    const denied = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.manager } })
    );
    expect(denied.err).toMatchObject({ code: 'payroll_permission_required' });

    const deniedExport = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.manager } })
    );
    expect(deniedExport.err).toMatchObject({ code: 'payroll_permission_required' });
  });

  test('Phase 5: provider export renders approved lines with currency per row', async () => {
    const created = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(created.err).toBeNull();
    const runId = created.res.payload.payRun.id;
    const finalized = await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(finalized.err).toBeNull();

    // Provider format is a release too: unapproved runs cannot use it.
    const blocked = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, query: { format: 'provider' }, user: { id: F.owner } })
    );
    expect(blocked.err).toMatchObject({ code: 'pay_run_not_approved' });

    const approved = await call(
      controller.approvePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.checker } })
    );
    expect(approved.err).toBeNull();
    const again = await call(
      controller.approvePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.checker } })
    );
    expect(again.err).toMatchObject({ code: 'pay_run_already_approved' });

    const exported = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, query: { format: 'provider' }, user: { id: F.owner } })
    );
    expect(exported.err).toBeNull();
    expect(exported.res.headers['Content-Disposition']).toContain('-provider.csv');
    expect(exported.res.body).toContain('employee_name,employee_id,period_from,period_to');
    expect(exported.res.body).toContain('tip_out_cents,tip_in_cents');
    expect(exported.res.body).toContain('currency_code');

    const unknown = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, query: { format: 'xml' }, user: { id: F.owner } })
    );
    expect(unknown.err).toMatchObject({ code: 'pay_run_export_format_unknown' });
  });

  test('Phase 5: disbursement ledger reconciles per-employee amounts to the run total', async () => {
    const created = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(created.err).toBeNull();
    const runId = created.res.payload.payRun.id;
    // Two waged lines with known totals: 17000 + 9000 = 26000.
    const { rows: lines } = await pool.query(
      `INSERT INTO restaurant_pay_run_lines
         (pay_run_id, staff_user_id, staff_label, regular_hours, overtime_hours,
          hourly_wage_cents, regular_wages_cents, wages_cents,
          gross_tips_cents, tip_out_cents, tip_in_cents, net_tips_cents, total_pay_cents)
       VALUES
         ($1, $2, 'Ana', 10, 0, 1500, 15000, 15000, 2000, 500, 0, 1500, 17000),
         ($1, $3, 'Ben', 5, 0, 1800, 9000, 9000, 0, 0, 0, 0, 9000)
       RETURNING id, total_pay_cents`,
      [runId, F.owner, F.checker]
    );
    const [lineA, lineB] = lines;
    const finalized = await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(finalized.err).toBeNull();
    expect(finalized.res.payload.payRun.totals.total_pay_cents).toBe(26000);
    expect(finalized.res.payload.payRun.lines.find((l) => Number(l.id) === Number(lineA.id)).tip_out_cents).toBe(500);
    // The run also carries the zero-hour roster lines computeLabor
    // produced; every line, including a zero-total one, must be
    // covered before the run can read as paid.
    const { rows: allLines } = await pool.query(
      'SELECT id, total_pay_cents FROM restaurant_pay_run_lines WHERE pay_run_id = $1 ORDER BY id',
      [runId]
    );
    const zeroLines = allLines.filter((l) => Number(l.total_pay_cents) === 0);
    expect(allLines).toHaveLength(2 + zeroLines.length);

    // Disbursement before approval fails closed.
    const early = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payRunLineId: lineA.id, amountCents: 17000, method: 'bank_transfer' },
        user: { id: F.owner },
      })
    );
    expect(early.err).toMatchObject({ code: 'pay_run_not_approved' });

    const approved = await call(
      controller.approvePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.checker } })
    );
    expect(approved.err).toBeNull();

    // A disbursement must equal the line total exactly.
    const mismatch = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payRunLineId: lineA.id, amountCents: 17001, method: 'bank_transfer' },
        user: { id: F.owner },
      })
    );
    expect(mismatch.err).toMatchObject({ code: 'pay_run_disbursement_amount_mismatch' });

    const first = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payRunLineId: lineA.id, amountCents: 17000, method: 'bank_transfer', reference: 'ACH-1' },
        user: { id: F.owner },
      })
    );
    expect(first.err).toBeNull();
    expect(first.res.statusCode).toBe(201);
    // One of two lines covered: still finalized, never half-paid.
    expect(first.res.payload.payRun.status).toBe('finalized');
    expect(first.res.payload.payRun.disbursementCoverage).toMatchObject({
      lines_covered: 1, lines_total: allLines.length, disbursed_cents: 17000, run_total_cents: 26000, fully_covered: false,
    });

    const duplicate = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payRunLineId: lineA.id, amountCents: 17000, method: 'cash' },
        user: { id: F.owner },
      })
    );
    expect(duplicate.err).toMatchObject({ code: 'pay_run_disbursement_duplicate' });

    const second = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payRunLineId: lineB.id, amountCents: 9000, method: 'provider_export', reference: 'GUSTO-7' },
        user: { id: F.owner },
      })
    );
    expect(second.err).toBeNull();
    // Both waged lines covered, but zero-total lines remain: the run
    // is still not fully covered, so it stays finalized.
    expect(second.res.payload.payRun.status).toBe('finalized');
    expect(second.res.payload.payRun.disbursementCoverage).toMatchObject({
      lines_covered: 2, lines_total: allLines.length, disbursed_cents: 26000, run_total_cents: 26000, fully_covered: false,
    });

    // Cover the zero-total lines with zero-amount records: now every
    // line is covered and the sum equals the run total, so it is paid.
    let paid = null;
    for (const zeroLine of zeroLines) {
      paid = await call(
        controller.recordPayRunDisbursement,
        mockReq({
          params: { restaurantId: F.restaurantId, payRunId: runId },
          body: { payRunLineId: zeroLine.id, amountCents: 0, method: 'bank_transfer' },
          user: { id: F.owner },
        })
      );
      expect(paid.err).toBeNull();
    }
    expect(paid.res.payload.payRun.status).toBe('paid');
    expect(paid.res.payload.payRun.disbursementCoverage).toMatchObject({
      lines_covered: allLines.length, lines_total: allLines.length,
      disbursed_cents: 26000, run_total_cents: 26000, fully_covered: true,
    });
    expect(paid.res.payload.payRun.disbursements).toHaveLength(allLines.length);
  });

  test('Phase 5: a run with disbursements cannot be voided away', async () => {
    const created = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(created.err).toBeNull();
    const runId = created.res.payload.payRun.id;
    const { rows: lines } = await pool.query(
      `INSERT INTO restaurant_pay_run_lines
         (pay_run_id, staff_user_id, staff_label, regular_hours,
          hourly_wage_cents, wages_cents, gross_tips_cents, net_tips_cents, total_pay_cents)
       VALUES ($1, $2, 'Ana', 10, 1500, 15000, 0, 0, 15000),
              ($1, $3, 'Ben', 5, 1800, 9000, 0, 0, 9000)
       RETURNING id`,
      [runId, F.owner, F.checker]
    );
    await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    await call(
      controller.approvePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.checker } })
    );
    const recorded = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payRunLineId: lines[0].id, amountCents: 15000, method: 'cash' },
        user: { id: F.owner },
      })
    );
    expect(recorded.err).toBeNull();
    // One line disbursed: still finalized, but the money record blocks voiding.
    expect(recorded.res.payload.payRun.status).toBe('finalized');
    const voided = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(voided.err).toMatchObject({ code: 'pay_run_has_disbursements' });
  });

  test('Domain 8 #3: a run is settled by payout links or by disbursements, never both', async () => {
    // Direction 1: a partial link first, then a disbursement must fail.
    const created = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(created.err).toBeNull();
    const runId = created.res.payload.payRun.id;
    const { rows: lines } = await pool.query(
      `INSERT INTO restaurant_pay_run_lines
         (pay_run_id, staff_user_id, staff_label, regular_hours,
          hourly_wage_cents, wages_cents, gross_tips_cents, net_tips_cents, total_pay_cents)
       VALUES ($1, $2, 'Ana', 10, 1500, 15000, 0, 0, 15000),
              ($1, $3, 'Ben', 5, 1800, 9000, 0, 0, 9000)
       RETURNING id, total_pay_cents`,
      [runId, F.owner, F.checker]
    );
    await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    await call(
      controller.approvePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.checker } })
    );
    const payoutId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO restaurant_payouts
         (id, restaurant_id, currency_code, amount_cents, status, stripe_account_id, idempotency_key, requested_by, completed_at)
       VALUES ($1, $2, 'USD', 5000, 'completed', 'acct_test_link', $3, $4, NOW())`,
      [payoutId, F.restaurantId, `link-${payoutId}`, F.owner]
    );
    const linked = await call(
      controller.linkPayRunPayout,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payoutId },
        user: { id: F.owner },
      })
    );
    expect(linked.err).toBeNull();
    // A $5,000 link against a $24,000 total leaves the run finalized.
    // (Before the flip fix, the untyped $2 >= $3 comparison in SQL
    // inferred both sides as text, so '5000' >= '24000' flipped the
    // run paid on a partial link.)
    expect(linked.res.payload.payRun.status).toBe('finalized');
    // Before the fix this disbursement landed and the run could then
    // flip paid carrying $5,000 linked plus $24,000 disbursed against
    // a $24,000 obligation.
    const disbursed = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payRunLineId: lines[0].id, amountCents: 15000, method: 'bank_transfer' },
        user: { id: F.owner },
      })
    );
    expect(disbursed.err).toMatchObject({ code: 'pay_run_has_payout_links' });
    const { rows: [stillFinalized] } = await pool.query(
      'SELECT status FROM restaurant_pay_runs WHERE id = $1', [runId]
    );
    expect(stillFinalized.status).toBe('finalized');

    // Direction 2: a disbursement first, then a link must fail.
    const created2 = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(created2.err).toBeNull();
    const runId2 = created2.res.payload.payRun.id;
    const { rows: lines2 } = await pool.query(
      `INSERT INTO restaurant_pay_run_lines
         (pay_run_id, staff_user_id, staff_label, regular_hours,
          hourly_wage_cents, wages_cents, gross_tips_cents, net_tips_cents, total_pay_cents)
       VALUES ($1, $2, 'Ana', 10, 1500, 15000, 0, 0, 15000)
       RETURNING id`,
      [runId2, F.owner]
    );
    await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId2 }, user: { id: F.owner } })
    );
    await call(
      controller.approvePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId2 }, user: { id: F.checker } })
    );
    const recorded = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId2 },
        body: { payRunLineId: lines2[0].id, amountCents: 15000, method: 'cash' },
        user: { id: F.owner },
      })
    );
    expect(recorded.err).toBeNull();
    const payoutId2 = crypto.randomUUID();
    await pool.query(
      `INSERT INTO restaurant_payouts
         (id, restaurant_id, currency_code, amount_cents, status, stripe_account_id, idempotency_key, requested_by, completed_at)
       VALUES ($1, $2, 'USD', 15000, 'completed', 'acct_test_link', $3, $4, NOW())`,
      [payoutId2, F.restaurantId, `link-${payoutId2}`, F.owner]
    );
    const linked2 = await call(
      controller.linkPayRunPayout,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId2 },
        body: { payoutId: payoutId2 },
        user: { id: F.owner },
      })
    );
    expect(linked2.err).toMatchObject({ code: 'pay_run_has_disbursements' });
  });

  test('pay-run actions are audited', async () => {
    expect(await auditCount(F.businessId, 'restaurant.pay_run.created')).toBeGreaterThan(0);
    expect(await auditCount(F.businessId, 'restaurant.pay_run.finalized')).toBeGreaterThan(0);
    expect(await auditCount(F.businessId, 'restaurant.pay_run.approved')).toBeGreaterThan(0);
    expect(await auditCount(F.businessId, 'restaurant.pay_run.exported')).toBeGreaterThan(0);
    expect(await auditCount(F.businessId, 'restaurant.pay_run.disbursement_recorded')).toBeGreaterThan(0);
    expect(await auditCount(F.businessId, 'restaurant.pay_run.voided')).toBeGreaterThan(0);
  });
});
