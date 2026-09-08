'use strict';

const express = require('express');
const request = require('supertest');
const canonicalHostRedirect = require('../middleware/canonicalHost');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(canonicalHostRedirect);
  app.get('*', (req, res) => res.send('ok'));
  return app;
}

describe('canonical public host', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('redirects www to the canonical HTTPS origin and preserves the path', async () => {
    const res = await request(buildApp())
      .get('/direct?lang=es')
      .set('Host', 'www.oxsteed.com');

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://oxsteed.com/direct?lang=es');
  });

  test('redirects insecure requests when the proxy reports HTTP', async () => {
    const res = await request(buildApp())
      .get('/about?lang=fr')
      .set('Host', 'oxsteed.com')
      .set('X-Forwarded-Proto', 'http');

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://oxsteed.com/about?lang=fr');
  });

  test('leaves the canonical HTTPS origin alone', async () => {
    const res = await request(buildApp())
      .get('/helpers')
      .set('Host', 'oxsteed.com')
      .set('X-Forwarded-Proto', 'https');

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  test('recognizes HTTPS terminated by the Cloudflare tunnel', async () => {
    const res = await request(buildApp())
      .get('/')
      .set('Host', 'oxsteed.com')
      .set('CF-Ray', 'example-ray')
      .set('CF-Visitor', '{"scheme":"https"}');

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });
});
