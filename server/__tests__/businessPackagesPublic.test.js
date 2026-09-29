'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../models/mainAppContractsModel', () => ({
  serializeServicePackage: jest.fn((row) => ({ id: row.id, name: row.name })),
  listPublicServicePackages: jest.fn(async () => []),
}));

const controller = require('../controllers/businessPackagesController');
const { listPublicServicePackages } = require('../models/mainAppContractsModel');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/businesses/public/:businessId/packages', controller.listPublicPackages);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('numeric businessId passes straight to the packages query', async () => {
  const response = await request(buildApp()).get('/api/businesses/public/42/packages');

  expect(response.status).toBe(200);
  expect(mockQuery).not.toHaveBeenCalled();
  expect(listPublicServicePackages).toHaveBeenCalledWith(
    expect.objectContaining({ businessId: '42', limit: 50 })
  );
});

test('vanity profile_slug resolves to the integer business id', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] });

  const response = await request(buildApp()).get('/api/businesses/public/acme-cleaning/packages');

  expect(response.status).toBe(200);
  expect(mockQuery).toHaveBeenCalledWith(
    'SELECT id FROM businesses WHERE profile_slug = $1',
    ['acme-cleaning']
  );
  expect(listPublicServicePackages).toHaveBeenCalledWith(
    expect.objectContaining({ businessId: 7, limit: 50 })
  );
});

test('unknown slug returns 404 without querying packages', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const response = await request(buildApp()).get('/api/businesses/public/no-such-business/packages');

  expect(response.status).toBe(404);
  expect(response.body.error).toBe('Business not found');
  expect(listPublicServicePackages).not.toHaveBeenCalled();
});
