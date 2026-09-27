const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const stripe = require('stripe');

const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-qr-test-'));
process.env.LOCAL_UPLOAD_DIR = uploadRoot;
const { QR_UPLOAD_DIR } = require('../utils/qrCodeStorage');

jest.mock('../middleware/auth', () => ({authenticate(req, res, next) {
  req.user = {id: 'qr-test-owner', role: 'customer', membership_tier: req.get('x-test-tier') || 'pro'};
  next();
}}));
jest.mock('../middleware/rateLimiter', () => ({generalLimiter: (_req, _res, next) => next()}));
jest.mock('../utils/logger', () => ({error: jest.fn(), warn: jest.fn()}));

const routes = require('../routes/qrCodes');
const app = express();
app.use(express.json());
app.use('/api/qr-codes', routes);
app.use('/qr-codes', express.static(QR_UPLOAD_DIR, {fallthrough: false}));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ZkAAAAASUVORK5CYII=', 'base64');
const payload = {title:'Test QR', url:'https://example.com', dotColor:'#000000', backgroundColor:'#ffffff', dotStyle:'square', size:300, imageFormat:'png', imageData:`data:image/png;base64,${png.toString('base64')}`};

beforeEach(() => resetMocks());
afterAll(() => {
  delete process.env.LOCAL_UPLOAD_DIR;
  fs.rmSync(uploadRoot, {recursive: true, force: true});
});

test('saved PNG is served from the upload volume and can be downloaded and deleted', async () => {
  let saved;
  mockQuery.mockImplementation(async (sql, values) => {
    if (/INSERT INTO qr_codes /.test(sql)) {
      saved = {id:'42', user_id:values[0], title:values[1], image_url:values[8], image_format:values[9]};
      return {rows:[saved]};
    }
    if (/SELECT \* FROM qr_codes/.test(sql) || /DELETE FROM qr_codes/.test(sql)) {
      return {rows: values[0] === '42' && values[1] === 'qr-test-owner' ? [saved] : []};
    }
    return {rows:[]};
  });
  const created = await request(app).post('/api/qr-codes').send(payload).expect(201);
  const url = created.body.data.image_url;
  const image = await request(app).get(url).expect(200).expect('Content-Type', /image\/png/);
  expect(image.body).toEqual(png);
  expect(fs.existsSync(path.join(uploadRoot, 'qr-codes', path.basename(url)))).toBe(true);
  await request(app).post('/api/qr-codes/42/download?format=png').expect(200);
  await request(app).get('/api/qr-codes/99').expect(404);
  await request(app).delete('/api/qr-codes/42').expect(200);
  await request(app).get(url).expect(404);
});

test('updates use the QR ID and current owner in the correct SQL positions', async () => {
  mockQuery.mockImplementation(async (_sql, values) => ({rows:
    values[0] === '42' && values[1] === 'qr-test-owner' ? [{id:'42', title:values[2]}] : []}));
  const response = await request(app).put('/api/qr-codes/42').send({title:'Updated'}).expect(200);
  expect(response.body.data.title).toBe('Updated');
});

test('image write failure returns an error instead of reporting a successful save', async () => {
  const write = jest.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('test write failure'));
  try {
    await request(app).post('/api/qr-codes').send(payload).expect(500);
    expect(mockQuery).not.toHaveBeenCalled();
  } finally {write.mockRestore();}
});

test('free customers remain blocked by the Pro entitlement gate', async () => {
  await request(app).post('/api/qr-codes').set('x-test-tier', 'free').send(payload).expect(403);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('operational templates persist searchable workspace metadata with the QR', async () => {
  let insertValues;
  mockQuery.mockImplementation(async (sql, values) => {
    if (/INSERT INTO qr_codes /.test(sql)) {
      insertValues = values;
      return { rows: [{ id: '43', workspace: values[10], template_key: values[11], label_data: values[12] }] };
    }
    return { rows: [] };
  });

  const response = await request(app).post('/api/qr-codes').send({
    ...payload,
    title: 'Dock Door 07',
    url: 'OXSTEED-LABEL\nTYPE=dock-door\nDOOR=07',
    workspace: 'warehouse',
    templateKey: 'dock-door',
    labelData: { site: 'Dayton DC', door: '07', direction: 'Receiving' },
    codeType: 'code128',
  }).expect(201);

  expect(response.body.data.workspace).toBe('warehouse');
  expect(insertValues.slice(10)).toEqual([
    'warehouse',
    'dock-door',
    { site: 'Dayton DC', door: '07', direction: 'Receiving' },
    'code128',
  ]);
});

test('barcode code types are validated before saving', async () => {
  await request(app).post('/api/qr-codes').send({ ...payload, codeType: 'unsupported' }).expect(400);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('watermark removal checkout is fixed at one dollar and records the QR key', async () => {
  const session = {
    id: 'cs_qr_export_1',
    url: 'https://checkout.stripe.test/cs_qr_export_1',
    status: 'open',
  };
  stripe.__mockInstance.checkout.sessions.create.mockResolvedValueOnce(session);
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT stripe_checkout_session_id/.test(sql)) return { rows: [] };
    if (/INSERT INTO qr_export_purchases/.test(sql)) return { rows: [] };
    return { rows: [] };
  });

  const response = await request(app)
    .post('/api/qr-codes/export-checkout')
    .send({ qrKey: 'a'.repeat(64), format: 'promo-png' })
    .expect(200);

  expect(response.body.data.url).toBe(session.url);
  expect(stripe.__mockInstance.checkout.sessions.create).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'payment',
      line_items: [expect.objectContaining({
        price_data: expect.objectContaining({ unit_amount: 100, currency: 'usd' }),
      })],
    }),
    expect.objectContaining({ idempotencyKey: expect.stringContaining('qr-export:') }),
  );
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO qr_export_purchases'),
    expect.arrayContaining(['qr-test-owner', 'a'.repeat(64), 'promo-png', session.id, 100, 'usd']),
  );
});

test('watermark removal verification rejects a payment for another user or QR key', async () => {
  stripe.__mockInstance.checkout.sessions.retrieve.mockResolvedValueOnce({
    metadata: {
      product: 'qr_export_watermark_removal',
      userId: 'someone-else',
      qrKey: 'b'.repeat(64),
    },
    payment_status: 'paid',
  });

  await request(app)
    .post('/api/qr-codes/export-checkout/verify')
    .send({ sessionId: 'cs_other_user', qrKey: 'a'.repeat(64) })
    .expect(403);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('paid QR export verification marks the purchase paid only after Stripe confirms it', async () => {
  const qrKey = 'c'.repeat(64);
  stripe.__mockInstance.checkout.sessions.retrieve.mockResolvedValueOnce({
    metadata: {
      product: 'qr_export_watermark_removal',
      userId: 'qr-test-owner',
      qrKey,
    },
    payment_status: 'paid',
    payment_intent: 'pi_qr_export_1',
  });
  mockQuery.mockImplementation(async (sql) => {
    if (/UPDATE qr_export_purchases/.test(sql)) {
      return { rows: [{ format: 'promo-png', amount_cents: 100, currency: 'usd' }] };
    }
    return { rows: [] };
  });

  const response = await request(app)
    .post('/api/qr-codes/export-checkout/verify')
    .send({ sessionId: 'cs_qr_export_1', qrKey })
    .expect(200);

  expect(response.body.data).toEqual(expect.objectContaining({ paid: true, amountCents: 100, currency: 'usd' }));
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining("SET status = 'paid'"),
    ['qr-test-owner', qrKey, 'pi_qr_export_1', 'cs_qr_export_1'],
  );
});
