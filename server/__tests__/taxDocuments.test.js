'use strict';

/**
 * P3-10-F16: the "1099 Tax Form" is a self-serve earnings summary, not a
 * filing flow. The API must label it honestly and carry a disclaimer that
 * it is not an official IRS filing.
 */

const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/mainAppController');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function taxIdentityRow(overrides = {}) {
  return {
    w9_completed: true,
    didit_status: 'verified',
    didit_verified_at: new Date().toISOString(),
    ...overrides,
  };
}

function earningsRow(overrides = {}) {
  return {
    tax_year: 2026,
    currency_code: 'USD',
    earned_cents: 75000,
    completed_jobs: 5,
    last_activity_at: new Date('2026-09-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('tax documents honesty (P3-10-F16)', () => {
  test('the 1099 entry is labeled an earnings summary with a filing disclaimer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [taxIdentityRow()] })
      .mockResolvedValueOnce({ rows: [earningsRow()] });
    const req = { user: { id: '00000000-0000-4000-8000-000000000999' } };
    const res = mockResponse();

    await ctrl.getTaxDocuments(req, res, () => {});

    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    const form1099 = payload.documents.find((d) => d.type === 'form_1099');
    expect(form1099).toBeTruthy();
    expect(form1099.title).toBe('1099 Earnings Summary');
    expect(form1099.title).not.toBe('1099 Tax Form');
    expect(payload.disclaimer).toMatch(/not official IRS filings/i);
  });

  test('the 1099 entry requires complete tax identity before it is available', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [taxIdentityRow({ w9_completed: false })] })
      .mockResolvedValueOnce({ rows: [earningsRow()] });
    const req = { user: { id: '00000000-0000-4000-8000-000000000999' } };
    const res = mockResponse();

    await ctrl.getTaxDocuments(req, res, () => {});

    const payload = res.json.mock.calls[0][0];
    const form1099 = payload.documents.find((d) => d.type === 'form_1099');
    expect(form1099.status).toBe('action_required');
    expect(form1099.downloadAvailable).toBe(false);
    expect(payload.taxIdentity.w9Completed).toBe(false);
  });
});
