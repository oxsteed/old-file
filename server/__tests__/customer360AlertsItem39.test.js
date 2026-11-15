'use strict';

// Notifications audit item 39: Customer 360 alert rules evaluated
// serially, and the job never consulted admin_notification_prefs, so an
// admin who turned off incident alerts still got every anomaly alert
// and its digest. The per-rule evaluation now runs with bounded
// concurrency (mapBounded), and both the rule and its digest honour
// admin_notification_prefs (notify_incidents, opt-out, missing row =
// defaults ON), mirroring metricThresholdAlerts getAdminAlertPrefs.

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/customer360Workspace', () => ({
  sources: { anomaliesFinancial: { area: 'anomalies' } },
  access: jest.fn(() => async () => true),
  target: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));
const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { evaluateCustomer360Alerts } = require('../jobs/customer360Alerts');

const rule = (id, admin) => ({
  id, admin_id: admin, customer_id: null, source: 'anomaliesFinancial',
  statuses: ['open'], min_age_minutes: 0, role: 'admin',
});
const anomaly = (id, customer) => ({ id, status: 'open', customer_id: customer, kind: 'refund_spike' });

const ADMIN_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ADMIN_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

beforeEach(() => {
  jest.clearAllMocks();
  sendNotification.mockResolvedValue({ success: true });
  delete process.env.CUSTOMER360_ALERT_TICK_CAP;
  delete process.env.CUSTOMER360_ALERT_RULE_CONCURRENCY;
});

// SQL-dispatch fake: robust under concurrent rule evaluation, unlike a
// fixed mockResolvedValueOnce sequence. prefsResponder(adminId, callIndex)
// decides each admin_notification_prefs answer; anomaliesByRule maps a
// rule id to its anomaly rows.
function installDbFake({ rules, prefsResponder, anomaliesByRule, anomalyGate }) {
  let prefsCalls = 0;
  const anomalyCalls = [];
  db.query.mockImplementation(async (sql, params) => {
    if (typeof sql === 'string' && sql.includes('FROM admin_customer_alert_rules') && sql.includes('SELECT')) {
      return { rows: rules };
    }
    if (typeof sql === 'string' && sql.includes('FROM admin_notification_prefs')) {
      prefsCalls += 1;
      return { rows: prefsResponder(params[0], prefsCalls) };
    }
    if (typeof sql === 'string' && sql.includes('FROM customer_anomalies')) {
      const ruleId = params[5];
      anomalyCalls.push(ruleId);
      if (anomalyGate) return anomalyGate(ruleId);
      return { rows: anomaliesByRule[ruleId] || [] };
    }
    return { rows: [] };
  });
  return { getPrefsCalls: () => prefsCalls, anomalyCalls };
}

test('per-rule evaluation runs concurrently, not serially', async () => {
  // Two rules whose anomaly queries are held open: with serial
  // evaluation the second rule's query would not start until the first
  // rule finished. With bounded concurrency both start up front.
  const deferreds = {};
  const gate = (ruleId) => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    deferreds[ruleId] = { promise, resolve };
    return promise;
  };
  const { anomalyCalls } = installDbFake({
    rules: [rule(1, ADMIN_A), rule(2, ADMIN_B)],
    prefsResponder: () => [],
    anomaliesByRule: {},
    anomalyGate: gate,
  });
  const pending = evaluateCustomer360Alerts();
  // Let both workers start and issue their anomaly queries.
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  expect(anomalyCalls).toEqual(expect.arrayContaining([1, 2]));
  expect(anomalyCalls).toHaveLength(2);
  deferreds[1].resolve({ rows: [anomaly('a1', 'c1')] });
  deferreds[2].resolve({ rows: [anomaly('b1', 'c2')] });
  const result = await pending;
  expect(result.sent).toBe(2);
  expect(sendNotification).toHaveBeenCalledTimes(2);
});

