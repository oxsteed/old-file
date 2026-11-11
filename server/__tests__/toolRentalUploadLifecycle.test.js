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
  single: () => (req, _res, next) => {
    if (req.headers['x-test-file']) {
      req.file = {
        buffer: Buffer.from('tool image'),
        originalname: 'drill.jpg',
        mimetype: 'image/jpeg',
      };
    }
    next();
  },
}));

jest.mock('../middleware/validateFileUpload', () => (_req, _res, next) => next());
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('tool-rentals/drill.jpg'),
  getPublicUrl: jest.fn((key) => `https://oxsteed.com/api/storage/public/${key}`),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

const storage = require('../utils/storage');
const toolRentalRoutes = require('../routes/toolRentals');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tool-rentals', toolRentalRoutes);
  return app;
}

const validListing = {
  name: 'Cordless drill',
  category: 'Power Tools',
  daily_rate: 18,
  location_city: 'Austin',
  owner_attestation_accepted: true,
};

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  storage.uploadFile.mockResolvedValue('tool-rentals/drill.jpg');
  storage.getPublicUrl.mockImplementation((key) => `https://oxsteed.com/api/storage/public/${key}`);
  storage.deleteFile.mockResolvedValue(undefined);
});

test('deletes a newly uploaded image when listing creation fails', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ column_name: 'image_gallery' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce(new Error('tool insert unavailable'));

  const res = await request(buildApp())
    .post('/api/tool-rentals')
    .set('x-test-file', '1')
    .send(validListing);

  expect(res.status).toBe(500);
  expect(storage.deleteFile).toHaveBeenCalledWith('tool-rentals/drill.jpg');
});

test('deletes a newly uploaded image when listing update fails', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'tool-1', moderation_hold: false }] })
    .mockRejectedValueOnce(new Error('tool update unavailable'));

  const res = await request(buildApp())
    .put('/api/tool-rentals/tool-1')
    .set('x-test-file', '1')
    .send({ daily_rate: 19, owner_attestation_accepted: true });

  expect(res.status).toBe(500);
  expect(storage.deleteFile).toHaveBeenCalledWith('tool-rentals/drill.jpg');
});
