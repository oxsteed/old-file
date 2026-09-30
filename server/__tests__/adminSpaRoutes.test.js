'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const prerenderPublicPages = require('../middleware/prerenderHelperProfile');
const canonicalHostRedirect = require('../middleware/canonicalHost');
const { createSpaFallback } = require('../middleware/spaFallback');
const { ADMIN_SPA_ROUTES } = require('../utils/adminSpaRoutes');

const clientDist = path.join(__dirname, '../../client/dist');
const adminHtml = fs.readFileSync(path.join(clientDist, 'admin.html'), 'utf8');
const mainHtml = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, '../../client/src/admin/adminRouteManifest.js'), 'utf8');
const clientPaths = [...manifest.matchAll(/defineRoute\('([^']+)'/g)]
  .map(([, route]) => route).filter((route) => route === '/admin' || route.startsWith('/admin/'));
const samplePath = (route) => route.replace(/:[^/]+/g, (parameter) => (
  /user|job|dispute/i.test(parameter) ? '123e4567-e89b-12d3-a456-426614174000' : '42'
));

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(canonicalHostRedirect);
  app.use('/api/quote-requests', require('../routes/quoteRequests'));
  app.use(prerenderPublicPages);
  // Static files precede document fallback, as in server/index.js.
  app.use(express.static(clientDist));
  app.use(createSpaFallback(clientDist));
  app.use((err, req, res, next) => {
    res.status(err.status || 500).type('text/plain').send('File unavailable');
  });
  return app;
}