test('an admin who opted out of incident alerts gets no rule notifications', async () => {
  installDbFake({
    rules: [rule(1, ADMIN_A)],
    prefsResponder: () => [{ notify_incidents: false }],
    anomaliesByRule: { 1: [anomaly('a1', 'c1'), anomaly('a2', 'c1')] },
  });
  const result = await evaluateCustomer360Alerts();
  expect(result.sent).toBe(0);
  expect(result.skippedByPrefs).toBe(1);
  expect(sendNotification).not.toHaveBeenCalled();
  // The rule is still marked evaluated (it was evaluated; the
  // evaluation decided to skip), so it does not stick at the front of
  // the queue forever.
  const updates = db.query.mock.calls.filter(([sql]) => sql.includes('UPDATE admin_customer_alert_rules'));
  expect(updates).toHaveLength(1);
});

test('a prefs lookup failure fails open: the rule still evaluates', async () => {
  db.query.mockImplementation(async (sql, params) => {
    if (typeof sql === 'string' && sql.includes('FROM admin_customer_alert_rules') && sql.includes('SELECT')) {
      return { rows: [rule(1, ADMIN_A)] };
    }
    if (typeof sql === 'string' && sql.includes('FROM admin_notification_prefs')) {
      throw Object.assign(new Error('prefs table unavailable'), { code: 'ECONNREFUSED' });
    }
    if (typeof sql === 'string' && sql.includes('FROM customer_anomalies')) {
      return { rows: [anomaly('a1', 'c1')] };
    }
    return { rows: [] };
  });
  const result = await evaluateCustomer360Alerts();
  expect(result.sent).toBe(1);
  expect(result.skippedByPrefs).toBe(0);
  expect(sendNotification).toHaveBeenCalledTimes(1);
});

test('one prefs lookup per admin per tick, shared by that admin\'s rules', async () => {
  const { getPrefsCalls } = installDbFake({
    rules: [rule(1, ADMIN_A), rule(2, ADMIN_A)],
    prefsResponder: () => [],
    anomaliesByRule: { 1: [anomaly('a1', 'c1')], 2: [anomaly('b1', 'c2')] },
  });
  const result = await evaluateCustomer360Alerts();
  expect(result.sent).toBe(2);
  expect(getPrefsCalls()).toBe(1);
});

test('the digest honours admin_notification_prefs per recipient', async () => {
  // Cap 2, three admins. A sends 1 and has no overflow. B and C share
  // the last slot and overflow the rest between them (the split depends
  // on send interleaving, so the test asserts totals, not the split).
  // The digest re-checks prefs fresh: B opted out mid-tick (digest
  // skipped), C is still opted in (digest sent).
  process.env.CUSTOMER360_ALERT_TICK_CAP = '2';
  const ADMIN_C = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
  try {
    installDbFake({
      rules: [rule(1, ADMIN_A), rule(2, ADMIN_B), rule(3, ADMIN_C)],
      prefsResponder: (adminId, callIndex) => {
        // Calls 1-3 are the rule phase (one per admin, cached); calls
        // 4+ are the digest phase, re-checked fresh.
        if (callIndex <= 3) return [];
        return adminId === ADMIN_B ? [{ notify_incidents: false }] : [];
      },
      anomaliesByRule: {
        1: [anomaly('a1', 'c1')],
        2: [anomaly('b1', 'c2'), anomaly('b2', 'c2'), anomaly('b3', 'c2')],
        3: [anomaly('d1', 'c3'), anomaly('d2', 'c3'), anomaly('d3', 'c3')],
      },
    });
    const result = await evaluateCustomer360Alerts();
    expect(result.sent).toBe(2);
    expect(result.overflow).toBe(5);
    expect(result.digested).toBe(1);
    expect(result.skippedByPrefs).toBe(1);
    const digests = sendNotification.mock.calls.filter(([arg]) => arg.data?.digest);
    expect(digests).toHaveLength(1);
    expect(digests[0][0].userId).toBe(ADMIN_C);
    expect(digests[0][0].data.overflow).toBeGreaterThan(0);
  } finally {
    delete process.env.CUSTOMER360_ALERT_TICK_CAP;
  }
});
