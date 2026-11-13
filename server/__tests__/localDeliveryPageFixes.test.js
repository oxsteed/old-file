'use strict';

// Delivery page fixes (2026-11-13): estimate per-size prices (item 9),
// contact phones + item description through quote/create hashing (item 8),
// driver availability toggle (item 12), item-photo upload (item 8).
const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn(),
  getSignedDownloadUrl: jest.fn(),
  deleteFile: jest.fn(),
}));
jest.mock('../services/fileScanService', () => ({
  malwareScanRequired: () => false,
  isConfigured: () => false,
  scanBuffer: async () => ({ clean: true, provider: 'test' }),
}));
const pool = require('../db');
const storage = require('../utils/storage');
const localDelivery = require('../controllers/localDeliveryController');
const itemPhotoController = require('../controllers/localDeliveryItemPhotoController');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');

const USER_ID = '00000000-0000-4000-8000-000000000123';

function buildApp(mount) {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: USER_ID }; next(); });
  mount(app);
  app.use(errorHandler);
  return app;
}

function stop(address, lat, lng) {
  return { address, city: 'Springfield', state: 'OH', country: 'US', lat, lng };
}

function quotePayload(overrides = {}) {
  const now = Date.now();
  const iso = (ms) => new Date(now + ms).toISOString();
  return {
    origin: stop('1 W Main St', 39.9242, -83.8088),
    destination: stop('2 E High St', 39.953, -83.81),
    packageType: 'small',
    weightLbs: 5,
    serviceLevel: 'standard',
    pieces: 1,
    dimensions: { lengthIn: 10, widthIn: 8, heightIn: 6 },
    contentsCategory: 'general',
    declaredValueCents: 5000,
    fragile: false,
    perishable: false,
    handlingRequirements: {},
    originContact: { name: 'Ana', phone: '+19375550101', instructions: '' },
    destinationContact: { name: 'Ben', phone: '+19375550102', instructions: '' },
    pickupWindow: { start: iso(3600000), end: iso(7200000) },
    deliveryWindow: { start: iso(10800000), end: iso(14400000) },
    proofPreference: 'recipient_confirmation',
    ...overrides,
  };
}

describe('estimate per-size prices (item 9)', () => {
  const app = buildApp((a) => a.post('/delivery/estimate', express.json(), localDelivery.estimate));

  test('returns server-computed totals for every size on the same route', async () => {
    const res = await request(app)
      .post('/delivery/estimate')
      .send({ origin: stop('1 W Main St', 39.9242, -83.8088), destination: stop('2 E High St', 39.953, -83.81), packageType: 'small', weightLbs: 5, serviceLevel: 'standard' });
    expect(res.status).toBe(200);
    // Same ~2 mile route: base $9 + $0/$5/$12/$25 surcharge, $15 minimum
    // fare, 12% platform fee (min $2.99). Small and medium both land on the
    // minimum fare; large and oversized price above it.
    expect(res.body.estimate.sizePrices).toEqual({
      small: { customerTotalCents: 1799 },
      medium: { customerTotalCents: 1799 },
      large: { customerTotalCents: 2399 },
      oversized: { customerTotalCents: 3808 },
    });
  });
});

