'use strict';

// Cost audit 2026-11-04 item 4: one global per-tick send cap across alert
// rules, with overflow rolled into a single digest per admin.

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

const admin = '88888888-8888-4888-8888-888888888888';
const rule = (id) => ({
  id, admin_id: admin, customer_id: null, source: 'anomaliesFinancial',
  statuses: ['open'], min_age_minutes: 0, role: 'admin',
});
const anomaly = (id, customer) => ({ id, status: 'open', customer_id: customer, kind: 'refund_spike' });

beforeEach(() => {
  jest.clearAllMocks();
  sendNotification.mockResolvedValue({ success: true });
});

test('per-tick cap holds back overflow into one digest per admin', async () => {
  process.env.CUSTOMER360_ALERT_TICK_CAP = '4';
  try {
    db.query
      .mockResolvedValueOnce({ rows: [rule(1), rule(2)] })
      .mockResolvedValueOnce({ rows: [anomaly('a1', 'c1'), anomaly('a2', 'c1'), anomaly('a3', 'c1')] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [anomaly('b1', 'c2'), anomaly('b2', 'c2'), anomaly('b3', 'c2')] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await evaluateCustomer360Alerts();
    expect(result.sent).toBe(4);
    expect(result.overflow).toBe(2);
    expect(result.digested).toBe(1);
    // 4 individual notifications plus exactly one digest.
    expect(sendNotification).toHaveBeenCalledTimes(5);
    const digest = sendNotification.mock.calls.find(([arg]) => arg.data?.digest);
    expect(digest).toBeDefined();
    expect(digest[0].userId).toBe(admin);
    expect(digest[0].data.overflow).toBe(2);
    expect(digest[0].idempotencyKey).toMatch(/^customer360-digest:/);
  } finally {
    delete process.env.CUSTOMER360_ALERT_TICK_CAP;
  }
});
