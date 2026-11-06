'use strict';

// Phase 4 Track B (goal goal_a0fc7c0f0394): PTO balances + accrual.
// Accrue, approve decrements, cancel does not, over-balance create is
// rejected, carryover cap is enforced. Service-level tests run against
// a fake db keyed on SQL fragments; controller tests run against the
// mocked pg pool with a SQL router (order-independent).

const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/restaurantWorkforceScope', () => ({
  ...jest.requireActual('../services/restaurantWorkforceScope'),
  context: jest.fn(async () => null),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
  sendBulkNotification: jest.fn().mockResolvedValue(undefined),
}));
const ctrl = require('../controllers/businessStaffScheduleController');
const pto = require('../services/ptoBalances');

const STAFF = '00000000-0000-4000-8000-0000000000aa';
const MANAGER = '00000000-0000-4000-8000-0000000000cc';

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}
const next = jest.fn();

// Fake db for the service: handlers keyed on a SQL fragment, in order.
function fakeDb(handlers) {
  return {
    query: jest.fn(async (sql, params) => {
      for (const [fragment, fn] of handlers) {
        if (String(sql).includes(fragment)) return fn(sql, params);
      }
      return { rows: [] };
    }),
  };
}

describe('ptoBalances service', () => {
  test('requestDays counts whole calendar days inclusive of both ends', () => {
    expect(pto.requestDays('2026-11-02', '2026-11-02')).toBe(1);
    expect(pto.requestDays('2026-11-02', '2026-11-04')).toBe(3);
  });

  test('consumption is days for a days policy and days x 8 hours for an hours policy', () => {
    expect(pto.consumptionFor({ accrual_unit: 'days' }, '2026-11-02', '2026-11-04'))
      .toEqual({ amount: 3, unit: 'days', days: 3 });
    expect(pto.consumptionFor({ accrual_unit: 'hours' }, '2026-11-02', '2026-11-04'))
      .toEqual({ amount: 24, unit: 'hours', days: 3 });
  });

  test('checkSufficient: no policy means unconfigured, not an error', async () => {
    const db = fakeDb([]);
    const result = await pto.checkSufficient(db, 2, STAFF, 'vacation', '2026-11-02', '2026-11-04');
    expect(result).toEqual({ enforced: false, reason: 'no_policy' });
  });

  test('checkSufficient: unpaid never draws a balance', async () => {
    const db = fakeDb([]);
    const result = await pto.checkSufficient(db, 2, STAFF, 'unpaid', '2026-11-02', '2026-11-04');
    expect(result).toEqual({ enforced: false, reason: 'unpaid' });
  });

  test('checkSufficient: balance covers the request, and a short balance is reported', async () => {
    const policy = { accrual_unit: 'days', accrual_amount: 2 };
    const withBalance = (balance) => fakeDb([
      ['FROM business_time_off_policies', async () => ({ rows: [policy] })],
      ['FROM business_time_off_balances', async () => ({ rows: [{ balance }] })],
    ]);
    const ok = await pto.checkSufficient(withBalance(10), 2, STAFF, 'vacation', '2026-11-02', '2026-11-04');
    expect(ok.ok).toBe(true);
    expect(ok.required).toBe(3);
    expect(ok.balance).toBe(10);
    const short = await pto.checkSufficient(withBalance(2), 2, STAFF, 'vacation', '2026-11-02', '2026-11-04');
    expect(short.ok).toBe(false);
    expect(short.code).toBe('insufficient_pto_balance');
    expect(short.required).toBe(3);
    expect(short.balance).toBe(2);
  });

  test('grantAccrual: banks the full grant when there is no cap', async () => {
    const policy = {
      business_id: 2, user_id: STAFF, request_type: 'vacation',
      accrual_amount: 2, accrual_unit: 'days', carryover_cap: null,
    };
    const db = fakeDb([
      // No balance row yet: the upsert inserts one (balance 0).
      ['INSERT INTO business_time_off_balances', async () => ({ rows: [{ balance: 0 }] })],
      ['UPDATE business_time_off_balances', async () => ({ rows: [] })],
      ['INSERT INTO business_time_off_accrual_events', async () => ({ rows: [] })],
    ]);
    const grant = await pto.grantAccrual(db, policy, MANAGER);
    expect(grant).toEqual({
      user_id: STAFF, request_type: 'vacation',
      granted: 2, unit: 'days', balance_after: 2, capped: false, carryover_cap: null,
    });
  });

  test('grantAccrual: the carryover cap banks only up to the cap', async () => {
    const policy = {
      business_id: 2, user_id: STAFF, request_type: 'vacation',
      accrual_amount: 5, accrual_unit: 'days', carryover_cap: 10,
    };
    const db = fakeDb([
      // Balance row already exists (8 banked); the upsert is a no-op.
      ['INSERT INTO business_time_off_balances', async () => ({ rows: [] })],
      ['FROM business_time_off_balances', async () => ({ rows: [{ balance: 8 }] })],
      ['UPDATE business_time_off_balances', async () => ({ rows: [] })],
      ['INSERT INTO business_time_off_accrual_events', async () => ({ rows: [] })],
    ]);
    const grant = await pto.grantAccrual(db, policy, MANAGER);
    expect(grant.granted).toBe(2);
    expect(grant.balance_after).toBe(10);
    expect(grant.capped).toBe(true);
    // The accrual event records only what was actually banked.
    const eventCall = db.query.mock.calls.find(([sql]) => String(sql).includes('accrual_events'));
    expect(eventCall[1][3]).toBe(2);
  });

  test('grantAccrual: a balance already at the cap grants nothing', async () => {
    const policy = {
      business_id: 2, user_id: STAFF, request_type: 'sick',
      accrual_amount: 1, accrual_unit: 'days', carryover_cap: 10,
    };
    const db = fakeDb([
      ['INSERT INTO business_time_off_balances', async () => ({ rows: [] })],
      ['FROM business_time_off_balances', async () => ({ rows: [{ balance: 10 }] })],
      ['UPDATE business_time_off_balances', async () => ({ rows: [] })],
    ]);
    const grant = await pto.grantAccrual(db, policy, MANAGER);
    expect(grant.granted).toBe(0);
    expect(grant.balance_after).toBe(10);
    expect(grant.capped).toBe(true);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('accrual_events'))).toBe(false);
  });

  test('decrementForApproval: approval decrements and records the event', async () => {
    const db = fakeDb([
      ['FROM business_time_off_policies', async () => ({ rows: [{ accrual_unit: 'days' }] })],
      ['UPDATE business_time_off_balances', async () => ({ rows: [{ balance: 7 }] })],
      ['INSERT INTO business_time_off_accrual_events', async () => ({ rows: [] })],
    ]);
    const result = await pto.decrementForApproval(
      db, 2, STAFF, 'vacation', '2026-11-02', '2026-11-04', 41, MANAGER
    );
    expect(result.decremented).toBe(true);
    expect(result.balanceAfter).toBe(7);
    expect(result.required).toBe(3);
    const updateCall = db.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE business_time_off_balances'));
    expect(updateCall[1][0]).toBe(3);
    const eventCall = db.query.mock.calls.find(([sql]) => String(sql).includes('accrual_events'));
    expect(eventCall[1][3]).toBe(-3);
    // 'approval' is a literal in the SQL; the params carry request id then balance.
    expect(eventCall[1][5]).toBe(41);
    expect(eventCall[1][6]).toBe(7);
  });

  test('decrementForApproval: a balance that no longer covers the request refuses, it never goes negative', async () => {
    const db = fakeDb([
      ['FROM business_time_off_policies', async () => ({ rows: [{ accrual_unit: 'days' }] })],
      // The guarded UPDATE touches no row: balance < required.
      ['UPDATE business_time_off_balances', async () => ({ rows: [] })],
      ['FROM business_time_off_balances', async () => ({ rows: [{ balance: 1 }] })],
    ]);
    const result = await pto.decrementForApproval(
      db, 2, STAFF, 'vacation', '2026-11-02', '2026-11-04', 41, MANAGER
    );
    expect(result.decremented).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.balance).toBe(1);
    expect(result.required).toBe(3);
  });
});

