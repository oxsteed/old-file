'use strict';

/**
 * R3 regression: the public business content GETs (services, gallery,
 * policies, faqs, hours) must run optionalAuth before the controller.
 * Without it req.user is never populated, so the owner/manager branch of the
 * content visibility gate cannot match and the Business Hub editor gets 404
 * for its own draft/unlisted content. The controller-level test
 * (businessContentVisibility.test.js) injects req.user directly, which hid
 * the missing middleware; this test checks the real router wiring and the
 * end-to-end owner flow through a real JWT.
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { mockQuery, resetMocks } = require('./setup');

const router = require('../routes/businesses');
const { optionalAuth } = require('../middleware/auth');

const CONTENT_ROUTES = ['services', 'gallery', 'policies', 'faqs', 'hours'];

function layerFor(path) {
  return router.stack.find((layer) => layer.route
    && layer.route.path === `/:businessId/${path}`
    && layer.route.methods.get);
}

describe('business content GET routes use optionalAuth', () => {
  test.each(CONTENT_ROUTES)('/:businessId/%s', (path) => {
    const layer = layerFor(path);
    expect(layer).toBeDefined();
    const handles = layer.route.stack.map((s) => s.handle);
    expect(handles[0]).toBe(optionalAuth);
    expect(handles.length).toBeGreaterThanOrEqual(2);
  });
});

describe('owner sees own unlisted business content through the real router', () => {
  const OWNER_ID = '11111111-1111-4111-8111-111111111111';
  const STRANGER_ID = '22222222-2222-4222-8222-222222222222';
  const BIZ_ID = '7';
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/businesses', router);
  });

  beforeEach(() => {
    resetMocks();
    mockQuery.mockImplementation((text, params = []) => {
      const sql = String(text);
      // optionalAuth user lookup
      if (sql.includes('FROM users u') && sql.includes('WHERE u.id = $1')) {
        const id = params[0];
        if (id === OWNER_ID || id === STRANGER_ID) {
          return Promise.resolve({ rows: [{ id, role: 'customer', is_active: true, email_verified: true, didit_status: 'verified' }] });
        }
        return Promise.resolve({ rows: [] });
      }
      // canAccessBusiness ownership check
      if (sql.includes('SELECT b.id, b.user_id AS owner_id')) {
        const ok = String(params[0]) === BIZ_ID && params[1] === OWNER_ID;
        return Promise.resolve({ rows: ok ? [{ id: BIZ_ID, owner_id: OWNER_ID }] : [] });
      }
      // Public visibility predicate: the business is unlisted.
      if (sql.includes('AND b.is_listed = TRUE')) return Promise.resolve({ rows: [] });
      // Content queries
      return Promise.resolve({ rows: [] });
    });
  });

  function bearer(id) {
    return `Bearer ${jwt.sign({ id, role: 'customer' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' })}`;
  }

  test.each(['gallery', 'policies', 'faqs', 'hours'])('owner GET /%s -> 200', async (path) => {
    const res = await request(app).get(`/api/businesses/${BIZ_ID}/${path}`).set('Authorization', bearer(OWNER_ID));
    expect(res.status).toBe(200);
  });

  test.each(['gallery', 'policies', 'faqs', 'hours'])('anonymous GET /%s on unlisted business -> 404', async (path) => {
    const res = await request(app).get(`/api/businesses/${BIZ_ID}/${path}`);
    expect(res.status).toBe(404);
  });

  test.each(['gallery', 'policies', 'faqs', 'hours'])('non-owner GET /%s on unlisted business -> 404', async (path) => {
    const res = await request(app).get(`/api/businesses/${BIZ_ID}/${path}`).set('Authorization', bearer(STRANGER_ID));
    expect(res.status).toBe(404);
  });
});
