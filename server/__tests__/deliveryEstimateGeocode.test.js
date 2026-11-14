'use strict';

// Repro for the Nov 12 live bug: production /geo/suggest returns the
// parseFallback shape (no coordinates, street parsed as city), so picking a
// suggestion dead-ends the estimate with "choose an address suggestion".
// The estimate path must geocode coordinate-less stops server-side instead
// of rejecting them, and fail with a plain "could not be located" error
// when no provider can locate the address.
const express = require('express');
const request = require('supertest');

jest.mock('../services/geoProviderService', () => ({
  nearby: jest.fn(),
  reverse: jest.fn(),
  suggest: jest.fn(),
}));
jest.mock('../services/geoRouteProviderService', () => ({
  calculateMatrix: jest.fn(),
  calculateRoute: jest.fn(),
}));

const geoProvider = require('../services/geoProviderService');
const geoController = require('../controllers/geoController');
const { errorHandler } = require('../middleware/errorHandler');
const localDelivery = require('../controllers/localDeliveryController');

const USER_ID = '00000000-0000-4000-8000-000000000123';

function buildApp(user = { id: USER_ID }) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.post('/delivery/estimate', express.json(), localDelivery.estimate);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AWS_GEO_PLACES_ENABLED;
  delete process.env.AWS_REGION;
  delete process.env.GOOGLE_MAPS_API_KEY;
  if (typeof geoController.resetForTests === 'function') geoController.resetForTests();
});

// The exact shape production /geo/suggest returns today for a Springfield
// street address: no coordinates, street parsed as the city.
const FALLBACK_ORIGIN = {
  display: '100 S Limestone St, Springfield, OH',
  addressLine1: '',
  addressLine2: '',
  city: '100 S Limestone St',
  state: 'SPRINGFIELD',
  zip: '',
  country: '',
  lat: null,
  lng: null,
};
const FALLBACK_DESTINATION = {
  display: '300 E Main St, Springfield, OH',
  addressLine1: '',
  addressLine2: '',
  city: '300 E Main St',
  state: 'SPRINGFIELD',
  zip: '',
  country: '',
  lat: null,
  lng: null,
};

test('a coordinate-less suggestion for a real address still reaches a priced estimate', async () => {
  geoProvider.suggest.mockImplementation(async (query) => {
    if (String(query).includes('Limestone')) {
      return [{
        display: '100 S Limestone St, Springfield, OH 45502, USA',
        addressLine1: '100 S Limestone St',
        city: 'Springfield',
        state: 'OH',
        zip: '45502',
        country: 'US',
        lat: 39.9242,
        lng: -83.8088,
      }];
    }
    return [{
      display: '300 E Main St, Springfield, OH 45503, USA',
      addressLine1: '300 E Main St',
      city: 'Springfield',
      state: 'OH',
      zip: '45503',
      country: 'US',
      lat: 39.953,
      lng: -83.81,
    }];
  });
  const res = await request(buildApp())
    .post('/delivery/estimate')
    .send({ origin: FALLBACK_ORIGIN, destination: FALLBACK_DESTINATION, packageType: 'small', weightLbs: 5, serviceLevel: 'standard' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.estimate.pricing.cents.customerTotal).toBe(1799);
  expect(res.body.estimate.origin).toEqual(expect.objectContaining({ lat: 39.9242, lng: -83.8088 }));
  expect(res.body.estimate.destination).toEqual(expect.objectContaining({ lat: 39.953, lng: -83.81 }));
});

test('an unlocatable address fails with a plain error, not a suggestion prompt', async () => {
  geoProvider.suggest.mockResolvedValue(null);
  const res = await request(buildApp())
    .post('/delivery/estimate')
    .send({ origin: FALLBACK_ORIGIN, destination: FALLBACK_DESTINATION, packageType: 'small', weightLbs: 5, serviceLevel: 'standard' });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('delivery_address_not_locatable');
});

test('an estimate with no address text at all still requires complete stops', async () => {
  const res = await request(buildApp())
    .post('/delivery/estimate')
    .send({
      origin: { address: '', city: '', state: '', country: '', lat: null, lng: null },
      destination: FALLBACK_DESTINATION,
      packageType: 'small',
      weightLbs: 5,
      serviceLevel: 'standard',
    });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('delivery_addresses_required');
});

// Domain 9 item 2, geocode step: a coordinate-less estimate already caches
// successful geocodes for 24h, but two concurrent identical submits each
// paid for the same lookup, and an unlocatable address was re-geocoded on
// every submit. In-flight dedupe plus a short negative cache close both.
test('concurrent identical coordinate-less estimates share one geocode per stop', async () => {
  geoProvider.suggest.mockImplementation(async (query) => {
    // Hold every lookup open long enough that both concurrent requests have
    // issued theirs before either resolves: without in-flight dedupe this
    // is 4 provider calls (2 requests x 2 stops), with it, 2.
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (String(query).includes('Limestone')) {
      return [{
        display: '100 S Limestone St, Springfield, OH 45502, USA',
        addressLine1: '100 S Limestone St',
        city: 'Springfield',
        state: 'OH',
        zip: '45502',
        country: 'US',
        lat: 39.9242,
        lng: -83.8088,
      }];
    }
    return [{
      display: '300 E Main St, Springfield, OH 45503, USA',
      addressLine1: '300 E Main St',
      city: 'Springfield',
      state: 'OH',
      zip: '45503',
      country: 'US',
      lat: 39.953,
      lng: -83.81,
    }];
  });
  const body = { origin: FALLBACK_ORIGIN, destination: FALLBACK_DESTINATION, packageType: 'small', weightLbs: 5, serviceLevel: 'standard' };
  const [first, second] = await Promise.all([
    request(buildApp()).post('/delivery/estimate').send(body),
    request(buildApp()).post('/delivery/estimate').send(body),
  ]);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  // One lookup per distinct stop, not one per request per stop.
  expect(geoProvider.suggest).toHaveBeenCalledTimes(2);
});

test('a re-submitted unlocatable address is not geocoded again', async () => {
  geoProvider.suggest.mockResolvedValue(null);
  const body = { origin: FALLBACK_ORIGIN, destination: FALLBACK_DESTINATION, packageType: 'small', weightLbs: 5, serviceLevel: 'standard' };
  const first = await request(buildApp()).post('/delivery/estimate').send(body);
  expect(first.status).toBe(400);
  expect(first.body.code).toBe('delivery_address_not_locatable');
  const second = await request(buildApp()).post('/delivery/estimate').send(body);
  expect(second.status).toBe(400);
  expect(second.body.code).toBe('delivery_address_not_locatable');
  expect(geoProvider.suggest).toHaveBeenCalledTimes(1);
});
