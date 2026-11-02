'use strict';

/**
 * legalRevocationReads.test.js
 *
 * Regression tests for the 2026-11-02 admin-ops audit item 2 (legal
 * acceptance revocation was unenforced AND invisible): revocation stamps
 * deleted_at, so every acceptance read must filter deleted_at IS NULL, a
 * revoked row must not report alreadyAccepted, and re-acceptance after a
 * revocation must succeed (reactivating the row, because migration 587's
 * unique index on (user, document_type, version_number) is not partial
 * on deleted_at and would otherwise reject a fresh insert).
 *
 * Phase B note: no server action consults user_legal_acceptances as a
 * prerequisite (the only acceptance gate, requireTermsAcceptance, reads
 * the separate user_consents table), so there is no existing gate to
 * extend here; these tests lock the read/honesty behavior only.
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

const USER_REQ = (overrides = {}) => ({
  user: { id: 'user-1', role: 'user' },
  body: { firstName: 'Ann', lastName: 'Example', versionNumber: 1 },
  params: { documentType: 'contractor_agreement' },
  query: {},
  ip: '1.2.3.4',
  get: () => 'test-agent',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('revoked acceptances are invisible to reads', () => {
  test('getUserAcceptances filters deleted_at IS NULL, with and without a type filter', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = resMock();
    await controller.getUserAcceptances(USER_REQ(), res, nextMock());
    expect(pool.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
    expect(res.json.mock.calls[0][0].acceptances).toEqual([]);

    pool.query.mockClear();
    const res2 = resMock();
    await controller.getUserAcceptances(
      USER_REQ({ query: { documentType: 'privacy_policy' } }), res2, nextMock(),
    );
    const [text, params] = pool.query.mock.calls[0];
    expect(text).toMatch(/deleted_at IS NULL/);
    expect(text).toMatch(/document_type = \$2/);
    expect(params).toEqual(['user-1', 'privacy_policy']);
  });

  test('getAcceptanceHistory filters deleted_at IS NULL', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = resMock();
    await controller.getAcceptanceHistory(USER_REQ(), res, nextMock());
    expect(pool.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
    expect(res.json.mock.calls[0][0].history).toEqual([]);
    expect(res.json.mock.calls[0][0].latestVersion).toBeNull();
  });

  test('listAllAcceptances count and data queries filter deleted_at IS NULL', async () => {
    pool.query.mockImplementation((text) => {
      if (/COUNT\(\*\) as total/i.test(text)) return Promise.resolve({ rows: [{ total: '0' }] });
      if (/GROUP BY document_type/i.test(text)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = resMock();
    await controller.listAllAcceptances({ query: {} }, res, nextMock());
    expect(res.json.mock.calls[0][0].success).toBe(true);
    for (const [text] of pool.query.mock.calls) {
      if (/user_legal_acceptances/i.test(text)) {
        // Count/data queries alias the table as ula; the by-type stats
        // query does not, so accept either spelling of the filter.
        expect(text).toMatch(/(ula\.)?deleted_at IS NULL/);
      }
    }
  });

  test('getComplianceMetrics acceptance-rate queries filter deleted_at IS NULL', async () => {
    pool.query.mockImplementation((text) => {
      if (/FROM users WHERE/i.test(text)) return Promise.resolve({ rows: [{ total: '10' }] });
      if (/COUNT\(DISTINCT user_id\)/i.test(text)) return Promise.resolve({ rows: [{ accepted: '0' }] });
      if (/AVG\(EXTRACT/i.test(text)) return Promise.resolve({ rows: [{ avg_days: null }] });
      if (/DATE\(accepted_at\)/i.test(text)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ total: '0' }] });
    });
    const res = resMock();
    await controller.getComplianceMetrics({}, res, nextMock());
    expect(res.json.mock.calls[0][0].success).toBe(true);
    const rateQueries = pool.query.mock.calls
      .map(([text]) => text)
      .filter((text) => /COUNT\(DISTINCT user_id\)/i.test(text));
    expect(rateQueries.length).toBeGreaterThan(0);
    for (const text of rateQueries) {
      expect(text).toMatch(/deleted_at IS NULL/);
    }
  });
});

describe('revoked acceptances do not block re-acceptance', () => {
  function routeRecordAcceptance({ activeRow, revokedRow }) {
    pool.query.mockImplementation((text) => {
      if (/FROM users WHERE/i.test(text)) {
        return Promise.resolve({ rows: [{ id: 'user-1', is_active: true, deleted_at: null }] });
      }
      if (/deleted_at IS NULL/i.test(text)) {
        return Promise.resolve({ rows: activeRow ? [activeRow] : [] });
      }
      if (/deleted_at IS NOT NULL/i.test(text)) {
        return Promise.resolve({ rows: revokedRow ? [revokedRow] : [] });
      }
      if (/UPDATE user_legal_acceptances/i.test(text)) {
        return Promise.resolve({ rows: [{ id: revokedRow.id, accepted_at: '2026-11-02T00:00:00.000Z' }] });
      }
      if (/INSERT INTO user_legal_acceptances/i.test(text)) {
        return Promise.resolve({ rows: [{ id: 'new-acceptance', accepted_at: '2026-11-02T00:00:00.000Z' }] });
      }
      return Promise.resolve({ rows: [] }); // audit log insert
    });
  }

  test('an active row still reports alreadyAccepted and performs no insert', async () => {
    routeRecordAcceptance({ activeRow: { id: 'active-1' }, revokedRow: null });
    const res = resMock();
    await controller.recordAcceptance(USER_REQ(), res, nextMock());
    expect(res.json.mock.calls[0][0].alreadyAccepted).toBe(true);
    expect(res.json.mock.calls[0][0].acceptanceId).toBe('active-1');
    expect(pool.query.mock.calls.some(([t]) => /INSERT INTO user_legal_acceptances/i.test(t))).toBe(false);
  });

  test('a revoked-only row is reactivated with a 201, not alreadyAccepted', async () => {
    routeRecordAcceptance({ activeRow: null, revokedRow: { id: 'revoked-1' } });
    const res = resMock();
    await controller.recordAcceptance(USER_REQ(), res, nextMock());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].acceptanceId).toBe('revoked-1');
    expect(res.json.mock.calls[0][0].alreadyAccepted).toBeUndefined();
    expect(pool.query.mock.calls.some(([t]) => /UPDATE user_legal_acceptances/i.test(t))).toBe(true);
    expect(pool.query.mock.calls.some(([t]) => /INSERT INTO user_legal_acceptances/i.test(t))).toBe(false);
  });

  test('a fresh acceptance inserts when neither an active nor a revoked row exists', async () => {
    routeRecordAcceptance({ activeRow: null, revokedRow: null });
    const res = resMock();
    await controller.recordAcceptance(USER_REQ(), res, nextMock());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].acceptanceId).toBe('new-acceptance');
  });
});

describe('revokeAcceptance double-revoke', () => {
  test('revoking an already-revoked row returns 409 instead of re-stamping it', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 'acc-1', document_type: 'privacy_policy', version_number: 1, user_id: 'user-1', deleted_at: '2026-11-01T00:00:00.000Z' }],
    });
    const res = resMock();
    const next = nextMock();
    await expect(controller.revokeAcceptance(
      { params: { acceptanceId: 'acc-1' }, body: { reason: 'admin_review' }, user: { id: 'admin-1', role: 'admin' }, ip: '1.2.3.4', get: () => 'agent' },
      res, next,
    )).rejects.toMatchObject({ statusCode: 409 });
    expect(pool.query.mock.calls.some(([t]) => /UPDATE user_legal_acceptances/i.test(t))).toBe(false);
  });
});
