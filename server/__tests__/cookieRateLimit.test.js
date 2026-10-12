'use strict';

jest.mock('../utils/redis', () => null);
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');
const { getVerifiedAuthUserId, generalLimiter, authenticatedLimiter } = require('../middleware/rateLimiter');

function sign(payload = { id: 401 }, options = {}, secret = process.env.JWT_SECRET) {
  return jwt.sign(payload, secret, { algorithm: 'HS256', ...options });
}
function req(cookie, bearer) {
  return { headers: {
    ...(cookie === undefined ? {} : { cookie }),
    ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
  } };
}
function app() {
  const instance = express();
  instance.set('trust proxy', 1);
  instance.use(generalLimiter, authenticatedLimiter);
  instance.get('/dashboard', (request, response) => response.json({ ok: true }));
  return instance;
}

describe('verified browser-session budget', () => {
  test('accepts the HttpOnly access cookie without exposing or relying on its presence alone', () => {
    expect(getVerifiedAuthUserId(req(`other=x; oxsteed_access=${encodeURIComponent(sign())}; next=y`))).toBe(401);
  });

  test('retains native Bearer compatibility', () => {
    expect(getVerifiedAuthUserId(req(undefined, sign({ id: 402 })))).toBe(402);
  });

  test('cookie takes precedence over a different normal Bearer account', () => {
    expect(getVerifiedAuthUserId(req(`oxsteed_access=${sign({ id: 403 })}`, sign({ id: 404 })))).toBe(403);
  });

  test('verified impersonation Bearer takes precedence over the admin cookie', () => {
    expect(getVerifiedAuthUserId(req(`oxsteed_access=${sign({ id: 405 })}`, sign({ id: 406, isImpersonated: true })))).toBe(406);
  });

  test('invalid impersonation cannot inherit a valid admin-cookie budget', () => {
    const invalid = sign({ id: 407, isImpersonated: true }, {}, 'synthetic-wrong-signing-key');
    expect(getVerifiedAuthUserId(req(`oxsteed_access=${sign()}`, invalid))).toBeNull();
  });

  test('invalid access cookie cannot fall back to a different valid normal Bearer', () => {
    expect(getVerifiedAuthUserId(req('oxsteed_access=invalid', sign()))).toBeNull();
  });

  test.each([
    ['absent', undefined],
    ['unrelated cookie', 'different_cookie=value'],
    ['similar name', `prefix_oxsteed_access=${sign()}`],
    ['garbage', 'oxsteed_access=garbage'],
    ['malformed encoding', 'oxsteed_access=%INVALID'],
    ['expired', `oxsteed_access=${sign({ id: 401 }, { expiresIn: '-1s' })}`],
    ['wrong signature', `oxsteed_access=${sign({ id: 401 }, {}, 'synthetic-wrong-key')}`],
    ['wrong algorithm', `oxsteed_access=${sign({ id: 401 }, { algorithm: 'HS384' })}`],
    ['no subject', `oxsteed_access=${sign({ role: 'customer' })}`],
    ['MFA challenge', `oxsteed_access=${sign({ id: 401, isMfaToken: true })}`],
    ['refresh credential', `oxsteed_access=${sign({ id: 401, type: 'refresh' })}`],
  ])('%s stays anonymous', (_, cookie) => {
    expect(getVerifiedAuthUserId(req(cookie))).toBeNull();
  });

  test.each([{ id: 401, isMfaToken: true }, { id: 401, type: 'refresh' }])('non-access Bearer token stays anonymous: %j', payload => {
    expect(getVerifiedAuthUserId(req(undefined, sign(payload)))).toBeNull();
  });

  test('verifies once when the general and authenticated boundaries examine the same request', () => {
    const request = req(`oxsteed_access=${sign()}`);
    const spy = jest.spyOn(jwt, 'verify');
    try {
      expect(getVerifiedAuthUserId(request)).toBe(401);
      request.headers.cookie = 'oxsteed_access=garbage';
      expect(getVerifiedAuthUserId(request)).toBe(401);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });

  test('exhausting the anonymous IP bucket does not prevent signed-in dashboard requests', async () => {
    const instance = app();
    const send = () => request(instance).get('/dashboard').set('X-Forwarded-For', '192.0.2.101');
    for (let i = 0; i < 200; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    const res = await send().set('Cookie', `oxsteed_access=${sign({ id: 410 })}`);
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('500');
    expect(res.headers['ratelimit-remaining']).toBe('499');
    expect((await send().set('Cookie', 'oxsteed_access=invalid')).status).toBe(429);
  });

  test('cookie and Bearer traffic share a bounded per-user budget, isolated from other users on the same IP', async () => {
    const instance = app();
    const token = sign({ id: 411 });
    const send = () => request(instance).get('/dashboard').set('X-Forwarded-For', '192.0.2.102');
    for (let i = 0; i < 500; i++) {
      expect((await (i % 2 ? send().set('Authorization', `Bearer ${token}`) : send().set('Cookie', `oxsteed_access=${token}`))).status).toBe(200);
    }
    expect((await send().set('Cookie', `oxsteed_access=${token}`)).status).toBe(429);
    expect((await send().set('Authorization', `Bearer ${token}`)).status).toBe(429);
    const other = await send().set('Cookie', `oxsteed_access=${sign({ id: 412 })}`);
    expect(other.status).toBe(200);
    expect(other.headers['ratelimit-remaining']).toBe('499');
    const anonymous = await send();
    expect(anonymous.status).toBe(200);
    expect(anonymous.headers['ratelimit-limit']).toBe('200');
    expect(anonymous.headers['ratelimit-remaining']).toBe('199');
  });
});
