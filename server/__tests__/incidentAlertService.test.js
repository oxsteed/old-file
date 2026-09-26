'use strict';

jest.mock('../services/metricsService', () => ({
  checkAlerts: jest.fn().mockReturnValue([]),
  recordSecurityEvent: jest.fn(),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn(),
  listIncidents: jest.fn(),
}));
jest.mock('../utils/email', () => ({
  sendSecurityAlertEmail: jest.fn().mockResolvedValue(undefined),
}));

const incidentAlertService = require('../services/incidentAlertService');
const incidentStore = require('../services/incidentStore');

afterAll(() => {
  if (incidentAlertService.monitorTimer) clearInterval(incidentAlertService.monitorTimer);
});

describe('incident alert dispatch', () => {
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
    const channel = jest.fn().mockResolvedValue(undefined);
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
    const channel = jest.fn().mockResolvedValue(undefined);
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
});
