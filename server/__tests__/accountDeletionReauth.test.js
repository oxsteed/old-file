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
