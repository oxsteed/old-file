'use strict';

// Per-recipient delivery ledger for scheduled reports.
//
// deliverScheduledReport used to re-send to every recipient on retry:
// the senders' idempotency keys deduped the send, not the work. The
// ledger (restaurant_scheduled_report_recipient_deliveries) records the
// outcome per recipient per delivery, so a retry sends only to
// recipients whose last recorded outcome was not 'sent'.
//
//   - two recipients, first run delivers both, simulate failure for
//     one, retry sends only to the failed one;
//   - a genuinely failed recipient is recorded 'failed' and retried,
//     while the delivered one is skipped.
//
// The ledger is backed by a fake in-memory db here (deliverScheduledReport
// takes db as its first argument); the migration itself is verified by
// the suite's migration run. Run with:
//   npx jest __tests__/restaurantScheduledReportsRecipientLedger.test.js --forceExit
//

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({})),
}));

const scheduledReports = require('../services/restaurantScheduledReports');
const { sendNotification } = require('../services/notificationService');
const { deliverScheduledReport } = scheduledReports;

function createLedgerDb() {
  const rows = new Map();
  return {
    rows,
    async query(text, params = []) {
      if (text.includes('FROM restaurant_scheduled_report_recipient_deliveries')) {
        const deliveryId = params[0];
        return { rows: [...rows.values()].filter((row) => row.delivery_id === deliveryId) };
      }
      if (text.includes('INSERT INTO restaurant_scheduled_report_recipient_deliveries')) {
        const [deliveryId, scheduledReportId, businessDate, recipientType, recipient, channel, status, error] = params;
        const key = `${deliveryId}|${recipientType}|${recipient}|${channel}`;
        const prev = rows.get(key);
        rows.set(key, {
          delivery_id: deliveryId,
          scheduled_report_id: scheduledReportId,
          business_date: businessDate,
          recipient_type: recipientType,
          recipient,
          channel,
          status,
          error,
          attempts: (prev?.attempts || 0) + 1,
        });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

function payload(overrides = {}) {
  return {
    scheduled_report_id: 11,
    report_type: 'labor',
    business_date: '2026-11-05',
    summary: 'Labor summary',
    as_of: '2026-11-06T10:00:00.000Z',
    ...overrides,
  };
}

function schedule() {
  return {
    id: 11,
    delivery_channel: 'in_app',
    recipients: [{ user_id: 'user-0' }, { user_id: 'user-1' }],
  };
}

describe('per-recipient delivery ledger for scheduled reports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('first run delivers both, simulated failure for one, retry sends only to the failed one', async () => {
    const db = createLedgerDb();

    const first = await deliverScheduledReport(db, { schedule: schedule(), payload: payload(), deliveryId: 100 });
    expect(first).toMatchObject({ delivered: 2, failed: 0, alreadyDelivered: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect([...db.rows.values()].map((row) => [row.recipient, row.status, row.attempts])).toEqual([
      ['user-0', 'sent', 1],
      ['user-1', 'sent', 1],
    ]);

    // Simulate a failure for one recipient after the first run (e.g.
    // the provider later reported it undelivered).
    db.rows.get('100|user|user-1|in_app').status = 'failed';

    sendNotification.mockClear();
    const retry = await deliverScheduledReport(db, { schedule: schedule(), payload: payload(), deliveryId: 100 });
    expect(retry).toMatchObject({ delivered: 1, failed: 0, alreadyDelivered: 1 });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0].userId).toBe('user-1');
    expect(db.rows.get('100|user|user-1|in_app')).toMatchObject({ status: 'sent', attempts: 2 });
    expect(db.rows.get('100|user|user-0|in_app')).toMatchObject({ status: 'sent', attempts: 1 });
  });

  test('a genuinely failed recipient is recorded failed and retried while the delivered one is skipped', async () => {
    const db = createLedgerDb();
    sendNotification.mockImplementation(async ({ userId }) => (
      userId === 'user-1' ? { success: false, error: 'provider down' } : {}
    ));

    const first = await deliverScheduledReport(db, { schedule: schedule(), payload: payload(), deliveryId: 101 });
    expect(first).toMatchObject({ delivered: 1, failed: 1, alreadyDelivered: 0 });
    expect(first.errors).toHaveLength(1);
    expect(db.rows.get('101|user|user-0|in_app')).toMatchObject({ status: 'sent', attempts: 1 });
    expect(db.rows.get('101|user|user-1|in_app')).toMatchObject({ status: 'failed', attempts: 1, error: 'provider down' });

    sendNotification.mockClear();
    sendNotification.mockImplementation(async () => ({}));
    const retry = await deliverScheduledReport(db, { schedule: schedule(), payload: payload(), deliveryId: 101 });
    expect(retry).toMatchObject({ delivered: 1, failed: 0, alreadyDelivered: 1 });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0].userId).toBe('user-1');
  });
});
