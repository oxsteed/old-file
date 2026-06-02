'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const growthController = require('../controllers/growthController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123', role: 'helper' };
    next();
  });

  app.get('/api/growth/programs', growthController.getPrograms);
  app.get('/api/growth/wholesale', growthController.getWholesale);
  app.post('/api/growth/wholesale/:id/join', growthController.joinWholesale);
  app.post('/api/growth/financing/pre-qual', growthController.submitFinancingPreQual);
  app.get('/api/growth/grants', growthController.getGrants);

  return app;
}

beforeEach(() => resetMocks());

describe('growth api', () => {
  test('GET /growth/programs filters by persona and returns iOS program fields', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 7,
        title: 'Business Launch Program',
        subtitle: 'Launch support',
        icon_name: 'briefcase.fill',
        color_key: 'money',
        cta_label: 'Start',
        cta_url: null,
        cta_type: 'consulting_intake',
        persona_filter: ['helper'],
        sort_order: 1,
      }],
      rowCount: 1,
    });

    const res = await request(buildApp()).get('/api/growth/programs?persona=helper');

    expect(res.status).toBe(200);
    expect(res.body.programs[0].cta_type).toBe('consulting_intake');
    expect(mockQuery.mock.calls[0][1]).toEqual(['helper']);
  });

  test('GET /growth/wholesale returns active listings within the requested limit', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 3,
        title: 'Paint supplies pool',
        subtitle: 'Bulk discount',
        icon_name: 'paintbrush.fill',
        save_percent: 18,
        joined_count: 4,
        category: 'painting',
        external_url: 'https://oxsteed.com/wholesale/3',
        sort_order: 1,
      }],
      rowCount: 1,
    });

    const res = await request(buildApp()).get('/api/growth/wholesale?limit=5');

    expect(res.status).toBe(200);
    expect(res.body.listings[0].id).toBe(3);
    expect(mockQuery.mock.calls[0][1]).toEqual([5]);
  });

  test('POST /growth/wholesale/:id/join creates a join only for an active listing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 3, joined_count: 5 }], rowCount: 1 });

    const res = await request(buildApp()).post('/api/growth/wholesale/3/join');

    expect(res.status).toBe(200);
    expect(res.body.listing.joined_count).toBe(5);
    expect(mockQuery.mock.calls[0][0]).toContain('SELECT id FROM wholesale_listings');
    expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO wholesale_joins');
  });

  test('POST /growth/wholesale/:id/join returns 404 before inserting when listing is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(buildApp()).post('/api/growth/wholesale/999/join');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Listing not found');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('POST /growth/financing/pre-qual stores a valid iOS financing lead', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 11, status: 'submitted', created_at: '2026-06-02T12:00:00.000Z' }],
      rowCount: 1,
    });

    const res = await request(buildApp())
      .post('/api/growth/financing/pre-qual')
      .send({
        loan_type: 'equipment',
        amount_needed: 15000,
        months_in_business: 24,
        annual_revenue: 80000,
        credit_score_band: '650-699',
        business_type: 'llc',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(mockQuery.mock.calls[0][0]).toContain('growth_financing_prequalifications');
    expect(mockQuery.mock.calls[0][1][0]).toBe('user-123');
  });

  test('POST /growth/financing/pre-qual rejects invalid financing payloads before storage', async () => {
    const res = await request(buildApp())
      .post('/api/growth/financing/pre-qual')
      .send({
        loan_type: 'personal',
        amount_needed: -25,
        credit_score_band: '650-699',
        business_type: 'llc',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid loan type');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('GET /growth/grants returns string ids for the iOS grants model', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: '4',
        name: 'Tool Training Grant',
        sponsor: 'State Workforce Office',
        amount: 'Up to $5,000',
        eligibility: 'Skilled trade workers',
        deadline: null,
        apply_url: 'https://example.com/apply',
        category: 'state',
      }],
      rowCount: 1,
    });

    const res = await request(buildApp()).get('/api/growth/grants?persona=helper');

    expect(res.status).toBe(200);
    expect(typeof res.body.grants[0].id).toBe('string');
    expect(mockQuery.mock.calls[0][0]).toContain('id::text AS id');
    expect(mockQuery.mock.calls[0][1]).toEqual(['helper']);
  });
});