describe('production admin direct-load contract', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let app;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    resetMocks();
    app = buildApp();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('server document manifest covers every client admin route without duplicates', () => {
    expect(clientPaths.length).toBeGreaterThanOrEqual(61);
    expect(new Set(clientPaths).size).toBe(clientPaths.length);
    expect(new Set(ADMIN_SPA_ROUTES).size).toBe(ADMIN_SPA_ROUTES.length);
    expect([...ADMIN_SPA_ROUTES].sort()).toEqual([...clientPaths].sort());
    expect(ADMIN_SPA_ROUTES).toContain('/admin/quote-requests');
    expect(ADMIN_SPA_ROUTES).not.toContain('/direct/admin');
  });

  test('production uses the tested fallback after static serving', () => {
    const entry = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(entry).toContain("require('./middleware/spaFallback')");
    expect(entry).toContain('app.use(createSpaFallback(clientDist))');
    expect(entry.indexOf('app.use(express.static(clientDist')).toBeLessThan(
      entry.indexOf('app.use(createSpaFallback(clientDist))'),
    );
    expect(entry).not.toMatch(/app\.get\('\*'/);
  });

  test.each(clientPaths)('%s serves the admin shell on GET and HEAD', async (route) => {
    const pathname = samplePath(route);
    const get = await request(app).get(pathname).set('Accept', 'text/html');
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toMatch(/^text\/html/);
    expect(get.headers['cache-control']).toBe('no-store');
    expect(get.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(get.text).toBe(adminHtml);
    expect(get.text).not.toBe(mainHtml);

    const head = await request(app).head(pathname).set('Accept', 'text/html');
    expect(head.status).toBe(200);
    expect(head.headers['content-type']).toMatch(/^text\/html/);
    expect(head.headers['cache-control']).toBe('no-store');
    expect(head.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(head.text).toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test.each(clientPaths)('%s has a canonical trailing-slash redirect', async (route) => {
    const pathname = samplePath(route);
    const query = '?lang=fr&ticket=a%2Fb&next=https%3A%2F%2Fevil.example';
    const res = await request(app).get(pathname + '/' + query).set('Host', 'evil.example');
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe(pathname + query);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    const canonical = await request(app).get(res.headers.location);
    expect(canonical.status).toBe(200);
    expect(canonical.text).toBe(adminHtml);
  });

  test('quote requests preserves query navigation and the existing canonical host redirect', async () => {
    const query = '?lang=es&status=open&page=2';
    const alias = await request(app).get('/admin/quote-requests' + query).set('Host', 'www.oxsteed.com');
    expect(alias.status).toBe(301);
    expect(alias.headers.location).toBe('https://oxsteed.com/admin/quote-requests' + query);
    const res = await request(app).get('/admin/quote-requests' + query).set('Host', 'oxsteed.com');
    expect(res.status).toBe(200);
    expect(res.text).toBe(adminHtml);
  });

  test('HEAD uses the same canonical redirect without a response body', async () => {
    const res = await request(app).head('/admin/dashboard/?lang=es');
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe('/admin/dashboard?lang=es');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.text).toBeUndefined();
  });

  test('admin direct loads do not depend on the public prerender template', async () => {
    const originalRead = fs.readFileSync;
    const read = jest.spyOn(fs, 'readFileSync').mockImplementation((filename, ...args) => {
      if (filename === path.join(clientDist, 'index.html')) throw new Error('Public template unavailable');
      return originalRead(filename, ...args);
    });
    try {
      const res = await request(app).get('/admin/quote-requests');
      expect(res.status).toBe(200);
      expect(res.text).toBe(adminHtml);
      expect(read.mock.calls.some(([filename]) => filename === path.join(clientDist, 'index.html'))).toBe(false);
    } finally {
      read.mockRestore();
    }
  });

  test.each([
    '/admin/not-a-route', '/admin/quote-requests/unknown', '/admin/quote-requests.json',
    '/admin/assets/missing.js', '/admin/users/missing.js', '/admin/users/42/unknown',
    '/admin/api/missing', '/admin/support/tickets', '/ADMIN/quote-requests',
    '/admin//quote-requests', '/admin/users/%2Fapi', '/admin/users/%5Cfile',
    '/admin/users/%252Fapi', '/%61dmin/quote-requests',
    '//api/missing',
  ])('rejects unknown, file, and encoded paths: %s', async (pathname) => {
    const res = await request(app).get(pathname).set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).toBe('Not found');
  });

  test('raw encoded traversal is rejected before redirect or shell selection', async () => {
    // Superagent normalizes encoded dot segments before sending. Use the Node
    // HTTP path option so this test reaches Express with the original bytes.
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1', port: server.address().port,
          method: 'GET', path: '/admin/users/%2e%2e',
        }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => { body += chunk; });
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
        });
        req.on('error', reject);
        req.end();
      });
      expect(res.status).toBe(404);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      expect(res.body).toBe('Not found');
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  test.each([
    '/api', '/api/does-not-exist', '/api/admin/does-not-exist', '/API/missing',
    '/assets/missing.js', '/assets/missing', '/missing.js', '/missing.css', '/missing.png',
    '/icons/missing', '/uploads/missing', '/qr-codes/missing', '/socket.io/missing',
    '/.well-known/missing', '/direct/service-area-assets/missing',
  ])('missing API or file never returns an HTML shell: %s', async (pathname) => {
    const res = await request(app).get(pathname).set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).not.toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).not.toContain('<div id="root">');
  });

  test('existing quote-request API authentication still terminates before fallback', async () => {
    const res = await request(app).get('/api/quote-requests/admin/list').set('Accept', 'text/html');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test.each(['post', 'put', 'patch', 'delete', 'options'])('%s never serves admin HTML', async (method) => {
    const res = await request(app)[method]('/admin/quote-requests');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
  });

  test('a JSON-only request never becomes an admin document', async () => {
    const res = await request(app).get('/admin/quote-requests').set('Accept', 'application/json');
    expect(res.status).toBe(404);
    expect(res.text).toBe('Not found');
  });

  test('static chunks still serve their bytes before fallback', async () => {
    const filename = fs.readdirSync(path.join(clientDist, 'assets')).find((name) => name.endsWith('.js'));
    expect(filename).toBeDefined();
    const res = await request(app).get('/assets/' + filename);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toBe(fs.readFileSync(path.join(clientDist, 'assets', filename), 'utf8'));
  });

  test('main application routes still use the main shell', async () => {
    const res = await request(app).get('/direct/admin');
    expect(res.status).toBe(200);
    expect(res.text).toBe(mainHtml);
    expect(res.text).not.toBe(adminHtml);
  });

  test('public prerendering stays ahead of the main shell', async () => {
    const res = await request(app).get('/direct/services?lang=es');
    expect(res.status).toBe(200);
    expect(res.headers['content-language']).toBe('es');
    expect(res.text).toContain('Explora OxSteed');
    expect(res.text).not.toBe(adminHtml);
  });
});
