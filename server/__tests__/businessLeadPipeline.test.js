'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/businessLeadPipelineController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/businesses/:businessId/leads/:leadId', ctrl.getLead);
  app.put('/api/businesses/:businessId/leads/:leadId', ctrl.updateLead);
  app.delete('/api/businesses/:businessId/leads/:leadId', ctrl.deleteLead);
  app.post('/api/businesses/:businessId/leads/:leadId/quotes', ctrl.createLeadQuote);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

beforeEach(() => resetMocks());

describe('business lead pipeline route params', () => {
  test('GET /businesses/:businessId/leads/:leadId queries with leadId', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'lead-9', business_id: 'biz-1', name: 'Client' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/businesses/biz-1/leads/lead-9');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['lead-9', 'biz-1']);
  });

  test('PUT /businesses/:businessId/leads/:leadId updates with leadId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'lead-9', business_id: 'biz-1', name: 'Updated' }] });

    const res = await request(buildApp())
      .put('/api/businesses/biz-1/leads/lead-9')
      .send({ name: 'Updated', email: 'u@example.com', status: 'qualified' });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1].slice(-2)).toEqual(['lead-9', 'biz-1']);
  });

  test('DELETE /businesses/:businessId/leads/:leadId deletes with leadId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).delete('/api/businesses/biz-1/leads/lead-9');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['lead-9', 'biz-1']);
  });

  test('POST /businesses/:businessId/leads/:leadId/quotes inserts quote with leadId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'quote-1', lead_id: 'lead-9' }] });

    const res = await request(buildApp())
      .post('/api/businesses/biz-1/leads/lead-9/quotes')
      .send({ description: 'Follow-up quote', amount_cents: 25000 });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[0][1][0]).toBe('lead-9');
  });
});
