'use strict';

/**
 * Regression tests for the Oct 7 business privacy audit fixes:
 * - Public content endpoints (services/gallery/policies/faqs/hours) use the
 *   same visibility predicate as the aggregate public profile and 404 for
 *   unlisted/inactive/admin-hidden/setup-incomplete/deleted businesses.
 * - Owners/managers still see their own business content (Business Hub editor).
 * - GET /api/business-profile/:businessId/public 404s for non-visible businesses.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const content = require('../controllers/businessContentController');
const img = require('../controllers/businessProfileImageController');

// Business fixtures: only '1' passes the public visibility predicate.
const VISIBLE = new Set(['1']);
const OWNER_ID = 'owner-uuid-1';
const OWNER_BUSINESSES = { '2': true }; // owner owns the unlisted business 2

function dispatch(text, params) {
  // Ownership check (canEditProfile via canAccessBusiness)
  if (text.includes('SELECT b.id, b.user_id AS owner_id')) {
    const userId = params[1];
    const bizId = String(params[0]);
    const ok = userId === OWNER_ID && OWNER_BUSINESSES[bizId];
    return Promise.resolve({ rows: ok ? [{ id: bizId, owner_id: userId }] : [] });
  }
  // Slug resolution for the image controller's profileUrl
  if (text.includes('SELECT profile_slug FROM businesses WHERE id = $1')) {
    return Promise.resolve({ rows: [] });
  }
  // GET /api/business-profile/:businessId/public (gate is inline in WHERE)
  if (text.includes('cover_image_url') && text.includes('FROM businesses b')) {
    const id = String(params[0]);
    return Promise.resolve({
      rows: VISIBLE.has(id)
        ? [{ id, cover_image_url: null, business_name: 'Biz', description: 'd', profile_photo_url: null }]
        : [],
    });
  }
  // Shared public visibility gate
  if (text.includes("b.business_kind = 'service'")) {
    const id = String(params[0]);
    return Promise.resolve({ rows: VISIBLE.has(id) ? [{ '?column?': 1 }] : [] });
  }
  if (text.includes('FROM business_gallery')) {
    return Promise.resolve({ rows: [{ id: 7, url: 'https://x/y.jpg', caption: 'c', alt: 'a' }] });
  }
  if (text.includes('FROM business_services')) {
    return Promise.resolve({ rows: [{ id: 8, name: 'Mowing' }] });
  }
  if (text.includes('FROM business_policies')) {
    return Promise.resolve({ rows: [{ id: 9, title: 'Policy' }] });
  }
  if (text.includes('FROM business_faqs')) {
    return Promise.resolve({ rows: [{ id: 10, question: 'Q?' }] });
  }
  if (text.includes('FROM business_hours')) {
    return Promise.resolve({ rows: [{ id: 11, day_of_week: 1 }] });
  }
  return Promise.resolve({ rows: [] });
}

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.get('/api/businesses/:businessId/gallery', content.getBusinessGallery);
  app.get('/api/businesses/:businessId/services', content.getBusinessServices);
  app.get('/api/businesses/:businessId/policies', content.getBusinessPolicies);
  app.get('/api/businesses/:businessId/faqs', content.getBusinessFAQs);
  app.get('/api/businesses/:businessId/hours', content.getBusinessHours);
  app.get('/api/business-profile/:businessId/public', img.getBusinessProfileWithCover);
  return app;
}

const guestApp = () => buildApp(null);
const ownerApp = () => buildApp({ id: OWNER_ID });

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(dispatch);
});

describe('public business content visibility gates', () => {
  test('gallery: logged-out viewer of unlisted business gets 404', async () => {
    const res = await request(guestApp()).get('/api/businesses/2/gallery');
    expect(res.status).toBe(404);
  });

  test('gallery: logged-out viewer of visible business gets 200 with rows', async () => {
    const res = await request(guestApp()).get('/api/businesses/1/gallery');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('gallery: owner still sees their own unlisted business content', async () => {
    const res = await request(ownerApp()).get('/api/businesses/2/gallery');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('services: logged-out viewer of inactive business gets 404', async () => {
    const res = await request(guestApp()).get('/api/businesses/3/services');
    expect(res.status).toBe(404);
  });

  test('services: logged-out viewer of visible business gets 200', async () => {
    const res = await request(guestApp()).get('/api/businesses/1/services');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('policies: logged-out viewer of admin-hidden business gets 404', async () => {
    const res = await request(guestApp()).get('/api/businesses/4/policies');
    expect(res.status).toBe(404);
  });

  test('faqs: logged-out viewer of deleted business gets 404', async () => {
    const res = await request(guestApp()).get('/api/businesses/6/faqs');
    expect(res.status).toBe(404);
  });

  test('hours: logged-out viewer of setup-incomplete business gets 404', async () => {
    const res = await request(guestApp()).get('/api/businesses/5/hours');
    expect(res.status).toBe(404);
  });

  test('hours: owner of non-visible business still gets 200', async () => {
    const res = await request(ownerApp()).get('/api/businesses/2/hours');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('business profile with cover visibility gate', () => {
  test('unlisted business 404s', async () => {
    const res = await request(guestApp()).get('/api/business-profile/2/public');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Business not found');
  });

  test('visible business returns profile with canonical profileUrl', async () => {
    const res = await request(guestApp()).get('/api/business-profile/1/public');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profileUrl).toContain('/businesses/public/1');
  });
});
