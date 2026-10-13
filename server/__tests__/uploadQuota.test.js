'use strict';

// Unit tests for middleware/uploadQuota.js (review P3-6-F13).
// The pg pool is globally mocked in __tests__/setup.js; mockQuery controls
// the quota store responses per test.

const { resetMocks, mockQuery } = require('./setup');
const quota = require('../middleware/uploadQuota');
const enforceUploadQuota = quota.enforceUploadQuota;

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  delete process.env.UPLOAD_DAILY_QUOTA_BYTES;
});

test('passes through when no files are present', async () => {
  const next = jest.fn();
  await enforceUploadQuota({ file: undefined, files: undefined }, response(), next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('reserves bytes against the user quota key', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ bytes_used: '100' }] });
  const req = {
    user: { id: 'user-42' },
    file: { buffer: Buffer.alloc(50), size: 50 },
  };
  const next = jest.fn();
  await enforceUploadQuota(req, response(), next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockQuery).toHaveBeenCalledTimes(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toMatch(/upload_daily_quotas/);
  expect(params[0]).toBe('user:user-42');
  expect(params[1]).toBe(50);
});

test('falls back to the client IP for unauthenticated uploads', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ bytes_used: '10' }] });
  const req = { ip: '203.0.113.7', file: { buffer: Buffer.alloc(10) } };
  const next = jest.fn();
  await enforceUploadQuota(req, response(), next);
  expect(mockQuery.mock.calls[0][1][0]).toBe('ip:203.0.113.7');
  expect(next).toHaveBeenCalledTimes(1);
});

test('rejects with 429 when the reservation exceeds the quota', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ bytes_used: String(2 * 1024 * 1024 * 1024) }] });
  const req = { user: { id: 'u1' }, file: { buffer: Buffer.alloc(10) } };
  const res = response();
  const next = jest.fn();
  await enforceUploadQuota(req, res, next);
  expect(res.status).toHaveBeenCalledWith(429);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'upload_quota_exceeded' }));
  expect(next).not.toHaveBeenCalled();
});

test('honors UPLOAD_DAILY_QUOTA_BYTES', async () => {
  process.env.UPLOAD_DAILY_QUOTA_BYTES = '100';
  // The upsert returns the post-increment total: 90 prior + 20 new = 110 > 100.
  mockQuery.mockResolvedValueOnce({ rows: [{ bytes_used: '110' }] });
  const req = { user: { id: 'u1' }, file: { buffer: Buffer.alloc(20) } };
  const res = response();
  await enforceUploadQuota(req, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(429);
  expect(quota.dailyQuotaBytes()).toBe(100);
});

test('fails open when the quota store is unreachable', async () => {
  mockQuery.mockRejectedValueOnce(new Error('connection refused'));
  const req = { user: { id: 'u1' }, file: { buffer: Buffer.alloc(10) } };
  const next = jest.fn();
  await enforceUploadQuota(req, response(), next);
  expect(next).toHaveBeenCalledTimes(1);
});

test('fileBytes counts disk-storage uploads via file.size', () => {
  expect(quota.fileBytes({ buffer: Buffer.alloc(7) })).toBe(7);
  expect(quota.fileBytes({ path: '/tmp/x', size: 12345 })).toBe(12345);
  expect(quota.fileBytes(null)).toBe(0);
});

test('quotaKeyFor prefers the authenticated user', () => {
  expect(quota.quotaKeyFor({ user: { id: 'abc' } })).toBe('user:abc');
  expect(quota.quotaKeyFor({ ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
});
