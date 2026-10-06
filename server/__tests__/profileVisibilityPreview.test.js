'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/helperAvailabilityService', () => ({
  getTemplate: jest.fn().mockResolvedValue({ byDay: {} }), formatTime: value => value,
}));
const visibility = require('../controllers/profileVisibilityController');
const helpers = require('../controllers/helpersController');
const business = require('../controllers/businessController');
const food = require('../controllers/foodController');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { errorHandler } = require('../middleware/errorHandler');
const jwt = require('jsonwebtoken');
const signToken = payload => jwt.sign(payload, process.env.JWT_SECRET);
const ID = '00000000-0000-4000-8000-000000000123';

function response() {
  return { statusCode: 200, headers: {}, payload: null,
    status(code) { this.statusCode = code; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async sql => {
    if (/FROM users u\s+JOIN helper_profiles hp/.test(sql)) {
      return { rows: /hp.is_hidden_by_admin/.test(sql) ? [] : [{
        id: ID, first_name: 'Hidden', last_name: 'Helper', member_since: '2020-01-01',
        bio_long: 'Helper preview content', private_secret: 'NEVER_EXPOSE',
      }] };
    }
    if (/FROM businesses b\s+JOIN users u/.test(sql)) {
      return { rows: /b.is_hidden_by_admin/.test(sql) ? [] : [{
        id: 17, business_name: 'Hidden business', description: 'Business preview content',
        owner_id: ID, business_kind: 'service', private_secret: 'NEVER_EXPOSE',
      }] };
    }
    if (/SELECT fr\.\*/.test(sql)) {
      return { rows: /fr.is_hidden_by_admin/.test(sql) ? [] : [{
        id: 29, business_id: 17, display_name: 'Hidden restaurant',
        description: 'Restaurant preview content', operating_hours: {}, timezone: 'UTC',
        settings: { privateProcessorSecret: 'NEVER_EXPOSE' },
      }] };
    }
    if (/FROM food_menu_categories/.test(sql)) return { rows: [{ id: 1, name: 'Lunch' }] };
    if (/FROM food_menu_items/.test(sql)) return { rows: [{ id: 5, category_id: 1, name: 'Soup', price_cents: 1200 }] };
    return { rows: [] };
  });
});

test.each([
  ['helper', ID, helpers.getHelperProfile],
  ['business', '17', business.getBusinessPublicProfile],
  ['restaurant', '29', food.getRestaurant],
])('hidden %s remains unavailable publicly even with spoofed preview flags', async (type, id, handler) => {
  const res = response(); const next = jest.fn();
  await handler({ params: { id }, query: { adminPreview: true }, body: { adminPreview: true }, user: { role: 'super_admin' } }, res, next, true);
  expect(res.statusCode === 404 || next.mock.calls[0]?.[0]?.statusCode === 404).toBe(true);
  expect(JSON.stringify(res.payload)).not.toContain('preview content');
});

test.each([['helper', ID, 'helper'], ['business', '17', 'business'], ['restaurant', '29', 'restaurant']])(
  'private %s preview returns real content and audits access without changing visibility', async (type, id, key) => {
    const res = response(); const next = jest.fn();
    await visibility.getProfilePreviewContent({ params: { type, id }, user: { id: ID }, headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.payload[key]).toBeDefined();
    expect(JSON.stringify(res.payload)).toContain('preview content');
    expect(JSON.stringify(res.payload)).not.toContain('NEVER_EXPOSE');
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO admin_audit_log/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE|DELETE FROM/.test(sql))).toBe(false);
    const profileSql = mockQuery.mock.calls.find(([sql]) => type === 'helper'
      ? /FROM users u\s+JOIN helper_profiles hp/.test(sql)
      : type === 'business' ? /FROM businesses b\s+JOIN users u/.test(sql) : /SELECT fr\.\*/.test(sql))[0];
    expect(profileSql).toContain(type === 'helper' ? 'u.deleted_at IS NULL' : 'b.deleted_at IS NULL');
    if (type === 'restaurant') expect(res.payload.menu[0].items[0].name).toBe('Soup');
  }
);

test('invalid references fail before querying or auditing', async () => {
  for (const [type, id] of [['alien', '1'], ['helper', 'bad'], ['business', '1 OR 1=1'], ['restaurant', '9007199254740992']]) {
    const res = response();
    await visibility.getProfilePreviewContent({ params: { type, id } }, res, jest.fn());
    expect(res.statusCode).toBe(400);
  }
  expect(mockQuery).not.toHaveBeenCalled();
});

test('audit failure prevents preview disclosure', async () => {
  mockQuery.mockRejectedValueOnce(new Error('Audit unavailable'));
  const res = response(); const next = jest.fn();
  await visibility.getProfilePreviewContent({ params: { type: 'business', id: '17' }, user: { id: ID } }, res, next);
  expect(res.payload).toBeNull();
  expect(next.mock.calls[0][0].message).toBe('Audit unavailable');
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test.each([['helper', ID], ['business', '17'], ['restaurant', '29']])('missing %s content reports 404 rather than an empty successful preview', async (type, id) => {
  mockQuery.mockResolvedValue({ rows: [] });
  const res = response(); const next = jest.fn();
  await visibility.getProfilePreviewContent({ params: { type, id }, user: { id: ID } }, res, next);
  expect(res.statusCode === 404 || next.mock.calls[0]?.[0]?.statusCode === 404).toBe(true);
});

test('route requires both administrator authentication and visibility permission', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
  expect(source).toContain("router.get('/profile-visibility/:type/:id/preview-content', requireAdmin, requirePermission('manage_profile_visibility'), profileVisCtrl.getProfilePreviewContent)");
  const app = express();
  app.get('/:type/:id/preview-content', requireAdmin, requirePermission('manage_profile_visibility'), visibility.getProfilePreviewContent);
  app.use(errorHandler);
  await request(app).get('/business/17/preview-content').expect(401);
  mockQuery.mockImplementation(async sql => ({ rows: /FROM users WHERE/.test(sql)
    ? [{ id: ID, role: 'customer', is_active: true, totp_enabled: true }] : [] }));
  await request(app).get('/business/17/preview-content').set('Authorization', `Bearer ${signToken({ id: ID })}`).expect(403);
  mockQuery.mockImplementation(async sql => ({ rows: /FROM users WHERE/.test(sql)
    ? [{ id: ID, role: 'admin', is_active: true, totp_enabled: true }] : [] }));
  await request(app).get('/business/17/preview-content').set('Authorization', `Bearer ${signToken({ id: ID })}`).expect(403);
});
