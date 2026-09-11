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
  afterEach(() => jest.clearAllMocks());

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
});
