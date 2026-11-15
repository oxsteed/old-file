'use strict';

const { mockQuery } = require('./setup');
jest.mock('../services/metricsService', () => ({
  checkAlerts: jest.fn().mockReturnValue([]),
  recordSecurityEvent: jest.fn(),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn(),
  listIncidents: jest.fn(),
  DISPATCHABLE_SEVERITIES: ['critical', 'high'],
}));
jest.mock('../middleware/adminAuth', () => ({
  hasGlobalGrant: jest.fn(),
}));
jest.mock('../utils/email', () => ({
  sendSecurityAlertEmail: jest.fn().mockResolvedValue({ success: true }),
}));

const incidentAlertService = require('../services/incidentAlertService');
const incidentStore = require('../services/incidentStore');
const { hasGlobalGrant } = require('../middleware/adminAuth');

afterAll(() => {
  if (incidentAlertService.monitorTimer) clearInterval(incidentAlertService.monitorTimer);
});

describe('incident alert dispatch', () => {
  beforeEach(() => { mockQuery.mockResolvedValue({ rows: [{ id: 11 }] }); });
  afterEach(() => {
    delete process.env.SLACK_SECURITY_WEBHOOK;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test('suppresses repeated channel notifications inside the durable cooldown', async () => {
    const channel = jest.fn();
    incidentAlertService.alertChannels = [channel];
    incidentStore.recordIncident.mockResolvedValue({
      persisted: true,
      incident: { id: 10 },
      notificationClaimed: false,
    });

    const result = await incidentAlertService._triggerAlert('HIGH_ERROR_RATE', 'critical', 'Still high');

    expect(result.notificationsSuppressed).toBe(true);
    expect(channel).not.toHaveBeenCalled();
  });

  test('dispatches once when this process claims the notification window', async () => {
    const channel = jest.fn().mockResolvedValue({ success: true });
    incidentAlertService.alertChannels = [channel];
    incidentStore.recordIncident.mockResolvedValue({
      persisted: true,
      incident: { id: 11 },
      notificationClaimed: true,
    });

    const result = await incidentAlertService._triggerAlert('BACKUP_FAILURE', 'critical', 'Backup is late');
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.notificationsSuppressed).toBe(false);
    expect(channel).toHaveBeenCalledTimes(1);
  });

  test('keeps best-effort dispatch when durable persistence is unavailable', async () => {
    const channel = jest.fn().mockResolvedValue({ success: true });
    incidentAlertService.alertChannels = [channel];
    incidentStore.recordIncident.mockResolvedValue({ persisted: false, error: 'migration pending' });

    await incidentAlertService._triggerAlert('AUDIT_CHAIN_FAILURE', 'critical', 'Audit chain failed');
    await new Promise((resolve) => setImmediate(resolve));

    expect(channel).toHaveBeenCalledTimes(1);
  });

  test('delivers critical alerts to the constrained Slack webhook', async () => {
    process.env.SLACK_SECURITY_WEBHOOK = 'https://hooks.slack.com/services/test/webhook/token';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 });

    await incidentAlertService._slackAlert({
      type: 'BACKUP_FAILURE',
      severity: 'critical',
      message: 'Backup is late',
      timestamp: '2026-09-14T22:00:00.000Z',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      process.env.SLACK_SECURITY_WEBHOOK,
      expect.objectContaining({ method: 'POST', signal: expect.anything() })
    );
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({
      text: '🚨 BACKUP_FAILURE',
    });
  });

  test('rejects non-Slack webhook destinations without making a request', async () => {
    process.env.SLACK_SECURITY_WEBHOOK = 'https://example.com/webhook';
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(incidentAlertService._slackAlert({
      type: 'AUDIT_CHAIN_FAILURE',
      severity: 'critical',
      message: 'Audit chain failed',
      timestamp: '2026-09-14T22:00:00.000Z',
    })).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('surfaces Slack delivery failures to the channel dispatcher', async () => {
    process.env.SLACK_SECURITY_WEBHOOK = 'https://hooks.slack.com/services/test/webhook/token';
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 });

    await expect(incidentAlertService._slackAlert({
      type: 'BACKUP_FAILURE',
      severity: 'critical',
      message: 'Backup is late',
      timestamp: '2026-09-14T22:00:00.000Z',
    })).rejects.toThrow('HTTP 503');
  });

  test('item 46: a high-severity incident reaches the email leg', async () => {
    // One of the five recorded-but-never-dispatched high types.
    const result = await incidentAlertService._emailAlert({
      type: 'restaurant_gift_card_needs_review',
      severity: 'high',
      message: 'Gift card needs review',
      timestamp: '2026-11-14T00:00:00.000Z',
    });

    expect(result).toBe(true);
    const email = require('../utils/email').sendSecurityAlertEmail;
    expect(email).toHaveBeenCalledWith(
      expect.any(String),
      'restaurant_gift_card_needs_review',
      expect.any(String),
    );
  });

  test('item 46: a high-severity incident reaches the Slack leg', async () => {
    process.env.SLACK_SECURITY_WEBHOOK = 'https://hooks.slack.com/services/test/webhook/token';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 });

    const result = await incidentAlertService._slackAlert({
      type: 'account_deletion_financial_blocker',
      severity: 'high',
      message: 'Account deletion blocked by finances',
      timestamp: '2026-11-14T00:00:00.000Z',
    });

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalled();
  });

  test('includes diagnostic details in critical security emails', async () => {
    await incidentAlertService._emailAlert({
      type: 'HIGH_ERROR_RATE',
      severity: 'critical',
      message: 'Error rate 10% (100/1000)',
      timestamp: '2026-09-26T00:00:00.000Z',
      details: {
        measurement: 'since_process_start',
        errorsByStatus: [{ tags: { status: 404 }, count: 100 }],
        topErrorEndpoints: [{ endpoint: 'GET /api/example 404', count: 100 }],
      },
    });

    const email = require('../utils/email').sendSecurityAlertEmail;
    expect(email).toHaveBeenCalledWith(
      expect.any(String),
      'HIGH_ERROR_RATE',
      expect.stringContaining('topErrorEndpoints')
    );
  });

  test('delivers critical alerts to delegated operations admins', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'delegated-admin', role: 'admin', email: 'delegate@example.com' }] });
    hasGlobalGrant.mockResolvedValueOnce(true);

    await incidentAlertService._emailAlert({
      type: 'BACKUP_FAILURE',
      severity: 'critical',
      message: 'Backup is late',
      timestamp: '2026-09-26T00:00:00.000Z',
    });

    expect(hasGlobalGrant).toHaveBeenCalledWith('delegated-admin', 'manage_operations');
    expect(require('../utils/email').sendSecurityAlertEmail).toHaveBeenCalledWith(
      'delegate@example.com',
      'BACKUP_FAILURE',
      expect.any(String),
    );
  });

  // Item 49: when every channel fails, the lease-clear used to re-arm a
  // flat 5-minute lease forever, so the sweeper re-sent the same alert
  // on every expiry. The lease must back off from the claim time, and
  // a persistently failing channel must escalate to the error log.
  function failingChannels() {
    return [
      async () => false,
      async () => { throw new Error('provider down'); },
    ];
  }

  function leaseClearCall() {
    return mockQuery.mock.calls.find(([sql]) => String(sql).includes('dispatch_lease_until=CASE'));
  }

  function dispatchIncident(claimedMinutesAgo) {
    incidentAlertService.alertChannels = failingChannels();
    return incidentAlertService.dispatchRecordedIncident({
      id: 5,
      type: 'BACKUP_FAILURE',
      severity: 'critical',
      message: 'Backup is late',
      notification_claimed_at: claimedMinutesAgo == null
        ? null
        : new Date(Date.now() - claimedMinutesAgo * 60 * 1000).toISOString(),
    });
  }

  test('item 49: a first dispatch failure re-arms a short 5-minute lease', async () => {
    const result = await dispatchIncident(null);
    expect(result.dispatched).toBe(false);
    expect(leaseClearCall()[1]).toEqual([5, expect.any(String), false, '5']);
  });

  test('item 49: the lease backs off as the claim ages', async () => {
    const result = await dispatchIncident(12);
    expect(result.dispatched).toBe(false);
    expect(leaseClearCall()[1]).toEqual([5, expect.any(String), false, '20']);
  });

  test('item 49: the lease caps at 4 hours and a persistently failing channel escalates', async () => {
    const logger = require('../utils/logger');
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const result = await dispatchIncident(40);
      expect(result.dispatched).toBe(false);
      expect(leaseClearCall()[1]).toEqual([5, expect.any(String), false, '240']);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('persistently failing'),
        expect.objectContaining({ type: 'BACKUP_FAILURE' })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
