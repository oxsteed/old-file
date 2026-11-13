'use strict';

// POST /delivery/quote: an overweight package must be a 400 with the
// delivery_weight_exceeds_package_limit code, not a 500. The pricing code
// used to throw a plain Error carrying .status = 400, which the error
// handler ignores for non-AppError errors, so the quote path returned 500.
const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../db', () => ({ query: jest.fn() }));
const pool = require('../db');
const localDelivery = require('../controllers/localDeliveryController');

const USER_ID = '00000000-0000-4000-8000-000000000123';

function buildApp(user = { id: USER_ID }) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.post('/delivery/quote', express.json(), localDelivery.quote);
  app.use(errorHandler);
  return app;
}

function stop(address, lat, lng) {
  return { address, city: 'Springfield', state: 'OH', country: 'US', lat, lng };
}

function payload(overrides = {}) {
  const now = Date.now();
  const iso = (ms) => new Date(now + ms).toISOString();
  return {
    origin: stop('1 W Main St', 39.9242, -83.8088),
    destination: stop('2 E High St', 39.953, -83.81),
    packageType: 'small',
    weightLbs: 5,
    serviceLevel: 'standard',
    pieces: 1,
    dimensions: { lengthIn: 10, widthIn: 8, heightIn: 6 },
    contentsCategory: 'general',
    declaredValueCents: 5000,
    fragile: false,
    perishable: false,
    handlingRequirements: {},
    originContact: { name: 'Ana', phone: '+19375550101', instructions: '' },
    destinationContact: { name: 'Ben', phone: '+19375550102', instructions: '' },
    pickupWindow: { start: iso(3600000), end: iso(7200000) },
    deliveryWindow: { start: iso(10800000), end: iso(14400000) },
    proofPreference: 'recipient_confirmation',
    ...overrides,
  };
}

beforeEach(() => {
  pool.query.mockResolvedValue({
    rows: [{ id: 99, expires_at: new Date(Date.now() + 15 * 60000).toISOString() }],
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('returns 400 for a weight above the size cap', async () => {
  const res = await request(buildApp())
    .post('/delivery/quote')
    .send(payload({ weightLbs: 30 }));

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('delivery_weight_exceeds_package_limit');
});

test('prices a valid short standard small delivery', async () => {
  const res = await request(buildApp())
    .post('/delivery/quote')
    .send(payload());

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.quote.id).toBe(99);
  expect(res.body.quote.pricing.cents.customerTotal).toBe(1799);
});
