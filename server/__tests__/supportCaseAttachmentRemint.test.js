'use strict';

// Support-URL re-mint on read: case attachments must never serve the stored
// URL as-is. The read path mints a fresh short-lived signed URL per read
// from the stored key (or a key recovered from a legacy stored URL), and
// fails closed with no link when signing is unavailable or no key can be
// recovered. Uploads store the key, not a long-lived signed URL.

const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../utils/storage', () => ({
  ...jest.requireActual('../utils/storage'),
  uploadFile: jest.fn(),
}));
const storage = require('../utils/storage');

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const db = require('../db');

const CASE_ROW = {
  id: 42,
  customer_user_id: 'user-1',
  restaurant_id: 7,
  order_id: null,
  status: 'open',
};

function appWithUser() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', preferred_language: 'en' };
    next();
  });
  return app;
}

function mockCaseReads(attachmentRows) {
  db.query.mockImplementation(async (sql) => {
    if (String(sql).includes('FROM restaurant_support_cases rsc')) return { rows: [CASE_ROW] };
    if (String(sql).includes('FROM restaurant_support_case_messages')) return { rows: [] };
    if (String(sql).includes('FROM restaurant_support_case_attachments')) return { rows: attachmentRows };
    return { rows: [] };
  });
}

function expOf(url) {
  const parsed = new URL(url, 'http://test');
  return Number(parsed.searchParams.get('exp'));
}

describe('extractKeyFromStoredUrl', () => {
  test('private:// reference yields the key', () => {
    expect(storage.extractKeyFromStoredUrl('private://restaurant-support-cases/abc123.png'))
      .toBe('restaurant-support-cases/abc123.png');
  });

  test('relative local signed-download URL yields the decoded key', () => {
    expect(storage.extractKeyFromStoredUrl('/api/storage/files/restaurant-support-cases/abc123.png?exp=999&sig=deadbeef'))
      .toBe('restaurant-support-cases/abc123.png');
  });

  test('absolute local signed-download URL behind an app base yields the key', () => {
    expect(storage.extractKeyFromStoredUrl('https://oxsteed.com/api/storage/files/restaurant-support-cases/abc%20123.png?exp=999&sig=x'))
      .toBe('restaurant-support-cases/abc 123.png');
  });

  test('SDK virtual-hosted S3 URL yields the key', () => {
    expect(storage.extractKeyFromStoredUrl('https://oxsteed-uploads.s3.us-east-1.amazonaws.com/restaurant-support-cases/abc123.png?X-Amz-Signature=abc'))
      .toBe('restaurant-support-cases/abc123.png');
  });

  test('garbage, empty, and traversal references yield null', () => {
    expect(storage.extractKeyFromStoredUrl('https://evil.example/receipt.png')).toBeNull();
    expect(storage.extractKeyFromStoredUrl('')).toBeNull();
    expect(storage.extractKeyFromStoredUrl('/api/storage/files/../secret.txt?exp=1&sig=x')).toBeNull();
    expect(storage.extractKeyFromStoredUrl('private://../secret.txt')).toBeNull();
  });
});

