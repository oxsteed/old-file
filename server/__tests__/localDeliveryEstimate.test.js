'use strict';

// POST /delivery/estimate: instant route price from the two stops and the size
// only. It must not require the full intake payload (contacts, windows,
// declared value) that POST /delivery/quote requires, and it must not write
// a quote row.
const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../middleware/errorHandler');
const localDelivery = require('../controllers/localDeliveryController');

const USER_ID = '00000000-0000-4000-8000-000000000123';

function buildApp(user = { id: USER_ID }) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.post('/delivery/estimate', express.json(), localDelivery.estimate);
  app.use(errorHandler);
  return app;
}

function stop(address, lat, lng, country = 'US') {
  return { address, city: 'Springfield', state: 'OH', country, lat, lng };
}

const ORIGIN = stop('1 W Main St', 39.9242, -83.8088);
const DESTINATION = stop('2 E High St', 39.953, -83.81);

test('prices a short standard small delivery at the minimum fare', async () => {
  const res = await request(buildApp())
    .post('/delivery/estimate')
    .send({ origin: ORIGIN, destination: DESTINATION, packageType: 'small', weightLbs: 5, serviceLevel: 'standard' });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.estimate.pricing.cents.customerTotal).toBe(1799);
  expect(res.body.estimate.route.durationMinutes).toBeGreaterThanOrEqual(1);
  expect(res.body.estimate.packageLimitLbs).toBe(25);
  expect(res.body.estimate.id).toBeUndefined();
});

test('rejects an estimate without complete stop coordinates', async () => {
  const res = await request(buildApp())
    .post('/delivery/estimate')
    .send({ origin: { ...ORIGIN, lat: null }, destination: DESTINATION, packageType: 'small', weightLbs: 5, serviceLevel: 'standard' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('delivery_addresses_required');
});

test('rejects a weight above the size cap', async () => {
  const res = await request(buildApp())
    .post('/delivery/estimate')
    .send({ origin: ORIGIN, destination: DESTINATION, packageType: 'small', weightLbs: 30, serviceLevel: 'standard' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('delivery_weight_exceeds_package_limit');
});

test('rejects a route outside the local service area', async () => {
  const res = await request(buildApp())
    .post('/delivery/estimate')
    .send({
      origin: ORIGIN,
      destination: stop('1 Hollywood Blvd', 34.0928, -118.3287),
      packageType: 'small',
      weightLbs: 5,
      serviceLevel: 'standard',
    });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('delivery_service_area_unsupported');
});

test('rejects a non-US stop', async () => {
  const res = await request(buildApp())
    .post('/delivery/estimate')
    .send({
      origin: ORIGIN,
      destination: stop('1 Rue Sainte-Catherine', 45.5017, -73.5673, 'CA'),
      packageType: 'small',
      weightLbs: 5,
      serviceLevel: 'standard',
    });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('delivery_domestic_only');
});
