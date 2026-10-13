'use strict';

/**
 * P3-10-F09: verification/screening SLA sweep must actually escalate and
 * must cover every human review queue (verification requests, sanction
 * hits, identity appeals).
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/incidentAlertService', () => ({
  dispatchRecordedIncident: jest.fn().mockResolvedValue({ dispatched: true }),
}));

const incidentAlertService = require('../services/incidentAlertService');
const { checkVerificationSla } = require('../services/transactionMonitoringService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const fakeClient = () => ({ query: mockQuery });

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function mockSlaSweep({ breachedRows, claimed = true }) {
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('UNION ALL')) return { rows: breachedRows };
    if (sql.includes('INSERT INTO incident_log')) return { rows: [{ id: 'inc-1' }] };
    if (sql.includes('UPDATE incident_log')) {
      return { rows: claimed ? [{ id: 'inc-1' }] : [] };
    }
    return { rows: [], rowCount: 0 };
  });
}

const due = new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe('verification SLA sweep coverage', () => {
  test('pending identity appeals past their SLA are swept', async () => {
    mockSlaSweep({
      breachedRows: [
        { review_type: 'identity_appeal', id: 'iv-9', subject_id: CUSTOMER_ID, sla_due_at: due },
      ],
    });
    const result = await checkVerificationSla({ client: fakeClient() });
    expect(result.breachedCount).toBe(1);
    const sweepSql = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UNION ALL'))[0];
    expect(String(sweepSql)).toContain('appeal_sla_due_at');
    expect(String(sweepSql)).toContain("appeal_status = 'pending'");
    const types = mockQuery.mock.calls
      .filter(([sql]) => String(sql).includes('INSERT INTO incident_log'))
      .map(([, params]) => params[0]);
    expect(types).toEqual(['oxsteed_credit_identity_appeal_sla_breach']);
  });

  test('the sweep query covers all three human review queues', async () => {
    mockSlaSweep({
      breachedRows: [
        { review_type: 'identity_verification', id: 'iv-1', subject_id: CUSTOMER_ID, sla_due_at: due },
        { review_type: 'sanctions_screening', id: 'ss-1', subject_id: '42', sla_due_at: due },
        { review_type: 'identity_appeal', id: 'iv-2', subject_id: CUSTOMER_ID, sla_due_at: due },
      ],
    });
    const result = await checkVerificationSla({ client: fakeClient() });
    expect(result.breachedCount).toBe(3);
    expect(result.incidents).toHaveLength(3);
  });
});

describe('verification SLA escalation dispatch', () => {
  test('a claimed notification window dispatches the alert channels', async () => {
    mockSlaSweep({
      claimed: true,
      breachedRows: [
        { review_type: 'identity_verification', id: 'iv-1', subject_id: CUSTOMER_ID, sla_due_at: due },
      ],
    });
    await checkVerificationSla({ client: fakeClient() });
    expect(incidentAlertService.dispatchRecordedIncident).toHaveBeenCalledTimes(1);
    expect(incidentAlertService.dispatchRecordedIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'oxsteed_credit_identity_verification_sla_breach',
        severity: 'critical',
      })
    );
  });

  test('no dispatch when another replica owns the notification window', async () => {
    mockSlaSweep({
      claimed: false,
      breachedRows: [
        { review_type: 'sanctions_screening', id: 'ss-1', subject_id: '42', sla_due_at: due },
      ],
    });
    const result = await checkVerificationSla({ client: fakeClient() });
    expect(result.breachedCount).toBe(1);
    expect(incidentAlertService.dispatchRecordedIncident).not.toHaveBeenCalled();
  });

  test('a dispatch failure does not fail the sweep', async () => {
    incidentAlertService.dispatchRecordedIncident.mockRejectedValueOnce(new Error('smtp down'));
    mockSlaSweep({
      claimed: true,
      breachedRows: [
        { review_type: 'identity_appeal', id: 'iv-9', subject_id: CUSTOMER_ID, sla_due_at: due },
      ],
    });
    const result = await checkVerificationSla({ client: fakeClient() });
    expect(result.breachedCount).toBe(1);
    expect(result.incidents).toHaveLength(1);
  });
});