describe('support case attachment re-mint on read', () => {
  const OLD_SECRET = process.env.SIGNED_URL_SECRET;

  beforeEach(() => {
    process.env.SIGNED_URL_SECRET = 'test-support-remint-secret';
    delete process.env.APP_URL;
    delete process.env.CLIENT_URL;
    db.query.mockReset();
    db.connect.mockReset();
    storage.uploadFile.mockReset();
  });

  afterAll(() => {
    if (OLD_SECRET === undefined) delete process.env.SIGNED_URL_SECRET;
    else process.env.SIGNED_URL_SECRET = OLD_SECRET;
  });

  test('read mints a fresh 900s URL from file_key, never the stored URL', async () => {
    const stored = '/api/storage/files/restaurant-support-cases/oldkey.png?exp=9999999999&sig=old';
    mockCaseReads([{
      id: 1, case_id: 42, file_key: 'restaurant-support-cases/newkey.png',
      file_url: stored, file_name: 'receipt.png', attachment_type: 'receipt',
    }]);
    const ctrl = require('../controllers/restaurantSupportController');
    const app = appWithUser();
    app.get('/api/restaurants/support/cases/:caseId', ctrl.getMyCase);
    app.use(errorHandler);

    const res = await request(app).get('/api/restaurants/support/cases/42');
    expect(res.status).toBe(200);
    const attachment = res.body.attachments[0];
    expect(attachment.file_url).not.toBe(stored);
    expect(attachment.file_url).toContain('/api/storage/files/restaurant-support-cases/newkey.png');
    const exp = expOf(attachment.file_url);
    const now = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThanOrEqual(now + 800);
    expect(exp).toBeLessThanOrEqual(now + 1000);
  });

  test('legacy stored URL without file_key is re-minted from the recovered key', async () => {
    const stored = '/api/storage/files/restaurant-support-cases/legacy.png?exp=9999999999&sig=old';
    mockCaseReads([{
      id: 2, case_id: 42, file_key: null,
      file_url: stored, file_name: 'photo.png', attachment_type: 'photo',
    }]);
    const ctrl = require('../controllers/restaurantSupportController');
    const app = appWithUser();
    app.get('/api/restaurants/support/cases/:caseId', ctrl.getMyCase);
    app.use(errorHandler);

    const res = await request(app).get('/api/restaurants/support/cases/42');
    expect(res.status).toBe(200);
    expect(res.body.attachments[0].file_url).not.toBe(stored);
    expect(res.body.attachments[0].file_url).toContain('/api/storage/files/restaurant-support-cases/legacy.png');
  });

  test('private:// stored reference is re-minted', async () => {
    mockCaseReads([{
      id: 3, case_id: 42, file_key: null,
      file_url: 'private://restaurant-support-cases/ref.png', file_name: 'ref.png', attachment_type: 'document',
    }]);
    const ctrl = require('../controllers/restaurantSupportController');
    const app = appWithUser();
    app.get('/api/restaurants/support/cases/:caseId', ctrl.getMyCase);
    app.use(errorHandler);

    const res = await request(app).get('/api/restaurants/support/cases/42');
    expect(res.status).toBe(200);
    expect(res.body.attachments[0].file_url).toContain('/api/storage/files/restaurant-support-cases/ref.png');
  });

  test('unrecoverable stored URL fails closed with no link, case still served', async () => {
    mockCaseReads([{
      id: 4, case_id: 42, file_key: null,
      file_url: 'https://evil.example/receipt.png', file_name: 'receipt.png', attachment_type: 'receipt',
    }]);
    const ctrl = require('../controllers/restaurantSupportController');
    const app = appWithUser();
    app.get('/api/restaurants/support/cases/:caseId', ctrl.getMyCase);
    app.use(errorHandler);

    const res = await request(app).get('/api/restaurants/support/cases/42');
    expect(res.status).toBe(200);
    expect(res.body.attachments[0].file_url).toBeNull();
    expect(res.body.attachments[0].file_name).toBe('receipt.png');
  });

  test('missing signing secret fails closed with no link, case still served', async () => {
    delete process.env.SIGNED_URL_SECRET;
    mockCaseReads([{
      id: 5, case_id: 42, file_key: 'restaurant-support-cases/k.png',
      file_url: 'private://restaurant-support-cases/k.png', file_name: 'k.png', attachment_type: 'photo',
    }]);
    const ctrl = require('../controllers/restaurantSupportController');
    const app = appWithUser();
    app.get('/api/restaurants/support/cases/:caseId', ctrl.getMyCase);
    app.use(errorHandler);

    const res = await request(app).get('/api/restaurants/support/cases/42');
    expect(res.status).toBe(200);
    expect(res.body.attachments[0].file_url).toBeNull();
  });

  test('upload stores the key and a private:// reference, response carries a fresh URL', async () => {
    storage.uploadFile.mockResolvedValue('restaurant-support-cases/fresh.png');
    const insertParams = [];
    // NOTE: the global test setup replaces withTransaction with a harness
    // that runs the callback with a client delegating to pool.query, so the
    // transaction answers through db.query here, not db.connect.
    db.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM restaurant_support_cases rsc')) return { rows: [CASE_ROW] };
      if (String(sql).includes('INSERT INTO restaurant_support_case_attachments')) {
        insertParams.push(params);
        return { rows: [{ id: 9, case_id: 42, file_key: params[2], file_url: params[3], file_name: 'fresh.png' }] };
      }
      return { rows: [] };
    });
    const ctrl = require('../controllers/restaurantSupportController');

    const req = {
      params: { caseId: '42' },
      user: { id: 'user-1' },
      body: { attachmentType: 'proof' },
      file: { buffer: Buffer.from('x'), originalname: 'fresh.png', mimetype: 'image/png', size: 1 },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await ctrl.addAttachment(req, res, (err) => { throw err; });

    expect(res.status).toHaveBeenCalledWith(201);
    expect(insertParams[0][2]).toBe('restaurant-support-cases/fresh.png');
    expect(insertParams[0][3]).toBe('private://restaurant-support-cases/fresh.png');
    const body = res.json.mock.calls[0][0];
    expect(body.attachment.file_url).toContain('/api/storage/files/restaurant-support-cases/fresh.png');
    expect(body.attachment.file_url).not.toContain('private://');
    const exp = expOf(body.attachment.file_url);
    const now = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThanOrEqual(now + 800);
    expect(exp).toBeLessThanOrEqual(now + 1000);
  });
});
