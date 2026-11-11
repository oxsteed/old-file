'use strict';

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/storage', () => ({
  getSignedDownloadUrl: jest.fn(),
  uploadFile: jest.fn(),
  deleteFile: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const pool = require('../db');
const storage = require('../utils/storage');
const { errorHandler } = require('../middleware/errorHandler');
const worker = require('../controllers/careers/workerController');

function makeApp() {
  const app = express();
  app.get('/resume', (req, _res, next) => {
    req.user = { id: 'worker-1' };
    next();
  }, worker.downloadResume);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockResolvedValue({ rows: [{ resume_storage_key: 'careers/worker-1/resume.pdf' }] });
});

test('resume download fails closed when storage cannot mint a signed URL', async () => {
  storage.getSignedDownloadUrl.mockResolvedValue(null);

  const response = await request(makeApp()).get('/resume');

  expect(response.status).toBe(503);
  expect(response.body.code).toBe('storage_unavailable');
  expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('careers/worker-1/resume.pdf', 300);
});

test('resume download returns the signed URL when storage is available', async () => {
  storage.getSignedDownloadUrl.mockResolvedValue('/signed/resume');

  const response = await request(makeApp()).get('/resume');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ url: '/signed/resume', expires_in: 300 });
});
