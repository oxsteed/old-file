'use strict';

/**
 * P3-10-F10: the sanctions lifecycle was silent. A blocked customer never
 * got a review-required notice, and an admin clear/confirm decision never
 * reached the customer. These tests pin the three notifications:
 *   - assertSanctionsClear on an uncleared hit -> credit_sanctions_review_required
 *   - decideSanctionsScreening 'clear'                 -> credit_sanctions_cleared
 *   - decideSanctionsScreening 'confirm'               -> credit_sanctions_confirmed
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/complianceCaseService', () => ({
  openComplianceCase: jest.fn().mockResolvedValue({ case: { id: 'case-1' } }),
}));

const { sendNotification } = require('../services/notificationService');
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
});

describe('sanctions lifecycle notifications (P3-10-F10)', () => {
  test('a blocked hit notifies the customer that a compliance review is required', async () => {
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

    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: CUSTOMER_ID,
      type: 'credit_sanctions_review_required',
      idempotencyKey: `credit-sanctions:${SCREENING_ID}:review-required`,
    }));
  });

  test('an admin clear notifies the customer they can retry', async () => {
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

    const result = await decideSanctionsScreening({
      screeningId: SCREENING_ID,
      decision: 'clear',
      actorUserId: ACTOR_ID,
      reason: 'False positive',
    });

    expect(result.screening.clearedAt).toBeTruthy();
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: CUSTOMER_ID,
      type: 'credit_sanctions_cleared',
      idempotencyKey: `credit-sanctions:${SCREENING_ID}:clear`,
    }));
  });

  test('an admin confirm notifies the customer the review remains open', async () => {
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
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: CUSTOMER_ID,
      type: 'credit_sanctions_confirmed',
      idempotencyKey: `credit-sanctions:${SCREENING_ID}:confirm`,
    }));
  });

  test('no notification is attempted when the subject cannot be resolved to a user', async () => {
    const hit = screeningRow({ subject_type: 'mystery', subject_id: 'xyz' });
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_sanctions_screenings') && sql.includes('ORDER BY screened_at')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO oxsteed_credit_sanctions_screenings')) return { rows: [hit] };
      return { rows: [], rowCount: 0 };
    });

    await expect(assertSanctionsClear(fakeClient(), {
      subjectType: 'mystery',
      subjectId: 'xyz',
    })).rejects.toMatchObject({ code: 'credit_sanctions_match', status: 403 });

    expect(sendNotification).not.toHaveBeenCalled();
  });
});
