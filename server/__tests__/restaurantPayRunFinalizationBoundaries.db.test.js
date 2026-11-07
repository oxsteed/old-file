'use strict';

/**
 * DB tests: pay-run finalization boundaries (design review 2026-11-06,
 * findings 15, 40, 9, 5).
 *
 *   15 - finalize fails closed on system-closed punches, pending punch
 *        corrections, and pending cash-tip declarations in the period.
 *   40 - voiding a member run of a live (finalized/approved)
 *        consolidation is blocked; voiding the consolidation first
 *        unblocks it. A draft consolidation does not block.
 *    9 - a wrongly recorded disbursement can be voided (reversed) with
 *        an audit row; the run drops back to finalized, the line reads
 *        unpaid again, and the run can then be voided normally.
 *    5 - inputs recorded after finalization (late premiums, late-
 *        confirmed cash tips, late-approved punch corrections) are
 *        carried into the next run as clearly-marked lines, and a
 *        finalized run reports them via inputs_changed_since_finalization.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
*   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantPayRunFinalizationBoundaries.db.test.js
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
  process.env['JWT' + '_SECRET'] = 'pay-run-boundaries-test-secret';
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
const consolidationController = require('../controllers/restaurantPayRunConsolidationController');

jest.setTimeout(60000);

const accessByUser = new Map();
resolveRestaurantAccess.mockImplementation(async (userId, restaurantId) => {
  const row = accessByUser.get(`${String(userId)}:${restaurantId}`);
  if (row) return row;
  // Consolidation brand loading calls with the restaurant id; the
  // payroll controller calls with (userId) only in some paths, so
  // fall back to a user-keyed entry when no restaurant was given.
  if (restaurantId === undefined) {
    for (const [key, value] of accessByUser) {
      if (key.startsWith(`${String(userId)}:`)) return value;
    }
  }
  const err = new Error('Restaurant not found');
  err.statusCode = 404;
  err.code = 'restaurant_not_found';
  throw err;
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
     VALUES ($1, $2, 'x', 'Boundary', 'Tester', 'customer', TRUE, TRUE)`,
    [id, `boundary-${id}@example.invalid`]
  );
  return id;
}

async function makeRestaurant(owner, checker) {
  const { rows: [biz] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [owner, `Boundary ${crypto.randomUUID().slice(0, 8)}`]
  );
  const { rows: [rest] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
     VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id, brand_id`,
    [biz.id, owner, 'Boundary Diner']
  );
  const base = {
    id: rest.id, business_id: biz.id, timezone: 'America/New_York', currency_code: 'USD',
  };
  for (const userId of [owner, checker]) {
    accessByUser.set(`${userId}:${rest.id}`, { ...base, effective_role: 'owner', effective_membership_id: null });
  }
  return { businessId: biz.id, restaurantId: rest.id, brandId: Number(rest.brand_id) };
}

async function makeStaff(businessId, ownerId, wageCents) {
  const userId = await makeUser();
  await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, hourly_wage_cents)
     VALUES ($1, $2, $3, 'employee', $4, 'active', $5)`,
    [businessId, ownerId, userId, `staff-${userId.slice(0, 8)}@example.invalid`, wageCents]
  );
  return userId;
}

async function createRun(userId, restaurantId, from, to) {
  const created = await call(
    controller.createPayRun,
    mockReq({ params: { restaurantId }, body: { periodFrom: from, periodTo: to }, user: { id: userId } })
  );
  expect(created.err).toBeNull();
  return created.res.payload.payRun;
}

async function finalizeRun(userId, restaurantId, runId) {
  return call(
    controller.finalizePayRun,
    mockReq({ params: { restaurantId, payRunId: runId }, user: { id: userId } })
  );
}

async function approveRun(userId, restaurantId, runId) {
  return call(
    controller.approvePayRun,
    mockReq({ params: { restaurantId, payRunId: runId }, user: { id: userId } })
  );
}

async function getRun(userId, restaurantId, runId) {
  const fetched = await call(
    controller.getPayRun,
    mockReq({ params: { restaurantId, payRunId: runId }, user: { id: userId } })
  );
  expect(fetched.err).toBeNull();
  return fetched.res.payload.payRun;
}

// A run with exactly one waged line, so one disbursement flips it to
// paid and one void flips it back. Roster zero-lines are removed.
async function makeSingleLineRun(owner, checker, restaurantId, from, to, staffUserId, totalCents) {
  const run = await createRun(owner, restaurantId, from, to);
  await pool.query('DELETE FROM restaurant_pay_run_lines WHERE pay_run_id = $1', [run.id]);
  const { rows: [line] } = await pool.query(
    `INSERT INTO restaurant_pay_run_lines
       (pay_run_id, staff_user_id, staff_label, regular_hours, overtime_hours,
        hourly_wage_cents, regular_wages_cents, wages_cents,
        gross_tips_cents, tip_out_cents, tip_in_cents, net_tips_cents, total_pay_cents)
     VALUES ($1, $2, 'Ana', 10, 0, 1500, 15000, 15000, 0, 0, 0, 0, $3)
     RETURNING id`,
    [run.id, staffUserId, totalCents]
  );
  return { run, lineId: Number(line.id) };
}

ddescribe('Finding 15: finalize fails closed on unsettled period work', () => {
  test('system-closed punch blocks finalize; voiding the punch unblocks', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    await pool.query(
      `INSERT INTO business_time_entries
         (business_id, user_id, entry_date, clock_in_at, clock_out_at,
          hours_worked, system_closed_at, system_closed_reason)
       VALUES ($1, $2, '2026-10-05', '2026-10-05T13:00:00Z', '2026-10-05T21:00:00Z',
               8, NOW(), 'forgotten punch')`,
      [businessId, staff]
    );
    const run = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    const blocked = await finalizeRun(owner, restaurantId, run.id);
    expect(blocked.err).toMatchObject({ code: 'pay_run_finalize_system_closed_entries' });
    expect(blocked.err.fields).toMatchObject({ count: 1 });
    await pool.query(
      "UPDATE business_time_entries SET voided_at = NOW() WHERE business_id = $1 AND entry_date = '2026-10-05'",
      [businessId]
    );
    const finalized = await finalizeRun(owner, restaurantId, run.id);
    expect(finalized.err).toBeNull();
    expect(finalized.res.payload.payRun.status).toBe('finalized');
  });

  test('pending punch correction blocks finalize; deciding it unblocks', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    const { rows: [entry] } = await pool.query(
      `INSERT INTO business_time_entries
         (business_id, user_id, entry_date, clock_in_at, clock_out_at, hours_worked)
       VALUES ($1, $2, '2026-10-06', '2026-10-06T13:00:00Z', '2026-10-06T21:00:00Z', 8)
       RETURNING id`,
      [businessId, staff]
    );
    const { rows: [correction] } = await pool.query(
      `INSERT INTO business_time_entry_corrections
         (entry_id, business_id, requester_user_id, requested_clock_out_at, reason)
       VALUES ($1, $2, $3, '2026-10-06T22:00:00Z', 'stayed late') RETURNING id`,
      [entry.id, businessId, staff]
    );
    const run = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    const blocked = await finalizeRun(owner, restaurantId, run.id);
    expect(blocked.err).toMatchObject({ code: 'pay_run_finalize_pending_corrections' });
    await pool.query(
      "UPDATE business_time_entry_corrections SET status = 'rejected', decided_at = NOW() WHERE id = $1",
      [correction.id]
    );
    const finalized = await finalizeRun(owner, restaurantId, run.id);
    expect(finalized.err).toBeNull();
  });

  test('pending cash-tip declaration blocks finalize; confirming it unblocks', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    const { rows: [tip] } = await pool.query(
      `INSERT INTO restaurant_declared_cash_tips
         (restaurant_id, staff_user_id, business_date, amount_cents, status)
       VALUES ($1, $2, '2026-10-07', 2500, 'pending') RETURNING id`,
      [restaurantId, staff]
    );
    const run = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    const blocked = await finalizeRun(owner, restaurantId, run.id);
    expect(blocked.err).toMatchObject({ code: 'pay_run_finalize_pending_cash_tips' });
    await pool.query(
      "UPDATE restaurant_declared_cash_tips SET status = 'confirmed', reviewed_by = $2, reviewed_at = NOW() WHERE id = $1",
      [tip.id, checker]
    );
    const finalized = await finalizeRun(owner, restaurantId, run.id);
    expect(finalized.err).toBeNull();
  });

  test('unsettled work outside the period does not block finalize', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    await pool.query(
      `INSERT INTO business_time_entries
         (business_id, user_id, entry_date, clock_in_at, clock_out_at,
          hours_worked, system_closed_at, system_closed_reason)
       VALUES ($1, $2, '2026-11-05', '2026-11-05T13:00:00Z', '2026-11-05T21:00:00Z',
               8, NOW(), 'forgotten punch')`,
      [businessId, staff]
    );
    await pool.query(
      `INSERT INTO restaurant_declared_cash_tips
         (restaurant_id, staff_user_id, business_date, amount_cents, status)
       VALUES ($1, $2, '2026-11-06', 2500, 'pending')`,
      [restaurantId, staff]
    );
    const run = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    const finalized = await finalizeRun(owner, restaurantId, run.id);
    expect(finalized.err).toBeNull();
  });
});

ddescribe('Finding 40: voiding a run in a live consolidation is blocked', () => {
  test('finalized consolidation blocks the member void; voiding the consolidation unblocks it', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const a = await makeRestaurant(owner, checker);
    const b = await makeRestaurant(owner, checker);
    await pool.query('UPDATE food_restaurants SET brand_id = $1 WHERE id = $2', [a.brandId, b.restaurantId]);
    const runA = await createRun(owner, a.restaurantId, '2026-10-01', '2026-10-15');
    const runB = await createRun(owner, b.restaurantId, '2026-10-01', '2026-10-15');
    expect((await finalizeRun(owner, a.restaurantId, runA.id)).err).toBeNull();
    expect((await finalizeRun(owner, b.restaurantId, runB.id)).err).toBeNull();
    const created = await call(
      consolidationController.createConsolidation,
      mockReq({
        params: { brandId: String(a.brandId) },
        body: { payRunIds: [Number(runA.id), Number(runB.id)] },
        user: { id: owner },
      })
    );
    expect(created.err).toBeNull();
    const consolidationId = created.res.payload.consolidation.id;
    const finalized = await call(
      consolidationController.finalizeConsolidation,
      mockReq({ params: { brandId: String(a.brandId), consolidationId: String(consolidationId) }, user: { id: owner } })
    );
    expect(finalized.err).toBeNull();
    expect(finalized.res.payload.consolidation.status).toBe('finalized');

    const blocked = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: a.restaurantId, payRunId: runA.id }, user: { id: owner } })
    );
    expect(blocked.err).toMatchObject({ code: 'pay_run_in_live_consolidation' });
    expect(blocked.err.fields).toMatchObject({ consolidation_id: Number(consolidationId) });
    expect(String(blocked.err.message)).toContain(String(consolidationId));

    const voidedConsolidation = await call(
      consolidationController.voidConsolidation,
      mockReq({ params: { brandId: String(a.brandId), consolidationId: String(consolidationId) }, user: { id: owner } })
    );
    expect(voidedConsolidation.err).toBeNull();
    expect(voidedConsolidation.res.payload.consolidation.status).toBe('voided');

    const voided = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: a.restaurantId, payRunId: runA.id }, user: { id: owner } })
    );
    expect(voided.err).toBeNull();
    expect(voided.res.payload.payRun.status).toBe('voided');
  });

  test('a draft consolidation does not block the member void', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const a = await makeRestaurant(owner, checker);
    const b = await makeRestaurant(owner, checker);
    await pool.query('UPDATE food_restaurants SET brand_id = $1 WHERE id = $2', [a.brandId, b.restaurantId]);
    const runA = await createRun(owner, a.restaurantId, '2026-10-01', '2026-10-15');
    const runB = await createRun(owner, b.restaurantId, '2026-10-01', '2026-10-15');
    expect((await finalizeRun(owner, a.restaurantId, runA.id)).err).toBeNull();
    expect((await finalizeRun(owner, b.restaurantId, runB.id)).err).toBeNull();
    const created = await call(
      consolidationController.createConsolidation,
      mockReq({
        params: { brandId: String(a.brandId) },
        body: { payRunIds: [Number(runA.id), Number(runB.id)] },
        user: { id: owner },
      })
    );
    expect(created.err).toBeNull();
    expect(created.res.payload.consolidation.status).toBe('draft');
    const voided = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: a.restaurantId, payRunId: runA.id }, user: { id: owner } })
    );
    expect(voided.err).toBeNull();
    expect(voided.res.payload.payRun.status).toBe('voided');
  });
});

ddescribe('Finding 9: a wrongly recorded disbursement can be reversed', () => {
  test('voiding a disbursement un-marks the run paid, keeps the row visible, and unblocks the run void', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 1500);
    const { run, lineId } = await makeSingleLineRun(owner, checker, restaurantId, '2026-10-01', '2026-10-15', staff, 15000);
    expect((await finalizeRun(owner, restaurantId, run.id)).err).toBeNull();
    expect((await approveRun(checker, restaurantId, run.id)).err).toBeNull();
    const recorded = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId, payRunId: run.id },
        body: { payRunLineId: lineId, amountCents: 15000, method: 'bank_transfer', reference: 'WRONG-REF' },
        user: { id: owner },
      })
    );
    expect(recorded.err).toBeNull();
    expect(recorded.res.payload.payRun.status).toBe('paid');
    const disbursementId = recorded.res.payload.payRun.disbursements[0].id;

    // The recorder cannot void their own disbursement.
    const selfVoid = await call(
      controller.voidPayRunDisbursement,
      mockReq({
        params: { restaurantId, payRunId: run.id, disbursementId },
        body: { reason: 'wrong reference' },
        user: { id: owner },
      })
    );
    expect(selfVoid.err).toMatchObject({ code: 'pay_run_disbursement_self_void' });

    const voided = await call(
      controller.voidPayRunDisbursement,
      mockReq({
        params: { restaurantId, payRunId: run.id, disbursementId },
        body: { reason: 'wrong reference' },
        user: { id: checker },
      })
    );
    expect(voided.err).toBeNull();
    const afterVoid = voided.res.payload.payRun;
    expect(afterVoid.status).toBe('finalized');
    expect(afterVoid.disbursementCoverage).toMatchObject({ lines_covered: 0, disbursed_cents: 0, fully_covered: false });
    // The reversed row is still in the ledger, marked voided.
    expect(afterVoid.disbursements).toHaveLength(1);
    expect(afterVoid.disbursements[0]).toMatchObject({
      id: Number(disbursementId), status: 'voided', voidedBy: checker, voidReason: 'wrong reference',
    });
    expect(afterVoid.disbursements[0].voidedAt).not.toBeNull();

    // Double void fails closed.
    const again = await call(
      controller.voidPayRunDisbursement,
      mockReq({ params: { restaurantId, payRunId: run.id, disbursementId }, user: { id: checker } })
    );
    expect(again.err).toMatchObject({ code: 'pay_run_disbursement_already_voided' });

    // The line is free again: re-record correctly, and the run is paid.
    const reRecorded = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId, payRunId: run.id },
        body: { payRunLineId: lineId, amountCents: 15000, method: 'bank_transfer', reference: 'RIGHT-REF' },
        user: { id: owner },
      })
    );
    expect(reRecorded.err).toBeNull();
    expect(reRecorded.res.payload.payRun.status).toBe('paid');
    expect(reRecorded.res.payload.payRun.disbursements).toHaveLength(2);

    // Void it again, then the run itself can be voided normally.
    const reVoided = await call(
      controller.voidPayRunDisbursement,
      mockReq({
        params: { restaurantId, payRunId: run.id, disbursementId: reRecorded.res.payload.payRun.disbursements[1].id },
        body: { reason: 'reversing to void the run' },
        user: { id: checker },
      })
    );
    expect(reVoided.err).toBeNull();
    const runVoided = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId, payRunId: run.id }, user: { id: owner } })
    );
    expect(runVoided.err).toBeNull();
    expect(runVoided.res.payload.payRun.status).toBe('voided');
  });

  test('voiding a disbursement of a draft run fails closed', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 1500);
    const { run } = await makeSingleLineRun(owner, checker, restaurantId, '2026-10-01', '2026-10-15', staff, 15000);
    const voided = await call(
      controller.voidPayRunDisbursement,
      mockReq({ params: { restaurantId, payRunId: run.id, disbursementId: 999999 }, user: { id: checker } })
    );
    expect(voided.err).toMatchObject({ code: 'pay_run_not_finalized' });
  });
});

ddescribe('Finding 5: late inputs carry forward, and finalized runs flag them', () => {
  test('finalized run flags late premium, late-confirmed tip, and late-approved correction', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    const run = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    expect((await finalizeRun(owner, restaurantId, run.id)).err).toBeNull();
    const clean = await getRun(owner, restaurantId, run.id);
    expect(clean.inputsChangedSinceFinalization).toMatchObject({ has_late_inputs: false });

    // A premium recorded after finalization, for a shift in the period.
    await pool.query(
      `INSERT INTO business_staff_schedule_changes
         (business_id, shift_id, user_id, restaurant_id, change_type,
          before_state, after_state, premium_due, premium_hours, premium_cents,
          premium_currency_code, changed_by, created_at)
       VALUES ($1, 1, $2, $3, 'edited',
               '{"shift_date":"2026-10-05","start_time":"09:00","end_time":"17:00"}'::jsonb,
               '{"shift_date":"2026-10-05","start_time":"10:00","end_time":"17:00"}'::jsonb,
               TRUE, 1, 5000, 'USD', $4, NOW())`,
      [businessId, staff, restaurantId, owner]
    );
    // A cash tip for a date in the period, confirmed after finalization.
    await pool.query(
      `INSERT INTO restaurant_declared_cash_tips
         (restaurant_id, staff_user_id, business_date, amount_cents, status, reviewed_by, reviewed_at, created_at)
       VALUES ($1, $2, '2026-10-06', 3000, 'confirmed', $3, NOW(), NOW())`,
      [restaurantId, staff, checker]
    );
    // A punch correction approved after finalization, for an entry in the period.
    const { rows: [entry] } = await pool.query(
      `INSERT INTO business_time_entries
         (business_id, user_id, entry_date, clock_in_at, clock_out_at, hours_worked)
       VALUES ($1, $2, '2026-10-07', '2026-10-07T13:00:00Z', '2026-10-07T21:00:00Z', 8)
       RETURNING id`,
      [businessId, staff]
    );
    await pool.query(
      `INSERT INTO business_time_entry_corrections
         (entry_id, business_id, requester_user_id, requested_clock_out_at, reason,
          status, decided_by, decided_at)
       VALUES ($1, $2, $3, '2026-10-07T22:00:00Z', 'stayed late',
               'approved', $4, NOW())`,
      [entry.id, businessId, staff, checker]
    );

    const flagged = await getRun(owner, restaurantId, run.id);
    expect(flagged.inputsChangedSinceFinalization).toMatchObject({
      has_late_inputs: true,
      late_premiums: { count: 1, cents: 5000 },
      late_cash_tips: { count: 1, cents: 3000 },
      late_corrections: { count: 1 },
    });
  });

  test('next run carries late premium and tip as marked lines, and never carries them twice', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    const run1 = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    expect((await finalizeRun(owner, restaurantId, run1.id)).err).toBeNull();
    await pool.query(
      `INSERT INTO business_staff_schedule_changes
         (business_id, shift_id, user_id, restaurant_id, change_type,
          before_state, after_state, premium_due, premium_hours, premium_cents,
          premium_currency_code, changed_by, created_at)
       VALUES ($1, 1, $2, $3, 'edited',
               '{"shift_date":"2026-10-05","start_time":"09:00","end_time":"17:00"}'::jsonb,
               '{"shift_date":"2026-10-05","start_time":"10:00","end_time":"17:00"}'::jsonb,
               TRUE, 1, 5000, 'USD', $4, NOW())`,
      [businessId, staff, restaurantId, owner]
    );
    await pool.query(
      `INSERT INTO restaurant_declared_cash_tips
         (restaurant_id, staff_user_id, business_date, amount_cents, status, reviewed_by, reviewed_at, created_at)
       VALUES ($1, $2, '2026-10-06', 3000, 'confirmed', $3, NOW(), NOW())`,
      [restaurantId, staff, checker]
    );

    const run2 = await createRun(owner, restaurantId, '2026-10-16', '2026-10-31');
    const carryLines = run2.lines.filter((line) => line.is_carry_forward);
    expect(carryLines).toHaveLength(1);
    expect(carryLines[0]).toMatchObject({
      carried_forward_from_run_id: Number(run1.id),
      carry_forward_kind: 'mixed',
      predictability_premium_cents: 5000,
      gross_tips_cents: 3000,
      net_tips_cents: 3000,
      total_pay_cents: 8000,
    });
    // The employee's regular line for the new period is separate.
    expect(run2.lines.filter((line) => !line.is_carry_forward && line.staff_user_id === staff)).toHaveLength(1);

    // The source run no longer flags them: they were carried.
    const source = await getRun(owner, restaurantId, run1.id);
    expect(source.inputsChangedSinceFinalization).toMatchObject({
      has_late_inputs: false,
      carried_forward: { premiums: 1, cash_tips: 1 },
    });

    // A third run carries nothing twice.
    const run3 = await createRun(owner, restaurantId, '2026-11-01', '2026-11-15');
    expect(run3.lines.filter((line) => line.is_carry_forward)).toHaveLength(0);
  });

  test('next run carries late-approved correction hours at the current wage', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    // 8h on 2026-10-06 at $20/h: the first run pays $160.
    await pool.query(
      `INSERT INTO business_time_entries
         (business_id, user_id, entry_date, clock_in_at, clock_out_at, hours_worked)
       VALUES ($1, $2, '2026-10-06', '2026-10-06T13:00:00Z', '2026-10-06T21:00:00Z', 8)`,
      [businessId, staff]
    );
    const run1 = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    const staffLine1 = run1.lines.find((line) => line.staff_user_id === staff);
    expect(staffLine1).toMatchObject({ regular_hours: 8, wages_cents: 16000 });
    expect((await finalizeRun(owner, restaurantId, run1.id)).err).toBeNull();

    // Correction approved after finalization: the punch really ran
    // 10h. The entry now says so, as the approval would have left it.
    const { rows: [entry] } = await pool.query(
      "SELECT id FROM business_time_entries WHERE business_id = $1 AND entry_date = '2026-10-06'",
      [businessId]
    );
    await pool.query(
      `INSERT INTO business_time_entry_corrections
         (entry_id, business_id, requester_user_id, requested_clock_out_at, reason,
          status, decided_by, decided_at)
       VALUES ($1, $2, $3, '2026-10-06T23:00:00Z', 'stayed late',
               'approved', $4, NOW())`,
      [entry.id, businessId, staff, checker]
    );
    await pool.query(
      "UPDATE business_time_entries SET clock_out_at = '2026-10-06T23:00:00Z', hours_worked = 10 WHERE id = $1",
      [entry.id]
    );

    const run2 = await createRun(owner, restaurantId, '2026-10-16', '2026-10-31');
    const carryLines = run2.lines.filter((line) => line.is_carry_forward);
    expect(carryLines).toHaveLength(1);
    expect(carryLines[0]).toMatchObject({
      carried_forward_from_run_id: Number(run1.id),
      carry_forward_kind: 'correction_hours',
      regular_hours: 2,
      wages_cents: 4000,
      total_pay_cents: 4000,
    });

    // A third run does not carry the same 2h again.
    const run3 = await createRun(owner, restaurantId, '2026-11-01', '2026-11-15');
    expect(run3.lines.filter((line) => line.is_carry_forward)).toHaveLength(0);
  });

  test('rebuilding a draft re-derives its carry lines without duplicating them', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    const run1 = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    expect((await finalizeRun(owner, restaurantId, run1.id)).err).toBeNull();
    await pool.query(
      `INSERT INTO business_staff_schedule_changes
         (business_id, shift_id, user_id, restaurant_id, change_type,
          before_state, after_state, premium_due, premium_hours, premium_cents,
          premium_currency_code, changed_by, created_at)
       VALUES ($1, 1, $2, $3, 'edited',
               '{"shift_date":"2026-10-05","start_time":"09:00","end_time":"17:00"}'::jsonb,
               '{"shift_date":"2026-10-05","start_time":"10:00","end_time":"17:00"}'::jsonb,
               TRUE, 1, 5000, 'USD', $4, NOW())`,
      [businessId, staff, restaurantId, owner]
    );
    const run2 = await createRun(owner, restaurantId, '2026-10-16', '2026-10-31');
    expect(run2.lines.filter((line) => line.is_carry_forward)).toHaveLength(1);
    const rebuilt = await call(
      controller.rebuildPayRun,
      mockReq({ params: { restaurantId, payRunId: run2.id }, user: { id: owner } })
    );
    expect(rebuilt.err).toBeNull();
    const carryLines = rebuilt.res.payload.payRun.lines.filter((line) => line.is_carry_forward);
    expect(carryLines).toHaveLength(1);
    expect(carryLines[0]).toMatchObject({
      carried_forward_from_run_id: Number(run1.id),
      predictability_premium_cents: 5000,
      total_pay_cents: 5000,
    });
    const { rows: [carryRow] } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM restaurant_pay_run_carry_forwards WHERE target_pay_run_id = $1",
      [run2.id]
    );
    expect(carryRow.n).toBe(1);
  });

  test('a premium in another currency is flagged, not carried at face value', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    const run1 = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    expect((await finalizeRun(owner, restaurantId, run1.id)).err).toBeNull();
    await pool.query(
      `INSERT INTO business_staff_schedule_changes
         (business_id, shift_id, user_id, restaurant_id, change_type,
          before_state, after_state, premium_due, premium_hours, premium_cents,
          premium_currency_code, changed_by, created_at)
       VALUES ($1, 1, $2, $3, 'edited',
               '{"shift_date":"2026-10-05","start_time":"09:00","end_time":"17:00"}'::jsonb,
               '{"shift_date":"2026-10-05","start_time":"10:00","end_time":"17:00"}'::jsonb,
               TRUE, 1, 5000, 'EUR', $4, NOW())`,
      [businessId, staff, restaurantId, owner]
    );
    const flagged = await getRun(owner, restaurantId, run1.id);
    expect(flagged.inputsChangedSinceFinalization).toMatchObject({
      has_late_inputs: true,
      late_premiums: { count: 1, cents: 0, other_currency_count: 1 },
    });
    const run2 = await createRun(owner, restaurantId, '2026-10-16', '2026-10-31');
    expect(run2.lines.filter((line) => line.is_carry_forward)).toHaveLength(0);
    // Still flagged on the source run: it was not carried.
    const stillFlagged = await getRun(owner, restaurantId, run1.id);
    expect(stillFlagged.inputsChangedSinceFinalization.has_late_inputs).toBe(true);
  });
});

afterAll(async () => {
  await pool.end().catch(() => {});
});
