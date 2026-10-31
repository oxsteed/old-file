'use strict';

/**
 * auditQ2T56CountParams.test.js — Audit queue Q2, T56-F01.
 *
 * Original defect (Oct 2 audit): the legal-acceptances count query bound
 * the wrong parameter array (params.slice(0, paramCount - 2)). With filters
 * it dropped the last filter; without filters it supplied the LIMIT value
 * to a query with no placeholders, so the endpoint 500'd with a bind
 * message.
 *
 * The fix: the count query takes only the filter params
 * (params.slice(0, paramCount - 1); paramCount is 1-based). This test
 * locks the behavior, not just the arithmetic: the mock database enforces
 * Postgres bind semantics (placeholder count must equal bound params, as a
 * real server would), and the response total must come from the count
 * query rather than the page length.
 *
 * Note: legalAcceptancesParams.test.js (Sentry OXSTEED-BACKEND-30) asserts
 * placeholder arity on the same handler; this test is the audit-targeted
 * one, asserting the filtered total/pages behavior end to end.
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

function maxPlaceholder(text) {
  const matches = String(text).match(/\$(\d+)/g) || [];
  return matches.reduce((max, m) => Math.max(max, parseInt(m.slice(1), 10)), 0);
}

function resMock() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function nextMock() {
  return jest.fn((err) => { if (err) throw err; });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Enforce Postgres bind semantics: a query whose bound params do not
  // match its placeholders fails, exactly as the production 500 did.
  pool.query.mockImplementation(async (text, params) => {
    const sql = String(text);
    const bound = params || [];
    if (maxPlaceholder(sql) !== bound.length) {
      throw new Error(`bind message supplies ${bound.length} parameters, but prepared statement requires ${maxPlaceholder(sql)}`);
    }
    if (/GROUP BY document_type/i.test(sql)) return { rows: [] };
    if (/COUNT\(\*\) as total/i.test(sql) && /accepted_at >=/i.test(sql)) return { rows: [{ total: '2' }] };
    if (/COUNT\(\*\) as total/i.test(sql)) return { rows: [{ total: '5' }] };
    return { rows: [] };
  });
});

describe('T56-F01 legal acceptances count params', () => {
  test('unfiltered load: count takes no params and total comes from the count query', async () => {
    const res = resMock();
    await controller.listAllAcceptances({ query: {} }, res, nextMock());

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.pagination.total).toBe(5);
    expect(body.pagination.pages).toBe(1);
    expect(body.stats.totalAcceptances).toBe(5);

    const [countText, countParams] = pool.query.mock.calls[0];
    expect(countText).not.toMatch(/LIMIT/);
    expect(countParams).toEqual([]);
  });

  test('filtered load: count binds exactly the filter values in order', async () => {
    const res = resMock();
    await controller.listAllAcceptances(
      { query: { documentType: 'privacy_policy', search: 'ann', page: '1', limit: '2' } },
      res,
      nextMock(),
    );

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    // Total is the filtered count (5), not the page length (0 data rows
    // in this mock); pages derive from it.
    expect(body.pagination.total).toBe(5);
    expect(body.pagination.pages).toBe(3);
    expect(body.stats.totalAcceptances).toBe(5);

    const [countText, countParams] = pool.query.mock.calls[0];
    expect(countText).not.toMatch(/LIMIT/);
    expect(countParams).toEqual(['privacy_policy', '%ann%']);
  });
});
