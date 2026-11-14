'use strict';

// Notifications audit item 38: sanctions hits opened a compliance case but
// paged nobody on staff. The customer was notified; the compliance queue
// was not.
// Reproduction: deciding 'confirm' opens a case and notifies the customer
// only (no recordIncident call), and a blocked pending hit likewise
// records no incident for staff.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/complianceCaseService', () => ({
  openComplianceCase: jest.fn().mockResolvedValue({ case: { id: 'case-1' } }),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true, notificationClaimed: true }),
}));

const { sendNotification } = require('../services/notificationService');
const { recordIncident } = require('../services/incidentStore');
const {
  assertSanctionsClear,
  decideSanctionsScreening,
} = require('../services/sanctionsScreeningService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const SCREENING_ID = '33333333-3333-4333-8333-333333333333';

const fakeClient = () => ({ query: mockQuery });

function screeningRow(overrides = {}) {
  return {
    id: SCREENING_ID,
    subject_type: 'customer',
    subject_id: CUSTOMER_ID,
    provider: 'manual_review',
    result: 'hit',
    hit_context: 'manual_review_required',
    payload_hash: 'hash',
    screened_at: new Date().toISOString(),
    sla_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    cleared_at: null,
    cleared_by: null,
    clear_reason: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
  sendNotification.mockClear();
  recordIncident.mockClear();
});

describe('sanctions hits page staff (item 38)', () => {
  test('a blocked pending hit records a staff incident and still notifies only the customer', async () => {
    const hit = screeningRow();
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_sanctions_screenings') && sql.includes('ORDER BY screened_at')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO oxsteed_credit_sanctions_screenings')) return { rows: [hit] };
      return { rows: [], rowCount: 0 };
    });

    await expect(assertSanctionsClear(fakeClient(), {
      subjectType: 'customer',
      subjectId: CUSTOMER_ID,
    })).rejects.toMatchObject({ code: 'credit_sanctions_match', status: 403 });

    expect(recordIncident).toHaveBeenCalledTimes(1);
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'critical',
      dedupeKey: expect.stringContaining(SCREENING_ID),
    }));
    expect(recordIncident.mock.calls[0][0].type).toMatch(/sanctions/);
    // Staff side only for the case: the subject hears only that a review
    // is required, never about the incident or the case.
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: CUSTOMER_ID,
      type: 'credit_sanctions_review_required',
    }));
  });

  test('a confirmed hit records a staff incident with the case, customer hears only the decision', async () => {
    const hit = screeningRow();
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_sanctions_screenings') && sql.includes('FOR UPDATE')) {
        return { rows: [hit] };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await decideSanctionsScreening({
      screeningId: SCREENING_ID,
      decision: 'confirm',
      actorUserId: ACTOR_ID,
      reason: 'Confirmed match',
    });

    expect(result.case).toBeTruthy();
    expect(recordIncident).toHaveBeenCalledTimes(1);
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'critical',
      dedupeKey: expect.stringContaining(SCREENING_ID),
    }));
    expect(recordIncident.mock.calls[0][0].details).toMatchObject({ caseId: 'case-1' });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: CUSTOMER_ID,
      type: 'credit_sanctions_confirmed',
    }));
  });

  test('a cleared hit records no staff incident', async () => {
    const hit = screeningRow();
    const cleared = screeningRow({ cleared_at: new Date().toISOString(), cleared_by: ACTOR_ID, clear_reason: 'False positive' });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_sanctions_screenings') && sql.includes('FOR UPDATE')) {
        return { rows: [hit] };
      }
      if (sql.includes('UPDATE oxsteed_credit_sanctions_screenings')) return { rows: [cleared] };
      return { rows: [], rowCount: 0 };
    });

    await decideSanctionsScreening({
      screeningId: SCREENING_ID,
      decision: 'clear',
      actorUserId: ACTOR_ID,
      reason: 'False positive',
    });

    expect(recordIncident).not.toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'credit_sanctions_cleared',
    }));
  });
});
