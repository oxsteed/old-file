'use strict';

/**
 * Domain 9 audit #5: scheduled reports, recipients unbounded, sends serial.
 *
 * Unit tests (no DB): the service's senders are mocked so the
 * concurrency of the send loop is observable.
 *   - validateScheduleInput rejects a recipient list over
 *     MAX_RECIPIENTS_PER_SCHEDULE (50) and accepts exactly 50;
 *   - parseRecipients truncates a legacy over-cap list to 50 and
 *     reports truncated: true;
 *   - deliverScheduledReport sends in bounded parallel batches:
 *     with 20 recipients the peak in-flight count is above 1 (not
 *     serial) and at most SEND_CONCURRENCY (5, not unbounded);
 *   - a legacy over-cap schedule delivers to only the first 50
 *     recipients;
 *   - a {success:false} send still counts as a failed recipient
 *     (background-jobs audit #41 behavior, unchanged).
 *
 * Run with:
 *   npx jest __tests__/restaurantScheduledReportsRecipients.test.js --forceExit
 */

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({})),
}));

const scheduledReports = require('../services/restaurantScheduledReports');
const { sendNotification } = require('../services/notificationService');
const { sendEmail } = require('../utils/email');

const {
  MAX_RECIPIENTS_PER_SCHEDULE,
  SEND_CONCURRENCY,
  parseRecipients,
  validateScheduleInput,
  deliverScheduledReport,
} = scheduledReports;

function userRecipients(count, prefix = 'user') {
  return Array.from({ length: count }, (_, i) => ({ user_id: `${prefix}-${i}` }));
}

function emailRecipients(count, prefix = 'user') {
  return Array.from({ length: count }, (_, i) => ({ email: `${prefix}${i}@example.com` }));
}

function payload(overrides = {}) {
  return {
    scheduled_report_id: 7,
    report_type: 'labor',
    business_date: '2026-11-05',
    summary: 'Labor summary',
    as_of: '2026-11-06T10:00:00.000Z',
    ...overrides,
  };
}

describe('Domain 9 audit #5: scheduled-report recipient cap and bounded sends', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('the per-schedule recipient cap is 50', () => {
    expect(MAX_RECIPIENTS_PER_SCHEDULE).toBe(50);
    expect(SEND_CONCURRENCY).toBe(5);
  });

  test('validateScheduleInput rejects more than 50 recipients across both channels', () => {
    const recipients = [...userRecipients(30), ...emailRecipients(21)];
    expect(() => validateScheduleInput({
      reportType: 'labor',
      deliveryChannel: 'both',
      recipients,
    })).toThrow(expect.objectContaining({ status: 400, code: 'validation_failed' }));
  });

  test('validateScheduleInput accepts exactly 50 recipients', () => {
    const input = validateScheduleInput({
      reportType: 'labor',
      deliveryChannel: 'both',
      recipients: [...userRecipients(25), ...emailRecipients(25)],
    });
    expect(input.recipients).toHaveLength(50);
  });

  test('parseRecipients truncates a legacy over-cap list, users first', () => {
    const { users, emails, truncated } = parseRecipients([
      ...userRecipients(40),
      ...emailRecipients(30),
    ]);
    expect(truncated).toBe(true);
    expect(users).toHaveLength(40);
    expect(emails).toHaveLength(10);
    expect(users.length + emails.length).toBe(MAX_RECIPIENTS_PER_SCHEDULE);
  });

  test('parseRecipients does not truncate a list within the cap', () => {
    const { users, emails, truncated } = parseRecipients([
      ...userRecipients(2),
      ...emailRecipients(2),
    ]);
    expect(truncated).toBe(false);
    expect(users).toHaveLength(2);
    expect(emails).toHaveLength(2);
  });

  test('deliverScheduledReport sends in bounded parallel batches, not one by one', async () => {
    const recipients = userRecipients(20);
    let inFlight = 0;
    let peakInFlight = 0;
    sendNotification.mockImplementation(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return {};
    });

    const outcome = await deliverScheduledReport(null, {
      schedule: { id: 7, delivery_channel: 'in_app', recipients },
      payload: payload(),
    });

    expect(outcome).toMatchObject({ delivered: 20, failed: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(20);
    // Serial sends would peak at 1; unbounded Promise.all would peak
    // at 20. Bounded batches peak above 1 and at the concurrency cap.
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(SEND_CONCURRENCY);
  });

  test('deliverScheduledReport sends email in bounded parallel batches too', async () => {
    const recipients = emailRecipients(12);
    let inFlight = 0;
    let peakInFlight = 0;
    sendEmail.mockImplementation(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return {};
    });

    const outcome = await deliverScheduledReport(null, {
      schedule: { id: 8, delivery_channel: 'email', recipients },
      payload: payload(),
    });

    expect(outcome).toMatchObject({ delivered: 12, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(12);
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(SEND_CONCURRENCY);
  });

  test('deliverScheduledReport delivers to only the first 50 recipients of a legacy over-cap list', async () => {
    const recipients = [...userRecipients(60), ...emailRecipients(10)];
    const outcome = await deliverScheduledReport(null, {
      schedule: { id: 9, delivery_channel: 'both', recipients },
      payload: payload(),
    });

    expect(outcome).toMatchObject({ delivered: 50, failed: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(50);
    expect(sendEmail).toHaveBeenCalledTimes(0);
  });

  test('a {success:false} send still counts as a failed recipient', async () => {
    sendNotification
      .mockResolvedValueOnce({ success: false, error: 'provider down' })
      .mockResolvedValue({});
    const outcome = await deliverScheduledReport(null, {
      schedule: { id: 10, delivery_channel: 'in_app', recipients: userRecipients(3) },
      payload: payload(),
    });

    expect(outcome).toMatchObject({ delivered: 2, failed: 1 });
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toMatchObject({ channel: 'in_app', error: 'provider down' });
  });
});
