'use strict';

// POST /delivery/public/estimate: the signed-out /delivery page estimate.
// No auth, strict per-IP limit, only stops + size are read, nothing stored,
// and the response omits the pricing breakdown and driver payout.
jest.mock('../db', () => ({ query: jest.fn(() => { throw new Error('public estimate must not touch the database'); }), connect: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../middleware/errorHandler');
const deliveryRoutes = require('../routes/localDelivery');
const pool = require('../db');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/delivery', deliveryRoutes);
  app.use(errorHandler);
  return app;
}

function stop(address, lat, lng, country = 'US') {
  return { address, city: 'Springfield', state: 'OH', country, lat, lng };
}

const ORIGIN = stop('1 W Main St', 39.9242, -83.8088);
const DESTINATION = stop('2 E High St', 39.953, -83.81);

test('prices a route without signing in and returns only display fields', async () => {
  const res = await request(buildApp())
    .post('/delivery/public/estimate')
    .send({ origin: ORIGIN, destination: DESTINATION, packageType: 'small', customerUserId: 'x', originContact: { name: 'A', phone: '555' } });

  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  const { estimate } = res.body;
  expect(estimate.pricing).toEqual({ currency: 'USD', cents: { customerTotal: 1799 } });
  expect(estimate.sizePrices.small.range.minCents).toBe(1799);
  expect(estimate.sizePrices.small.range.maxCents).toBeGreaterThanOrEqual(1799);
  expect(estimate.sizePrices.oversized.range.maxCents).toBeGreaterThan(estimate.sizePrices.oversized.range.minCents);
  expect(Object.keys(estimate.route).sort()).toEqual(['distanceMiles', 'durationMinutes']);
  expect(JSON.stringify(estimate)).not.toMatch(/driverPayout|platformFee|originContact/);
  expect(pool.query).not.toHaveBeenCalled();
});

test.each([
  [{ origin: ORIGIN, destination: DESTINATION, packageType: 'huge' }, 'delivery_shipment_invalid'],
  [{ origin: ORIGIN, destination: DESTINATION }, 'delivery_shipment_invalid'],
  [{ origin: 'nope', destination: DESTINATION, packageType: 'small' }, 'delivery_addresses_required'],
  [{ origin: { ...ORIGIN, lat: 999 }, destination: DESTINATION, packageType: 'small' }, 'delivery_coordinates_invalid'],
  [{ origin: { ...ORIGIN, address: 'x'.repeat(501) }, destination: DESTINATION, packageType: 'small' }, 'delivery_addresses_required'],
  [{ origin: ORIGIN, destination: stop('1 Rue Sainte-Catherine', 45.5017, -73.5673, 'CA'), packageType: 'small' }, 'delivery_domestic_only'],
])('rejects invalid input %#', async (body, code) => {
  const res = await request(buildApp()).post('/delivery/public/estimate').send(body);
  expect(res.status).toBe(400);
  expect(res.body.code).toBe(code);
});

test('limits each IP to 20 estimates per hour', async () => {
  const app = buildApp();
  const send = () => request(app).post('/delivery/public/estimate').set('X-Forwarded-For', '203.0.113.9').send({ packageType: 'huge' });
  // Earlier tests in this file share the same in-memory bucket, so count
  // until the limit trips instead of assuming a fresh bucket.
  let last;
  for (let i = 0; i < 25; i += 1) {
    last = await send();
    if (last.status === 429) break;
  }
  expect(last.status).toBe(429);
  expect(last.body.code).toBe('delivery_estimate_rate_limited');
});
