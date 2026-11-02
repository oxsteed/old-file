'use strict';

// 2026-11-02 admin-ops audit item 16: super-admin Payouts stats must be
// grouped per currency, and rows must carry their currency. Summing cents
// from different currencies into one total is a reporting defect.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
  logUserAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/paymentRefundService', () => ({
  processPaymentRefund: jest.fn(),
}));
jest.mock('../services/stepupChallengeService', () => ({
  issueStepupChallenge: jest.fn(),
  verifyStepupChallenge: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/schemaProbe', () => ({
  tableExists: jest.fn().mockResolvedValue(true),
  columnExists: jest.fn().mockResolvedValue(true),
  probeSchema: jest.fn().mockResolvedValue({}),
  userIdEq: jest.fn(),
  ACTIVE_JOB_STATUS_SQL_IN: '',
}));

const ctrl = require('../controllers/superAdminController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  resetMocks();
});

describe('getPayouts per-currency stats', () => {
  test('returns one stats group per currency and currency on rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', currency: 'usd', helper_payout: 100 }] })
      .mockResolvedValueOnce({ rows: [
        { currency: 'EUR', pending: 10, processing: 0, completed: 20, failed: 0, totalPaid: 20 },
        { currency: 'USD', pending: 5, processing: 0, completed: 30, failed: 0, totalPaid: 30 },
      ] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    const res = mockRes();
    await ctrl.getPayouts({ query: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      stats: [
        { currency: 'EUR', pending: 10, processing: 0, completed: 20, failed: 0, totalPaid: 20 },
        { currency: 'USD', pending: 5, processing: 0, completed: 30, failed: 0, totalPaid: 30 },
      ],
    }));
    const payload = res.json.mock.calls[0][0];
    expect(Array.isArray(payload.stats)).toBe(true);
    expect(payload.stats.some((g) => g.currency === 'EUR' && g.totalPaid === 20)).toBe(true);
    expect(payload.stats.some((g) => g.currency === 'USD' && g.totalPaid === 30)).toBe(true);
    // No single mixed total: the two currencies are never added together.
    expect(payload.stats).not.toEqual(expect.objectContaining({ totalPaid: 50 }));
  });

  test('row query selects currency and stats query groups by currency', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });
    const res = mockRes();
    await ctrl.getPayouts({ query: {} }, res);
    const listSql = mockQuery.mock.calls[0][0];
    expect(listSql).toMatch(/p\.currency/);
    const statsSql = mockQuery.mock.calls[1][0];
    expect(statsSql).toMatch(/GROUP BY/);
    expect(statsSql).toMatch(/UPPER\(COALESCE\(currency/);
    expect(statsSql).not.toMatch(/'refunded'/);
    expect(statsSql).not.toMatch(/'disputed'/);
  });
});
