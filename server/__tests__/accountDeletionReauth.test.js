'use strict';

/**
 * Security review 2026-11-10 F-08: DELETE /api/privacy/delete-account used
 * to need only a live session plus the literal confirmation text, so a
 * stolen access token, an XSS on our origin or an impersonating admin could
 * irreversibly delete and anonymize the account.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticator } = require('@otplib/v12-adapter');
const { encrypt } = require('../utils/encryption');
const { requireSensitiveReauth } = require('../middleware/requireSensitiveReauth');

const USER = '00000000-0000-4000-8000-0000000000d1';
let passwordHash;

beforeAll(async () => { passwordHash = await bcrypt.hash('correct horse battery', 4); });
beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  authenticator.verify.mockReturnValue(true);
});

function app({ headers = {} } = {}) {
  const a = express();
  a.use(express.json());
  a.delete('/delete', (req, _res, next) => { req.user = { id: USER }; Object.assign(req.headers, headers); next(); },
    requireSensitiveReauth, (req, res) => res.json({ deleted: true, sawPassword: 'currentPassword' in req.body }));
  return a;
}
const account = (overrides = {}) => mockQuery.mockResolvedValue({
  rows: [{ password_hash: passwordHash, totp_enabled: false, totp_secret: null, ...overrides }],
});

test('a session alone (no password) cannot delete the account', async () => {
  account();
  const res = await request(app()).delete('/delete').send({ confirmation: 'DELETE MY ACCOUNT' });
  expect(res.status).toBe(401);
  expect(res.body.code).toBe('reauth_password_required');
});

test('a wrong password is refused', async () => {
  account();
  const res = await request(app()).delete('/delete').send({ confirmation: 'DELETE MY ACCOUNT', currentPassword: 'guess' });
  expect(res.status).toBe(401);
  expect(res.body.code).toBe('reauth_invalid');
});

test('the right password passes and is stripped before the handler', async () => {
  account();
  const res = await request(app()).delete('/delete').send({ confirmation: 'DELETE MY ACCOUNT', currentPassword: 'correct horse battery' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ deleted: true, sawPassword: false });
});

test('with 2FA on, the password alone is not enough; a valid code is required', async () => {
  account({ totp_enabled: true, totp_secret: encrypt('TESTSECRET') });
  const missing = await request(app()).delete('/delete').send({ currentPassword: 'correct horse battery' });
  expect(missing.body.code).toBe('reauth_totp_required');
  authenticator.verify.mockReturnValue(false);
  const bad = await request(app()).delete('/delete').send({ currentPassword: 'correct horse battery', totpCode: '000000' });
  expect(bad.body.code).toBe('reauth_invalid');
  authenticator.verify.mockReturnValue(true);
  const ok = await request(app()).delete('/delete').send({ currentPassword: 'correct horse battery', totpCode: '123 456' });
  expect(ok.status).toBe(200);
});

test('an account with neither a password nor 2FA must set a password first', async () => {
  account({ password_hash: 'DELETED' });
  const res = await request(app()).delete('/delete').send({ currentPassword: 'anything' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('reauth_unavailable');
});

test('an impersonated session is refused even with the right password', async () => {
  account();
  const imp = jwt.sign({ id: USER, typ: 'access', impersonation: true, impersonated_by: 'admin-1', jti: 'j' }, process.env.JWT_SECRET);
  const res = await request(app({ headers: { authorization: `Bearer ${imp}` } }))
    .delete('/delete').send({ currentPassword: 'correct horse battery' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('impersonation_blocked');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('the privacy router mounts the re-authentication gate on delete-account', () => {
  const router = require('../routes/privacy');
  const layer = router.stack.find((l) => l.route?.path === '/delete-account' && l.route.methods.delete);
  const names = layer.route.stack.map((s) => s.name);
  expect(names).toEqual(expect.arrayContaining(['authenticate', 'requireSensitiveReauth']));
  expect(names.indexOf('requireSensitiveReauth')).toBeGreaterThan(names.indexOf('authenticate'));
});

// Domain 6 #7 (finding 2): requireSensitiveReauth was the eleventh TOTP
// verify site and the only one that never consumed the shared counter, so
// a code used at login still verified at DELETE /delete-account and vice
// versa. These tests simulate the atomic upsert in totp_used_counters
// (INSERT ... ON CONFLICT ... WHERE new counter > stored max RETURNING):
// the consume returns one row only when the current 30s step counter is
// strictly greater than the stored max for the user; a second consume in
// the same step returns zero rows (replay).
describe('Domain 6 #7: TOTP replay guard at the sensitive-reauth site', () => {
  const { consumeTotpCounter } = require('../services/totpReplayGuard');

  afterEach(() => { jest.restoreAllMocks(); });

  function pinClockMidStep(baseMs) {
    const stepStart = baseMs - (baseMs % 30000);
    jest.spyOn(Date, 'now').mockReturnValue(stepStart + 15000);
  }

  // Account SELECT keeps returning the TOTP-enabled account; the guard
  // INSERT behaves like the real upsert, tracked per user in memory.
  function installGuardSimulation() {
    const consumed = new Map();
    mockQuery.mockImplementation(async (text, params) => {
      if (String(text).includes('totp_used_counters')) {
        const counter = Math.floor(Date.now() / 30000);
        const userId = params[0];
        if ((consumed.get(userId) ?? -1) >= counter) return { rows: [], rowCount: 0 };
        consumed.set(userId, counter);
        return { rows: [{ max_counter: counter }], rowCount: 1 };
      }
      return { rows: [{ password_hash: passwordHash, totp_enabled: true, totp_secret: encrypt('TESTSECRET') }] };
    });
    return consumed;
  }

  const deleteBody = { confirmation: 'DELETE MY ACCOUNT', currentPassword: 'correct horse battery', totpCode: '123456' };

  test('a code verified here cannot verify again here in the same step', async () => {
    pinClockMidStep(1780014400000);
    installGuardSimulation();
    const first = await request(app()).delete('/delete').send(deleteBody);
    expect(first.status).toBe(200);
    const replay = await request(app()).delete('/delete').send(deleteBody);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('reauth_invalid');
  });

  test('a code already consumed at another guarded site is refused here', async () => {
    pinClockMidStep(1780018000000);
    installGuardSimulation();
    expect(await consumeTotpCounter({ query: mockQuery }, USER)).toBe(true);
    const res = await request(app()).delete('/delete').send(deleteBody);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('reauth_invalid');
  });

  test('a code verified here cannot verify again at another guarded site', async () => {
    pinClockMidStep(1780021600000);
    installGuardSimulation();
    const res = await request(app()).delete('/delete').send(deleteBody);
    expect(res.status).toBe(200);
    expect(await consumeTotpCounter({ query: mockQuery }, USER)).toBe(false);
  });

  test('a consumption failure fails closed instead of silently passing', async () => {
    pinClockMidStep(1780025200000);
    mockQuery.mockImplementation(async (text) => {
      if (String(text).includes('totp_used_counters')) throw new Error('guard store unavailable');
      return { rows: [{ password_hash: passwordHash, totp_enabled: true, totp_secret: encrypt('TESTSECRET') }] };
    });
    const res = await request(app()).delete('/delete').send(deleteBody);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('reauth_failed');
  });
});