describe('createTimeOffRequest balance check', () => {
  function routeCreate({ policy, balance }) {
    mockQuery.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('FROM business_members')) return { rows: [{ '?column?': 1 }] };
      if (s.includes('FROM business_time_off_policies')) return { rows: policy ? [policy] : [] };
      if (s.includes('FROM business_time_off_balances')) return { rows: balance == null ? [] : [{ balance }] };
      if (s.includes('INSERT INTO business_time_off_requests')) {
        return { rows: [{ id: 5, status: 'pending', request_type: 'vacation' }] };
      }
      if (s.includes('FROM business_staff_shifts')) return { rows: [] };
      return { rows: [] };
    });
  }

  test('a request over the balance is rejected 409 with the remaining balance', async () => {
    routeCreate({ policy: { accrual_unit: 'days' }, balance: 2 });
    const req = {
      params: { businessId: '2' },
      body: { request_type: 'vacation', start_date: '2026-11-02', end_date: '2026-11-04' },
      user: { id: STAFF },
    };
    const res = mockRes();
    await ctrl.createTimeOffRequest(req, res, next);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('insufficient_pto_balance');
    expect(res.body.balance).toBe(2);
    expect(res.body.required).toBe(3);
    expect(res.body.unit).toBe('days');
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO business_time_off_requests'))).toBe(false);
  });

  test('a request inside the balance is created, and unpaid is never balance-checked', async () => {
    routeCreate({ policy: { accrual_unit: 'days' }, balance: 10 });
    const req = {
      params: { businessId: '2' },
      body: { request_type: 'vacation', start_date: '2026-11-02', end_date: '2026-11-04' },
      user: { id: STAFF },
    };
    const res = mockRes();
    await ctrl.createTimeOffRequest(req, res, next);
    expect(res.statusCode).toBe(201);
    expect(res.body.pto_balance).toEqual({ balance: 10, required: 3, unit: 'days' });

    routeCreate({ policy: null, balance: null });
    const unpaidReq = {
      params: { businessId: '2' },
      body: { request_type: 'unpaid', start_date: '2026-11-02', end_date: '2026-12-31' },
      user: { id: STAFF },
    };
    const unpaidRes = mockRes();
    await ctrl.createTimeOffRequest(unpaidReq, unpaidRes, next);
    expect(unpaidRes.statusCode).toBe(201);
  });
});

