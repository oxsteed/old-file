'use strict';

/**
 * legalRevocationConsentClearing.test.js — Nov 2 admin-ops audit item 2
 * phase B (enforcement half; phase A read filtering is locked by
 * legalRevocationReads.test.js).
 *
 * - Revoking a mapped acceptance (privacy_policy, terms_of_service) deletes
 *   every user_consents row for that user and consent type, and reports
 *   enforcement 'consent_cleared' with the cleared count, so the
 *   requireTermsAcceptance gate (which reads only user_consents) blocks
 *   the user until they re-accept.
 * - Revoking an unmapped acceptance clears nothing and stays
 *   enforcement 'record_only': unrelated consents are never touched.
 * - terms_of_service round-trips through recordAcceptance (it is now in
 *   VALID_DOCUMENT_TYPES) and through the gate (missing consent blocks).
 */

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const pool = require('../db');
const controller = require('../controllers/legalDocumentsController');
const requireTermsAcceptance = require('../middleware/requireTermsAcceptance');

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
});

function revokeReq(acceptanceRow) {
  // Domain 7 #14: the consent DELETE and the acceptance UPDATE now run in
  // one client transaction. The acceptance SELECT and the audit INSERT
  // still go through pool.query; BEGIN/COMMIT and the two writes go
  // through the checked-out client.
  const clientQuery = jest.fn(async (sql) => {
    const text = String(sql);
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (text.includes('DELETE FROM user_consents')) return { rows: [], rowCount: 3 };
    if (text.includes('UPDATE user_legal_acceptances')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const client = { query: clientQuery, release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  pool.query.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('FROM user_legal_acceptances WHERE id')) {
      return { rows: [acceptanceRow] };
    }
    if (text.includes('INSERT INTO legal_audit_log')) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return {
    params: { acceptanceId: acceptanceRow.id },
    body: { reason: 'admin_review' },
    user: { id: 'admin-1', role: 'admin' },
    ip: '1.2.3.4',
    get: () => 'test-agent',
    __clientQuery: clientQuery,
    __client: client,
  };
}

describe('revocation clears the mapped consent', () => {
  test('revoking privacy_policy deletes that consent type only and reports consent_cleared', async () => {
    const req = revokeReq({
      id: 'acc-1', user_id: 'user-1', document_type: 'privacy_policy',
      version_number: 1, deleted_at: null,
    });
    const res = resMock();
    await controller.revokeAcceptance(req, res, nextMock());

    const deleteCall = req.__clientQuery.mock.calls.find(([sql]) => String(sql).includes('DELETE FROM user_consents'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall[1]).toEqual(['user-1', 'privacy_policy']);
    expect(req.__clientQuery.mock.calls.map(([sql]) => String(sql))).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM user_consents'),
      expect.stringContaining('UPDATE user_legal_acceptances'),
      'COMMIT',
    ]);
    expect(req.__client.release).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      enforcement: 'consent_cleared',
      consentType: 'privacy_policy',
      clearedConsents: 3,
    });
  });

  test('revoking terms_of_service clears the terms consent', async () => {
    const req = revokeReq({
      id: 'acc-2', user_id: 'user-1', document_type: 'terms_of_service',
      version_number: 1, deleted_at: null,
    });
    const res = resMock();
    await controller.revokeAcceptance(req, res, nextMock());

    const deleteCall = req.__clientQuery.mock.calls.find(([sql]) => String(sql).includes('DELETE FROM user_consents'));
    expect(deleteCall[1]).toEqual(['user-1', 'terms_of_service']);
    expect(res.json.mock.calls[0][0].enforcement).toBe('consent_cleared');
  });

  test('revoking an unmapped document clears no consent and stays record_only', async () => {
    const req = revokeReq({
      id: 'acc-3', user_id: 'user-1', document_type: 'contractor_agreement',
      version_number: 2, deleted_at: null,
    });
    const res = resMock();
    await controller.revokeAcceptance(req, res, nextMock());

    expect(req.__clientQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM user_consents'))).toBe(false);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      enforcement: 'record_only',
      consentType: null,
      clearedConsents: 0,
    });
  });
});

describe('terms_of_service round-trips through the controller', () => {
  test('recordAcceptance accepts terms_of_service with a 201', async () => {
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM users WHERE id')) return { rows: [{ id: 'user-1', is_active: true, deleted_at: null }] };
      if (text.includes('deleted_at IS NULL')) return { rows: [] };
      if (text.includes('deleted_at IS NOT NULL')) return { rows: [] };
      if (text.includes('INSERT INTO user_legal_acceptances')) {
        return { rows: [{ id: 'acc-new', accepted_at: '2026-11-03T00:00:00.000Z' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = resMock();
    await controller.recordAcceptance(
      {
        params: { documentType: 'terms_of_service' },
        body: { firstName: 'Ann', lastName: 'Example', versionNumber: 1 },
        user: { id: 'user-1', role: 'user' },
        ip: '1.2.3.4',
        get: () => 'test-agent',
      },
      res,
      nextMock()
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      documentType: 'terms_of_service',
      acceptanceId: 'acc-new',
    });
  });

  test('getUserAcceptances accepts a terms_of_service filter', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = resMock();
    await controller.getUserAcceptances(
      { user: { id: 'user-1' }, query: { documentType: 'terms_of_service' } },
      res,
      nextMock()
    );
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, total: 0 });
  });

  test('VALID_DOCUMENT_TYPES includes terms_of_service and the map covers only the two gate consents', () => {
    expect(controller.VALID_DOCUMENT_TYPES).toContain('terms_of_service');
    expect(controller.DOCUMENT_TO_CONSENT_TYPE).toEqual({
      terms_of_service: 'terms_of_service',
      privacy_policy: 'privacy_policy',
    });
  });
});

describe('TermsGate blocks once the consent rows are gone', () => {
  test('no consent rows for the user returns 403 listing terms_of_service as outstanding', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const req = { user: { id: 'user-1' } };
    const res = resMock();
    const next = jest.fn();
    await requireTermsAcceptance(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const body = res.json.mock.calls[0][0];
    expect(body.error).toBe('terms_acceptance_required');
    expect(body.outstanding.map((o) => o.consent_type)).toContain('terms_of_service');
  });

  test('current-version consent rows for both required types pass the gate', async () => {
    pool.query.mockResolvedValue({
      rows: [
        { consent_type: 'terms_of_service', version: '2026-10-13' },
        { consent_type: 'privacy_policy', version: '2026-10-13' },
      ],
    });
    const req = { user: { id: 'user-1' } };
    const res = resMock();
    const next = jest.fn();
    await requireTermsAcceptance(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
