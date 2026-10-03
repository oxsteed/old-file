'use strict';

/**
 * legalAcceptancesParams.test.js
 *
 * Regression test for Sentry OXSTEED-BACKEND-30:
 * GET /api/admin/legal/acceptances 500'd in production with
 * "bind message supplies 1 parameters, but prepared statement requires 0".
 *
 * Root cause: in listAllAcceptances the count/month queries sliced the shared
 * params array with an off-by-one (paramCount is 1-based), so the placeholder
 * arity never matched the bound params. The default-query 500 was fixed in
 * 68a23f85 (T56-F01); a second off-by-one in the thisMonth slice
 * (paramCount - 2 instead of paramCount - 1) still broke every filtered load:
 * with filters, the month query reused a filter placeholder for the date.
 *
 * This test locks the contract: for every query the handler issues, the
 * highest $N placeholder must equal the number of bound params, and the
 * filter values must stay in placeholder order with the month-start date last.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const pool = require('../db');
const controller = require('../controllers/legalDocumentsController');

function resMock() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function nextMock() {
  return jest.fn((err) => { if (err) throw err; });
}

/** Highest $N placeholder referenced in the query text. */
function maxPlaceholder(text) {
  const matches = text.match(/\$(\d+)/g) || [];
  return matches.reduce((max, m) => Math.max(max, parseInt(m.slice(1), 10)), 0);
}

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockImplementation((text) => {
    if (/COUNT\(\*\) as total/i.test(text) && /accepted_at >=/i.test(text)) {
      return Promise.resolve({ rows: [{ total: '2' }] }); // thisMonth
    }
    if (/COUNT\(\*\) as total/i.test(text)) {
      return Promise.resolve({ rows: [{ total: '5' }] }); // count
    }
    if (/GROUP BY document_type/i.test(text)) {
      return Promise.resolve({ rows: [] }); // by-type stats
    }
    return Promise.resolve({ rows: [] }); // data
  });
});

describe('listAllAcceptances query params', () => {
  test('default query: placeholder arity matches bound params on all queries', async () => {
    const res = resMock();
    await controller.listAllAcceptances({ query: {} }, res, nextMock());

    expect(res.json).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);

    // count, data, thisMonth, by-type
    expect(pool.query).toHaveBeenCalledTimes(4);
    for (const [text, params] of pool.query.mock.calls) {
      expect(maxPlaceholder(text)).toBe((params || []).length);
    }

    const [countText, countParams] = pool.query.mock.calls[0];
    expect(countParams).toEqual([]);

    const [, dataParams] = pool.query.mock.calls[1];
    expect(dataParams).toEqual([50, 0]); // limit, offset

    const [, monthParams] = pool.query.mock.calls[2];
    expect(monthParams).toHaveLength(1);
    expect(monthParams[0]).toBeInstanceOf(Date);
    expect(countText).not.toMatch(/LIMIT/);
  });

  test('filtered query: filter values stay in order, month-start date is last', async () => {
    const res = resMock();
    await controller.listAllAcceptances(
      { query: { documentType: 'privacy_policy', search: 'ann', page: '2', limit: '10' } },
      res,
      nextMock(),
    );

    expect(res.json).toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledTimes(4);
    for (const [text, params] of pool.query.mock.calls) {
      expect(maxPlaceholder(text)).toBe((params || []).length);
    }

    const [, countParams] = pool.query.mock.calls[0];
    expect(countParams).toEqual(['privacy_policy', '%ann%']);

    const [, dataParams] = pool.query.mock.calls[1];
    expect(dataParams).toEqual(['privacy_policy', '%ann%', 10, 10]); // filters, limit, offset

    const [monthText, monthParams] = pool.query.mock.calls[2];
    expect(monthParams).toHaveLength(3);
    expect(monthParams[0]).toBe('privacy_policy');
    expect(monthParams[1]).toBe('%ann%');
    expect(monthParams[2]).toBeInstanceOf(Date);
    // The date placeholder must be $3, not a reused filter placeholder.
    expect(monthText).toMatch(/accepted_at >= \$3/);
  });
});