describe('quote carries phones and item description (item 8)', () => {
  const app = buildApp((a) => a.post('/delivery/quote', express.json(), localDelivery.quote));
  let insertedArgs;

  beforeEach(() => {
    insertedArgs = null;
    pool.query.mockImplementation(async (sql, args) => {
      if (String(sql).includes('INSERT INTO delivery_quotes')) insertedArgs = args;
      return { rows: [{ id: 99, expires_at: new Date(Date.now() + 15 * 60000).toISOString() }] };
    });
  });
  afterEach(() => jest.clearAllMocks());

  test('contact phones post through to the quoted operational snapshot', async () => {
    const res = await request(app).post('/delivery/quote').send(quotePayload());
    expect(res.status).toBe(200);
    expect(res.body.quote.originContact.phone).toBe('+19375550101');
    expect(res.body.quote.destinationContact.phone).toBe('+19375550102');
    const snapshot = JSON.parse(insertedArgs[2]);
    expect(snapshot.operational.originContact.phone).toBe('+19375550101');
    expect(snapshot.operational.destinationContact.phone).toBe('+19375550102');
  });

  test('item description is hashed consistently: same text, same hash; different text, different hash', async () => {
    // One payload object reused: rebuilding it would move the windows and
    // change the hash for a reason unrelated to the description.
    const base = quotePayload({ itemDescription: 'Two boxes of books' });
    await request(app).post('/delivery/quote').send(base);
    const firstHash = insertedArgs[1];
    await request(app).post('/delivery/quote').send(base);
    expect(insertedArgs[1]).toBe(firstHash);
    await request(app).post('/delivery/quote').send({ ...base, itemDescription: 'One guitar in a hard case' });
    expect(insertedArgs[1]).not.toBe(firstHash);
  });
});

describe('driver availability toggle (item 12)', () => {
  const app = buildApp((a) => a.patch('/delivery/driver-profile/availability', express.json(), localDelivery.setDriverAvailability));

  afterEach(() => jest.clearAllMocks());

  test('toggles the driver’s own flag', async () => {
    pool.query.mockResolvedValue({ rows: [{ user_id: USER_ID, available: true }] });
    const res = await request(app).patch('/delivery/driver-profile/availability').send({ available: true });
    expect(res.status).toBe(200);
    expect(res.body.profile.available).toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([true, USER_ID]);
  });

  test('rejects a non-boolean value', async () => {
    const res = await request(app).patch('/delivery/driver-profile/availability').send({ available: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('delivery_driver_availability_invalid');
  });

  test('404s when the caller has no driver profile', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app).patch('/delivery/driver-profile/availability').send({ available: true });
    expect(res.status).toBe(404);
  });
});

describe('item-photo upload (item 8)', () => {
  // A real 1x1 JPEG (file-type confirms image/jpeg): validateFileUpload
  // sniffs content bytes, so the reported type must match the bytes.
  const jpeg = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const app = buildApp((a) => a.post(
    '/delivery/jobs/:id/item-photo',
    express.json(),
    itemPhotoController.uploadGuard,
    upload.single('image'),
    validateFileUpload,
    itemPhotoController.upload,
  ));

  function mockPoolForUpload(jobOwner = USER_ID) {
    pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes("SELECT id FROM delivery_jobs")) {
        return { rows: jobOwner === USER_ID ? [{ id: 7 }] : [] };
      }
      return { rows: [] };
    });
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (String(sql).includes('SELECT * FROM delivery_jobs')) {
          return { rows: [{ id: 7, customer_user_id: USER_ID, status: 'posted' }] };
        }
        if (String(sql).includes('INSERT INTO delivery_job_item_photos')) {
          return { rows: [{ id: 'photo-1', content_type: 'image/jpeg', size_bytes: jpeg.length, created_at: new Date().toISOString() }] };
        }
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);
    storage.uploadFile.mockResolvedValue('delivery-private/7/user/item.png');
  }

  afterEach(() => jest.clearAllMocks());

  test('customer uploads an item photo before pickup', async () => {
    mockPoolForUpload();
    const res = await request(app).post('/delivery/jobs/7/item-photo').attach('image', jpeg, 'item.jpg');
    expect(res.status).toBe(201);
    expect(res.body.photo.id).toBe('photo-1');
    expect(storage.uploadFile).toHaveBeenCalled();
  });

  test('a non-owner cannot upload', async () => {
    mockPoolForUpload('someone-else');
    const res = await request(app).post('/delivery/jobs/7/item-photo').attach('image', jpeg, 'item.jpg');
    expect(res.status).toBe(404);
  });

  test('a non-image file is rejected', async () => {
    mockPoolForUpload();
    const res = await request(app).post('/delivery/jobs/7/item-photo').attach('image', Buffer.from('hello'), 'notes.txt');
    expect(res.status).toBe(400);
  });
});
