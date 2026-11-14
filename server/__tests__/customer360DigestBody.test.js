'use strict';

// Notifications audit item 55: the Customer 360 overflow digest had an
// empty body, no action_url, and data carrying only {overflow, digest:true}.
// Reproduction: the digest a capped tick emits says nothing about what it
// stands for and links nowhere.

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

test('the overflow digest names the count, the top overflowed records, and links to the anomalies workspace', async () => {
  process.env.CUSTOMER360_ALERT_TICK_CAP = '2';
  try {
    db.query
      .mockResolvedValueOnce({ rows: [rule(1)] })
      .mockResolvedValueOnce({ rows: [anomaly('a1', 'c1'), anomaly('a2', 'c2'), anomaly('a3', 'c3')] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await evaluateCustomer360Alerts();
    expect(result.sent).toBe(2);
    expect(result.overflow).toBe(1);
    expect(result.digested).toBe(1);
    const digest = sendNotification.mock.calls.find(([arg]) => arg.data?.digest);
    expect(digest).toBeDefined();
    const [call] = digest;
    expect(call.data.overflow).toBe(1);
    // The body says how many were held back and which records they were.
    expect(call.body).toContain('1');
    expect(call.body).toContain('c3');
    expect(call.body).toContain('refund_spike');
    // The data carries the top overflowed records for the client.
    expect(call.data.top).toEqual(expect.arrayContaining([
      expect.objectContaining({ customer_id: 'c3', kind: 'refund_spike' }),
    ]));
    // The digest links to the anomalies workspace, not nowhere.
    expect(call.action_url).toBe('/admin/customer360/anomalies');
  } finally {
    delete process.env.CUSTOMER360_ALERT_TICK_CAP;
  }
});
