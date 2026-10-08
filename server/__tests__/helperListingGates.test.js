'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  getHelperStatus,
  getHelperAvailability,
  getHelperAvailabilitySummary,
  getHelperPricing,
  getHelperSlots,
} = require('../controllers/helpersController');

jest.mock('../services/socketService', () => ({
  isOnline: jest.fn(() => false),
}));

jest.mock('../services/helperAvailabilityService', () => ({
  getTemplate: jest.fn().mockResolvedValue({ byDay: {} }),
  formatTime: (v) => v,
  getHelperTimeZone: jest.fn().mockResolvedValue('UTC'),
  zonedDateStr: () => '2026-01-01',
  addDaysISO: (iso, days) => iso,
  computeAvailability: jest.fn().mockResolvedValue({ summary: [], hasTemplate: false }),
  listSlots: jest.fn().mockResolvedValue([]),
}));

const UNLISTED_HELPER = '00000000-0000-4000-8000-000000000001';

function expectNotFound(handler, req) {
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  const fullReq = { query: {}, ...req };
  return handler(fullReq, res, next).then(() => {
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err && (err.statusCode === 404 || err.status === 404)).toBe(true);
  });
}

describe('helper public endpoints respect is_listed', () => {
  beforeEach(() => {
    resetMocks();
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('COALESCE(hp.is_listed')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  test('status returns 404 when helper is unlisted', async () => {
    await expectNotFound(getHelperStatus, { params: { id: UNLISTED_HELPER } });
  });

  test('availability returns 404 when helper is unlisted', async () => {
    await expectNotFound(getHelperAvailability, { params: { id: UNLISTED_HELPER } });
  });

  test('availability summary returns 404 when helper is unlisted', async () => {
    await expectNotFound(getHelperAvailabilitySummary, { params: { id: UNLISTED_HELPER } });
  });

  test('pricing returns 404 when helper is unlisted', async () => {
    await expectNotFound(getHelperPricing, { params: { id: UNLISTED_HELPER } });
  });

  test('slots returns 404 when helper is unlisted', async () => {
    await expectNotFound(getHelperSlots, { params: { id: UNLISTED_HELPER }, query: {} });
  });
});
