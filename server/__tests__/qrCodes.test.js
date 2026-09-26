const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

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
