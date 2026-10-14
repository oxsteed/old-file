'use strict';

/**
 * ADM-004: evidence URLs are rendered as <a href> in the admin report detail
 * panel. submitReport must validate them server-side: only http(s) URLs are
 * accepted; javascript:/data:/other schemes, non-URLs, and non-arrays are 400.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'reporter-1' }; next(); },
}));

const reportingCtrl = require('../controllers/reportingController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'reporter-1' }; next(); });
  app.post('/api/reports', reportingCtrl.submitReport);
  return app;
}
const app = buildApp();

let lastInsertParams = null;

function mockReportDb() {
  mockQuery.mockImplementation(async (text) => {
    const t = String(text || '');
    if (t.includes('SELECT id FROM users WHERE id')) {
      return { rows: [{ id: 'user-2' }], rowCount: 1 };
    }
    if (t.includes('INSERT INTO job_user_reports')) {
      return {
        rows: [{ id: 'rep-1', reporter_id: 'reporter-1', reported_user_id: 'user-2', reason: 'scam', status: 'submitted', created_at: new Date().toISOString() }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

function baseBody(overrides = {}) {
  return {
    reportedUserId: 'user-2',
    reason: 'scam',
    description: 'Suspicious behavior with evidence attached.',
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
  lastInsertParams = null;
  mockReportDb();
  // Capture INSERT params for the stored-value assertion.
  const origImpl = mockQuery.getMockImplementation();
  mockQuery.mockImplementation(async (text, params) => {
    if (String(text || '').includes('INSERT INTO job_user_reports')) lastInsertParams = params;
    return origImpl(text, params);
  });
});

test('http and https evidence URLs are accepted and stored normalized', async () => {
  const res = await request(app).post('/api/reports').send(baseBody({
    evidenceUrls: ['https://example.com/photo.jpg', 'http://example.org/video.mp4'],
  }));
  expect(res.status).toBe(201);
  expect(lastInsertParams[4]).toEqual(['https://example.com/photo.jpg', 'http://example.org/video.mp4']);
});

test('javascript: URL is rejected with 400', async () => {
  const res = await request(app).post('/api/reports').send(baseBody({
    evidenceUrls: ['javascript:alert(document.domain)'],
  }));
  expect(res.status).toBe(400);
  expect(lastInsertParams).toBeNull();
});

test('data: URL is rejected with 400', async () => {
  const res = await request(app).post('/api/reports').send(baseBody({
    evidenceUrls: ['data:text/html,<script>alert(1)</script>'],
  }));
  expect(res.status).toBe(400);
  expect(lastInsertParams).toBeNull();
});

test('vbscript: and other schemes are rejected', async () => {
  const res = await request(app).post('/api/reports').send(baseBody({
    evidenceUrls: ['vbscript:msgbox(1)'],
  }));
  expect(res.status).toBe(400);
  expect(lastInsertParams).toBeNull();
});

test('non-URL strings are rejected', async () => {
  const res = await request(app).post('/api/reports').send(baseBody({
    evidenceUrls: ['not a url at all'],
  }));
  expect(res.status).toBe(400);
  expect(lastInsertParams).toBeNull();
});

test('non-array evidenceUrls is rejected', async () => {
  const res = await request(app).post('/api/reports').send(baseBody({
    evidenceUrls: 'https://example.com/photo.jpg',
  }));
  expect(res.status).toBe(400);
  expect(lastInsertParams).toBeNull();
});

test('mixed valid/invalid list is rejected wholesale', async () => {
  const res = await request(app).post('/api/reports').send(baseBody({
    evidenceUrls: ['https://example.com/ok.jpg', 'javascript:alert(1)'],
  }));
  expect(res.status).toBe(400);
  expect(lastInsertParams).toBeNull();
});

test('missing evidenceUrls still submits (field is optional)', async () => {
  const res = await request(app).post('/api/reports').send(baseBody());
  expect(res.status).toBe(201);
  expect(lastInsertParams[4]).toBeNull();
});

test('overly long URLs are rejected', async () => {
  const res = await request(app).post('/api/reports').send(baseBody({
    evidenceUrls: [`https://example.com/${'a'.repeat(2100)}`],
  }));
  expect(res.status).toBe(400);
  expect(lastInsertParams).toBeNull();
});
