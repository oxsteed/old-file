'use strict';

// P1-269: SW-driven endpoint rotation keeps the owner and retires the old row.
const mockClient = { query: jest.fn(), release: jest.fn() };
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn(() => Promise.resolve(mockClient)) }));
jest.mock('../services/webPushService', () => ({}));
jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
const db = require('../db');
const { rotate } = require('../controllers/webPushController');

function res() {
  const r = { statusCode: 200 };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((b) => { r.body = b; return r; });
  return r;
}
const body = { oldEndpoint: 'https://push.example/old', endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } };

beforeEach(() => { jest.clearAllMocks(); mockClient.query.mockReset(); db.query.mockReset(); });

test('moves the subscription to the new endpoint under the same user', async () => {
  mockClient.query.mockImplementation(async (sql) => {
    if (/SELECT user_id/.test(sql)) return { rows: [{ user_id: 'u1', device_label: 'Mac', user_agent: 'UA' }] };
    return { rows: [], rowCount: 1 };
  });
  const r = res();
  await rotate({ body }, r);
  expect(r.body).toEqual({ rotated: true });
  const insert = mockClient.query.mock.calls.find(([sql]) => /INSERT INTO push_subscriptions/.test(sql));
  expect(insert[1].slice(0, 2)).toEqual(['u1', 'https://push.example/new']);
  expect(mockClient.query.mock.calls.some(([sql, p]) => /SET active = FALSE/.test(sql) && p[0] === body.oldEndpoint)).toBe(true);
  expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
});

test('an unknown old endpoint is a 404 and creates nothing', async () => {
  mockClient.query.mockImplementation(async (sql) => (/SELECT user_id/.test(sql) ? { rows: [] } : { rows: [] }));
  const r = res();
  await rotate({ body }, r);
  expect(r.statusCode).toBe(404);
  expect(mockClient.query.mock.calls.some(([sql]) => /INSERT INTO/.test(sql))).toBe(false);
});

test('rejects non-https endpoints and missing keys', async () => {
  const r1 = res();
  await rotate({ body: { ...body, endpoint: 'http://evil' } }, r1);
  expect(r1.statusCode).toBe(400);
  const r2 = res();
  await rotate({ body: { ...body, keys: {} } }, r2);
  expect(r2.statusCode).toBe(400);
});
