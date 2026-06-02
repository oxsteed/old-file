'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'owner-1', role: 'customer' };
    next();
  },
}));

jest.mock('../middleware/upload', () => ({
  single: () => (_req, _res, next) => next(),
}));

jest.mock('../middleware/validateFileUpload', () => (_req, _res, next) => next());

const toolRentalRoutes = require('../routes/toolRentals');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tool-rentals', toolRentalRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, fields: err.fields }));
  return app;
}

beforeEach(() => resetMocks());

describe('tool rental listing routes', () => {
  test('POST /api/tool-rentals requires owner attestation', async () => {
    const res = await request(buildApp())
      .post('/api/tool-rentals')
      .send({
        name: 'Cordless drill',
        category: 'Power Tools',
        daily_rate: 18,
        location_city: 'Austin',
      });

    expect(res.status).toBe(400);
    expect(res.body.fields.owner_attestation_accepted).toMatch(/Confirm/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('PUT /api/tool-rentals/:id can toggle availability without wiping prices', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'tool-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'tool-1',
          user_id: 'owner-1',
          name: 'Cordless drill',
          daily_rate: 18,
          deposit_amount: 40,
          is_available: false,
        }],
      });

    const res = await request(buildApp())
      .put('/api/tool-rentals/tool-1')
      .send({ is_available: false });

    expect(res.status).toBe(200);
    const updateCall = mockQuery.mock.calls.find(([sql, params]) => /UPDATE tool_rentals SET/i.test(sql) && Array.isArray(params));
    expect(updateCall).toBeTruthy();
    const updateSql = updateCall[0];
    const updateParams = updateCall[1];
    expect(updateSql).toMatch(/daily_rate\s+= COALESCE\(\$4, daily_rate\)/);
    expect(updateSql).toMatch(/deposit_amount\s+= COALESCE\(\$6, deposit_amount\)/);
    expect(updateParams[3]).toBeNull();
    expect(updateParams[5]).toBeNull();
    expect(updateParams[9]).toBe(false);
  });
});
