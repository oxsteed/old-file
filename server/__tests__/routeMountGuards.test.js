'use strict';

const express = require('express');
const request = require('supertest');
const { resetMocks } = require('./setup');

const statementInvestigationRoutes = require('../routes/statementInvestigation');
const restaurantSupportRoutes = require('../routes/restaurantSupport');
const restaurantRoutes = require('../routes/restaurants');

describe('route mount guard boundaries', () => {
  beforeEach(() => {
    resetMocks();
  });

  test('statement customer guard does not intercept later /api routes', async () => {
    const app = express();
    app.use('/api', statementInvestigationRoutes);
    app.get('/api/admin/restaurant-topups/applications', (_req, res) => {
      res.status(200).json({ reached: true });
    });

    const response = await request(app).get('/api/admin/restaurant-topups/applications');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reached: true });
  });

  test('statement routes remain customer-authenticated', async () => {
    const app = express();
    app.use('/api', statementInvestigationRoutes);

    const response = await request(app).get('/api/statements/not-a-document/entries');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('No token provided');
  });

  test('restaurant support auth does not intercept public restaurant routes', async () => {
    const app = express();
    app.use('/api/restaurants', restaurantSupportRoutes);
    app.use('/api/restaurants', restaurantRoutes);
    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || 500).json({ code: err.code || 'internal_error' });
    });

    const response = await request(app).get('/api/restaurants/999999/display/menu');

    // The public restaurant handler is reached and reports its own not-found
    // result. A 401 here would mean the support router still leaked globally.
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('restaurant_not_found');
  });

  test('restaurant support routes remain authenticated', async () => {
    const app = express();
    app.use('/api/restaurants', restaurantSupportRoutes);

    const response = await request(app).post('/api/restaurants/support/cases').send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('No token provided');
  });
});
