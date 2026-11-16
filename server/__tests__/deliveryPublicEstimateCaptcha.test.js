'use strict';

// Bot check on the public delivery estimate: GET /public/captcha-config tells
// the client whether to render the widget (never the secret), and with
// CAPTCHA_ENABLED=true the estimate needs a verified token.
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));

const express = require('express');
const request = require('supertest');

const ORIGIN = { address: '1 W Main St', city: 'Springfield', state: 'OH', country: 'US', lat: 39.9242, lng: -83.8088 };
const DESTINATION = { address: '2 E High St', city: 'Springfield', state: 'OH', country: 'US', lat: 39.953, lng: -83.81 };
const ENV_KEYS = ['CAPTCHA_ENABLED', 'CAPTCHA_PROVIDER', 'CAPTCHA_SECRET', 'CAPTCHA_SITE_KEY'];

function buildApp(env) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  let app;
  jest.isolateModules(() => {
    const { errorHandler } = require('../middleware/errorHandler');
    const routes = require('../routes/localDelivery');
    app = express();
    app.use(express.json());
    app.use('/delivery', routes);
    app.use(errorHandler);
  });
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  return app;
}

afterEach(() => { delete global.fetch; });

test('captcha config is off by default and never exposes the secret', async () => {
  const res = await request(buildApp({ CAPTCHA_SECRET: 'top-secret', CAPTCHA_SITE_KEY: 'site-key' })).get('/delivery/public/captcha-config');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body.captcha).toEqual({ enabled: false, provider: 'turnstile', siteKey: null });
  expect(JSON.stringify(res.body)).not.toMatch(/top-secret/);
});

test('captcha config publishes the site key when enabled', async () => {
  const res = await request(buildApp({ CAPTCHA_ENABLED: 'true', CAPTCHA_SECRET: 'top-secret', CAPTCHA_SITE_KEY: 'site-key' })).get('/delivery/public/captcha-config');
  expect(res.body.captcha).toEqual({ enabled: true, provider: 'turnstile', siteKey: 'site-key' });
  expect(JSON.stringify(res.body)).not.toMatch(/top-secret/);
});

test('with CAPTCHA_ENABLED the public estimate needs a token and accepts a verified one', async () => {
  const app = buildApp({ CAPTCHA_ENABLED: 'true', CAPTCHA_SECRET: 'top-secret', CAPTCHA_SITE_KEY: 'site-key' });
  const body = { origin: ORIGIN, destination: DESTINATION, packageType: 'small' };

  const missing = await request(app).post('/delivery/public/estimate').set('X-Forwarded-For', '198.51.100.1').send(body);
  expect(missing.status).toBe(400);
  expect(missing.body.error).toBe('captcha_required');

  global.fetch = jest.fn(async () => ({ json: async () => ({ success: false }) }));
  const rejected = await request(app).post('/delivery/public/estimate').send({ ...body, captchaToken: 'bad' });
  expect(rejected.status).toBe(403);
  expect(rejected.body.error).toBe('captcha_failed');

  global.fetch = jest.fn(async () => ({ json: async () => ({ success: true }) }));
  const ok = await request(app).post('/delivery/public/estimate').send({ ...body, captchaToken: 'good' });
  expect(ok.status).toBe(200);
  expect(ok.body.estimate.pricing.cents.customerTotal).toBe(1799);
  expect(global.fetch).toHaveBeenCalledWith('https://challenges.cloudflare.com/turnstile/v0/siteverify', expect.objectContaining({ method: 'POST' }));
});

describe('shared captcha config for every verifyCaptcha form', () => {
  function buildAuthApp(env) {
    const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    Object.assign(process.env, env);
    let app;
    jest.isolateModules(() => {
      const routes = require('../routes/auth');
      app = express();
      app.use(express.json());
      app.use('/auth', routes);
    });
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    return app;
  }

  test('GET /auth/captcha-config is public, matches the enforcement switch, and hides the secret', async () => {
    const off = await request(buildAuthApp({ CAPTCHA_SECRET: 'top-secret', CAPTCHA_SITE_KEY: 'site-key' })).get('/auth/captcha-config');
    expect(off.status).toBe(200);
    expect(off.body.captcha).toEqual({ enabled: false, provider: 'turnstile', siteKey: null });
    const on = await request(buildAuthApp({ CAPTCHA_ENABLED: 'true', CAPTCHA_SECRET: 'top-secret', CAPTCHA_SITE_KEY: 'site-key' })).get('/auth/captcha-config');
    expect(on.body.captcha).toEqual({ enabled: true, provider: 'turnstile', siteKey: 'site-key' });
    expect(JSON.stringify(on.body)).not.toMatch(/top-secret/);
  });

  test('with CAPTCHA_ENABLED, /auth/check-email needs a token', async () => {
    const app = buildAuthApp({ CAPTCHA_ENABLED: 'true', CAPTCHA_SECRET: 'top-secret', CAPTCHA_SITE_KEY: 'site-key' });
    const res = await request(app).post('/auth/check-email').set('X-Forwarded-For', '198.51.100.7').send({ email: 'a@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('captcha_required');
  });
});
