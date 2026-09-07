'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { fileTypeFromBuffer } = require('file-type');
const ctrl = require('../controllers/businessController');
jest.mock('../utils/storage', () => ({
  ...jest.requireActual('../utils/storage'),
  uploadFile: jest.fn().mockRejectedValue(new Error('storage unavailable')),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000456',
      email: 'owner@example.com',
    };
    next();
  });
  app.get('/api/businesses/categories', ctrl.listBusinessCategories);
  app.get('/api/businesses/media/:assetId', ctrl.getBusinessMediaAsset);
  app.post('/api/businesses', ctrl.addBusiness);
  app.put(
    '/api/businesses/:id/photos',
    upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
    validateFileUpload,
    ctrl.uploadBusinessPhotos
  );
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('business category long-term wiring', () => {
  test('returns backend-owned business category catalog', async () => {
    const res = await request(buildApp()).get('/api/businesses/categories');

    expect(res.status).toBe(200);
    expect(res.body.contract.version).toBe('business-categories-v2');
    expect(res.body.operatingModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'restaurant', category_ids: ['food'] }),
      expect.objectContaining({ id: 'service' }),
    ]));
    expect(res.body.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'food',
        business_mode: 'food',
        subtypes: expect.arrayContaining(['Restaurant']),
      }),
      expect.objectContaining({
        id: 'services',
        business_mode: 'services_marketplace',
      }),
    ]));
  });

  test('creates a linked draft restaurant when business mode is food', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 8,
          user_id: '00000000-0000-4000-8000-000000000456',
          business_name: 'Bon Pate',
          business_type: 'Restaurant',
          industry_category: 'food',
          business_mode: 'food',
          description: null,
          phone: null,
          website: null,
          address_street: null,
          address_city: 'Columbus',
          address_state: 'OH',
          address_zip: null,
          address_country: 'US',
          is_primary: true,
          tax_rate: '25.00',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] });

    const res = await request(buildApp())
      .post('/api/businesses')
      .send({
        business_name: 'Bon Pate',
        business_type: 'Restaurant',
        industry_category: 'food',
        business_mode: 'food',
        address_city: 'Columbus',
        address_state: 'OH',
        address_country: 'US',
      });

    expect(res.status).toBe(201);
    expect(res.body.business).toEqual(expect.objectContaining({
      business_name: 'Bon Pate',
      industry_category: 'food',
      business_mode: 'food',
    }));
    const businessInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO businesses/.test(sql));
    expect(businessInsert[0]).toMatch(/TRUE,FALSE/);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_restaurants/.test(sql))).toBe(true);
    const auditInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO business_audit_log/.test(sql));
    expect(auditInsert).toBeDefined();
    expect(auditInsert[1][0]).toBe(8);
    expect(auditInsert[1][2]).toBe('8');
    expect(auditInsert[1]).toHaveLength(5);
  });

  test('does not create a food restaurant for service marketplace businesses', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 9,
          user_id: '00000000-0000-4000-8000-000000000456',
          business_name: 'FastFix',
          business_type: 'Auto Repair',
          industry_category: 'auto',
          business_mode: 'services_marketplace',
          business_kind: 'service',
          setup_status: 'in_progress',
          address_city: 'Columbus',
          address_state: 'OH',
          address_country: 'US',
          is_primary: false,
        }],
      });

    const res = await request(buildApp())
      .post('/api/businesses')
      .send({
        business_name: 'FastFix',
        business_type: 'Auto Repair',
        industry_category: 'auto',
        business_mode: 'services_marketplace',
        address_city: 'Columbus',
        address_state: 'OH',
        address_country: 'US',
      });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_restaurants/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO business_service_profiles/.test(sql))).toBe(true);
  });

  test('rejects a category that conflicts with the chosen operating model', async () => {
    const res = await request(buildApp())
      .post('/api/businesses')
      .send({
        business_name: 'Wrong Lane',
        business_kind: 'restaurant',
        industry_category: 'services',
        business_type: 'Cleaning',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not valid for restaurant/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('derives the compatibility mode on the server instead of trusting the client', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          business_name: 'Safe Services',
          business_type: 'Cleaning',
          industry_category: 'services',
          business_mode: 'services_marketplace',
          business_kind: 'service',
          address_country: 'US',
          setup_status: 'in_progress',
        }],
      });

    const res = await request(buildApp())
      .post('/api/businesses')
      .send({
        business_name: 'Safe Services',
        business_kind: 'service',
        industry_category: 'services',
        business_type: 'Cleaning',
        business_mode: 'food',
      });

    expect(res.status).toBe(201);
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO businesses/.test(sql));
    expect(insertCall[1][15]).toBe('services_marketplace');
    expect(insertCall[1][16]).toBe('service');
    expect(res.body.business.capabilities).toEqual(expect.objectContaining({
      service: true,
      foodOrders: false,
    }));
  });

  test('returns an existing business when the creation idempotency key is retried', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 11,
        business_name: 'Retry Safe',
        business_kind: 'service',
        business_mode: 'services_marketplace',
        industry_category: 'services',
        setup_status: 'in_progress',
      }],
    });

    const res = await request(buildApp())
      .post('/api/businesses')
      .set('Idempotency-Key', 'stable-key-123')
      .send({
        business_name: 'Retry Safe',
        business_kind: 'service',
        industry_category: 'services',
        business_type: 'Cleaning',
      });

    expect(res.status).toBe(200);
    expect(res.body.reused).toBe(true);
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO businesses/.test(sql))).toHaveLength(0);
  });

  test('stores a short durable media URL when object storage is unavailable', async () => {
    const assetId = 'da527be7-7761-4f3f-8da1-c1d5e2456a52';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+AAAAAElFTkSuQmCC',
      'base64'
    );
    fileTypeFromBuffer.mockResolvedValueOnce({ mime: 'image/png', ext: 'png' });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 15, owner_id: '00000000-0000-4000-8000-000000000456' }] })
      .mockResolvedValueOnce({ rows: [{ id: assetId }] })
      .mockResolvedValueOnce({ rows: [{ id: 15, logo_url: `http://127.0.0.1/api/businesses/media/${assetId}`, cover_photo_url: null }] });

    const res = await request(buildApp())
      .put('/api/businesses/15/photos')
      .attach('logo', png, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.logo_url).toMatch(new RegExp(`/api/businesses/media/${assetId}$`));
    expect(res.body.logo_url.startsWith('data:')).toBe(false);
    const mediaInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO business_media_assets/.test(sql));
    expect(mediaInsert).toBeDefined();
    expect(mediaInsert[1][1]).toBe('15');
    expect(Buffer.isBuffer(mediaInsert[1][4])).toBe(true);
  });

  test('serves persisted business media with immutable content metadata', async () => {
    const assetId = 'da527be7-7761-4f3f-8da1-c1d5e2456a52';
    const content = Buffer.from('stored-image');
    mockQuery.mockResolvedValueOnce({
      rows: [{
        content_type: 'image/webp',
        content,
        size_bytes: content.length,
        sha256: 'abc123',
      }],
    });

    const res = await request(buildApp()).get(`/api/businesses/media/${assetId}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/webp/);
    expect(res.headers.etag).toBe('"abc123"');
    expect(res.body).toEqual(content);
  });
});
