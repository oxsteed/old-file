'use strict';

/**
 * Domain 7 #14 — re-accepting terms and re-consenting use two unsynced stores.
 *
 * recordAcceptance reactivated a revoked row but never wrote user_consents,
 * so TermsGate (which reads only user_consents) kept 403ing until the user
 * also hit /consent/accept or logged in again. Conversely the revoke itself
 * was non-transactional: the consent DELETE and the acceptance UPDATE were
 * separate pool queries, so a crash between them left an active-looking
 * acceptance with no consent.
 *
 * Fix: recordAcceptance for mapped types re-inserts the user_consents row
 * (idempotently — an existing consent is not duplicated), and revoke wraps
 * its two writes in one transaction.
 *
 * Repro: re-accept terms_of_service after a revoke, then run the gate.
 * Before the fix no consent row is written and the gate 403s; after the
 * fix the consent row exists and the gate passes.
 */

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const crypto = require('crypto');
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

let consents;
let revokedRows;
let activeRows;

function acceptReq(documentType, versionNumber = 1) {
  return {
    params: { documentType },
    body: { firstName: 'Ann', lastName: 'Example', versionNumber },
    user: { id: 'user-1', role: 'user' },
    ip: '1.2.3.4',
    get: () => 'test-agent',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  consents = [];
  revokedRows = [];
  activeRows = [];
  pool.query.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FROM users WHERE id')) {
      return { rows: [{ id: 'user-1', is_active: true, deleted_at: null }] };
    }
    if (text.includes('FROM user_legal_acceptances WHERE id')) {
      return { rows: [{ id: 'acc-1', user_id: 'user-1', document_type: 'terms_of_service', version_number: 1, deleted_at: null }] };
    }
    if (text.includes('deleted_at IS NOT NULL')) return { rows: revokedRows };
    if (text.includes('deleted_at IS NULL')) return { rows: activeRows };
    if (text.includes('SELECT id FROM user_consents')) {
      const found = consents.filter((c) => c.user_id === params[0] && c.consent_type === params[1]);
      return { rows: found.map(() => ({ id: 'c-1' })) };
    }
    if (text.includes('INSERT INTO user_consents')) {
      consents.push({ user_id: params[0], consent_type: params[1], version: params[2] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('SELECT DISTINCT ON (consent_type)')) {
      return { rows: consents.map((c) => ({ consent_type: c.consent_type, version: c.version })) };
    }
    if (text.includes('UPDATE user_legal_acceptances')) {
      return { rows: [{ id: 'acc-1', accepted_at: '2026-11-03T00:00:00.000Z' }] };
    }
    if (text.includes('INSERT INTO user_legal_acceptances')) {
      return { rows: [{ id: 'acc-new', accepted_at: '2026-11-03T00:00:00.000Z' }] };
    }
    if (text.includes('INSERT INTO legal_audit_log')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
});

describe('re-acceptance re-syncs user_consents', () => {
  test('re-accepting terms after revoke writes the consent and the TermsGate passes', async () => {
    revokedRows.push({ id: 'acc-1' });
    consents.push({ user_id: 'user-1', consent_type: 'privacy_policy', version: '2026-10-13' });
    const res = resMock();

    await controller.recordAcceptance(acceptReq('terms_of_service'), res, nextMock());

    expect(res.status).toHaveBeenCalledWith(201);
    const terms = consents.filter((c) => c.consent_type === 'terms_of_service');
    expect(terms).toHaveLength(1);
    expect(terms[0].version).toBe('2026-10-13');
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO user_consents'));
    expect(insertCall[1][0]).toBe('user-1');
    expect(insertCall[1][1]).toBe('terms_of_service');
    expect(insertCall[1][3]).toBe(crypto.createHash('sha256').update('1.2.3.4').digest('hex'));

    const gateRes = resMock();
    const gateNext = jest.fn();
    await requireTermsAcceptance({ user: { id: 'user-1' } }, gateRes, gateNext);
    expect(gateNext).toHaveBeenCalled();
    expect(gateRes.status).not.toHaveBeenCalledWith(403);
  });

  test('a fresh acceptance of a mapped type writes the consent row', async () => {
    const res = resMock();
    await controller.recordAcceptance(acceptReq('privacy_policy'), res, nextMock());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(consents.filter((c) => c.consent_type === 'privacy_policy')).toHaveLength(1);
  });

  test('re-accepting when the consent already exists does not duplicate it', async () => {
    revokedRows.push({ id: 'acc-1' });
    consents.push({ user_id: 'user-1', consent_type: 'terms_of_service', version: '2026-10-13' });
    const res = resMock();
    await controller.recordAcceptance(acceptReq('terms_of_service'), res, nextMock());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(consents.filter((c) => c.consent_type === 'terms_of_service')).toHaveLength(1);
  });

  test('re-accepting an unmapped type writes no consent', async () => {
    const res = resMock();
    await controller.recordAcceptance(acceptReq('contractor_agreement', 2), res, nextMock());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(consents).toHaveLength(0);
  });

  test('an already-accepted row with a missing consent is repaired on re-accept', async () => {
    activeRows.push({ id: 'acc-1' });
    const res = resMock();
    await controller.recordAcceptance(acceptReq('terms_of_service'), res, nextMock());
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, alreadyAccepted: true });
    expect(consents.filter((c) => c.consent_type === 'terms_of_service')).toHaveLength(1);
  });
});

describe('revoke is atomic', () => {
  function revokeReq() {
    return {
      params: { acceptanceId: 'acc-1' },
      body: { reason: 'admin_review' },
      user: { id: 'admin-1', role: 'admin' },
      ip: '1.2.3.4',
      get: () => 'test-agent',
    };
  }

  function installClient(impl) {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query.mockImplementation(impl);
    pool.connect.mockResolvedValue(client);
    return client;
  }

  test('a failing acceptance UPDATE rolls back the consent delete', async () => {
    const client = installClient(async (sql) => {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('DELETE FROM user_consents')) return { rows: [], rowCount: 2 };
      if (text.includes('UPDATE user_legal_acceptances')) throw new Error('update failed');
      return { rows: [], rowCount: 0 };
    });
    const res = resMock();
    const next = jest.fn();

    await controller.revokeAcceptance(revokeReq(), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'update failed' }));
    expect(res.json).not.toHaveBeenCalled();
    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe('BEGIN');
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('a successful revoke commits and releases the client', async () => {
    const client = installClient(async (sql) => {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('DELETE FROM user_consents')) return { rows: [], rowCount: 2 };
      if (text.includes('UPDATE user_legal_acceptances')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = resMock();

    await controller.revokeAcceptance(revokeReq(), res, nextMock());

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toEqual(['BEGIN', expect.stringContaining('DELETE FROM user_consents'), expect.stringContaining('UPDATE user_legal_acceptances'), 'COMMIT']);
    expect(client.release).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      enforcement: 'consent_cleared',
      clearedConsents: 2,
    });
  });
});