describe('decideTimeOffRequest balance decrement', () => {
  function routeDecide({ balanceAfter }) {
    mockQuery.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('FROM business_time_off_requests') && s.includes('FOR UPDATE')) {
        return { rows: [{ id: 41, user_id: STAFF, request_type: 'vacation', start_date: '2026-11-02', end_date: '2026-11-04', status: 'pending' }] };
      }
      if (s.includes('FROM business_time_off_policies')) return { rows: [{ accrual_unit: 'days' }] };
      if (s.includes('UPDATE business_time_off_balances')) {
        return { rows: balanceAfter == null ? [] : [{ balance: balanceAfter }] };
      }
      if (s.includes('FROM business_time_off_balances')) return { rows: [{ balance: 1 }] };
      if (s.includes('UPDATE business_time_off_requests')) {
        return { rows: [{ id: 41, status: 'approved', request_type: 'vacation' }] };
      }
      return { rows: [] };
    });
  }

  test('approval decrements the balance and reports the new balance', async () => {
    routeDecide({ balanceAfter: 7 });
    const req = {
      params: { businessId: '2', requestId: '41' },
      body: { decision: 'approved' },
      user: { id: MANAGER },
      businessRole: 'manager',
    };
    const res = mockRes();
    await ctrl.decideTimeOffRequest(req, res, next);
    expect(res.statusCode).toBe(200);
    expect(res.body.request.status).toBe('approved');
    expect(res.body.pto_balance).toEqual({ balance: 7, required: 3, unit: 'days' });
  });

  test('approval 409s and leaves the request pending when the balance no longer covers it', async () => {
    routeDecide({ balanceAfter: null });
    const req = {
      params: { businessId: '2', requestId: '41' },
      body: { decision: 'approved' },
      user: { id: MANAGER },
      businessRole: 'manager',
    };
    const res = mockRes();
    await ctrl.decideTimeOffRequest(req, res, next);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('insufficient_pto_balance');
    expect(res.body.balance).toBe(1);
    expect(res.body.required).toBe(3);
    // The status flip never ran: the request stays pending.
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE business_time_off_requests'))).toBe(false);
  });

  test('denial never touches the balance', async () => {
    routeDecide({ balanceAfter: 7 });
    const req = {
      params: { businessId: '2', requestId: '41' },
      body: { decision: 'denied' },
      user: { id: MANAGER },
      businessRole: 'manager',
    };
    const res = mockRes();
    await ctrl.decideTimeOffRequest(req, res, next);
    expect(res.statusCode).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('business_time_off_balances'))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('business_time_off_policies'))).toBe(false);
  });
});
