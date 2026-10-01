'use strict';

/**
 * WS3 QR security remediation tests (audit findings C4, H14, M28-qr).
 *
 * Runs without a live DB: pg, Stripe, email, and socket services are mocked
 * by ./setup (the stripe factory mock handles qrPayments.js's module-level
 * `require('stripe')(process.env.STRIPE_SECRET_KEY)`). QR logo file writes go
 * to a temp LOCAL_UPLOAD_DIR, never the real upload volume.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before qrCodeStorage is first required (it reads the env at
// module load). Points uploads at a disposable temp dir for these tests.
const TMP_UPLOAD = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-security-test-'));
process.env.LOCAL_UPLOAD_DIR = TMP_UPLOAD;

require('./setup');

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'owner-1', role: 'helper', email: 'owner@example.com' };
    next();
  },
}));

const qrCodesController = require('../controllers/qrCodesController');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function uploadDir() {
  return path.join(TMP_UPLOAD, 'qr-codes');
}

function listUploadFiles() {
  if (!fs.existsSync(uploadDir())) return [];
  return fs.readdirSync(uploadDir());
}

function clearUploadDir() {
  for (const f of listUploadFiles()) fs.unlinkSync(path.join(uploadDir(), f));
}

function makeReq(overrides = {}) {
  return {
    user: { id: 'user-1' },
    ip: '127.0.0.1',
    body: {
      title: 'Test QR',
      url: 'https://example.com',
      dotColor: '#111111',
      backgroundColor: '#ffffff',
      dotStyle: 'square',
      size: 300,
      imageFormat: 'png',
      workspace: 'custom',
      templateKey: 'custom',
      labelData: {},
      codeType: 'qr',
      ...overrides,
    },
  };
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  resetMocks();
  // Default INSERT result for createQRCode success paths.
  mockQuery.mockResolvedValue({ rows: [{ id: 'qr-1', title: 'Test QR' }], rowCount: 1 });
  clearUploadDir();
});

afterAll(() => {
  fs.rmSync(TMP_UPLOAD, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────────────────────────
// C4: QR logo upload hardening in createQRCode
// ────────────────────────────────────────────────────────────────────────────
describe('C4: QR logo upload hardening (createQRCode)', () => {
  test('rejects imageFormat svg with 400 + error code and writes nothing to disk', async () => {
    const req = makeReq({
      imageFormat: 'svg',
      imageData: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64'),
    });
    const res = makeRes();
    await qrCodesController.createQRCode(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'invalid_image_format' })
    );
    expect(listUploadFiles()).toHaveLength(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects non-PNG bytes even when imageFormat claims png', async () => {
    const svgBytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    );
    const req = makeReq({
      imageData: `data:image/svg+xml;base64,${svgBytes.toString('base64')}`,
    });
    const res = makeRes();
    await qrCodesController.createQRCode(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'invalid_image_format' })
    );
    expect(listUploadFiles()).toHaveLength(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects decoded buffers over the 2 MB cap', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1);
    PNG_MAGIC.copy(big, 0); // valid signature, oversized payload
    const req = makeReq({ imageData: big.toString('base64') });
    const res = makeRes();
    await qrCodesController.createQRCode(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'image_too_large' })
    );
    expect(listUploadFiles()).toHaveLength(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects non-string imageData with 400', async () => {
    const req = makeReq({ imageData: { not: 'a string' } });
    const res = makeRes();
    await qrCodesController.createQRCode(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'invalid_image_data' })
    );
    expect(listUploadFiles()).toHaveLength(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('accepts a real PNG, stores it as .png, and inserts the row', async () => {
    const png = Buffer.concat([PNG_MAGIC, Buffer.from('fake-png-payload')]);
    const req = makeReq({ imageData: png.toString('base64') });
    const res = makeRes();
    await qrCodesController.createQRCode(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(201);
    const files = listUploadFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.png$/);
    const written = fs.readFileSync(path.join(uploadDir(), files[0]));
    expect(written.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('still creates QR codes when no imageData is provided', async () => {
    const req = makeReq();
    const res = makeRes();
    await qrCodesController.createQRCode(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(201);
    expect(listUploadFiles()).toHaveLength(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// H14: public checkout route gets its own limiter (paymentsLimiter's
// `skip: !req.user` never fires there because there is no authenticate).
// ────────────────────────────────────────────────────────────────────────────
describe('H14: public checkout route rate limiting', () => {
  let app;
  let isolatedMockQuery;

  beforeEach(() => {
    jest.isolateModules(() => {
      // Fresh router (and fresh limiter stores) per test so request counts
      // never leak between tests.
      isolatedMockQuery = require('pg').Pool.mockQuery;
      const router = require('../routes/qrPayments');
      app = express();
      app.use(express.json());
      app.use('/api/qr-payments', router);
    });
    resetMocks();
    isolatedMockQuery.mockReset();
    isolatedMockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  });

  test('unauthenticated checkout requests are limited to 20/hour per IP', async () => {
    const url = '/api/qr-payments/pay/AbCdEfGhIjKl/checkout';
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).post(url).send({});
      // Invalid idempotency key fails fast in the handler, before any DB/Stripe work.
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('idempotency_key_required');
    }
    expect(isolatedMockQuery).not.toHaveBeenCalled();

    const limited = await request(app).post(url).send({});
    expect(limited.status).toBe(429);
    expect(String(limited.body.error || '')).toMatch(/too many/i);
  }, 30000);
});

// ────────────────────────────────────────────────────────────────────────────
// M28-qr: PATCH and DELETE /codes/:id get the shared paymentsLimiter.
// ────────────────────────────────────────────────────────────────────────────
describe('M28-qr: PATCH/DELETE code routes are rate-limited', () => {
  let app;
  let isolatedMockQuery;

  beforeEach(() => {
    jest.isolateModules(() => {
      isolatedMockQuery = require('pg').Pool.mockQuery;
      const router = require('../routes/qrPayments');
      app = express();
      app.use(express.json());
      app.use('/api/qr-payments', router);
    });
    resetMocks();
    isolatedMockQuery.mockReset();
    // Unknown code -> fast 404 so each request is cheap.
    isolatedMockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  });

  test('PATCH /codes/:id is limited to 20/hour', async () => {
    const url = '/api/qr-payments/codes/qr-code-1';
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).patch(url).send({ label: 'New label' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
    const limited = await request(app).patch(url).send({ label: 'New label' });
    expect(limited.status).toBe(429);
  }, 30000);

  test('DELETE /codes/:id is limited to 20/hour', async () => {
    const url = '/api/qr-payments/codes/qr-code-1';
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).delete(url);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
    const limited = await request(app).delete(url);
    expect(limited.status).toBe(429);
  }, 30000);
});
