'use strict';

// DB test for the upload quota ledger (review P3-6-F13, migration 822).
// Exercises the real atomic check-and-reserve against PostgreSQL.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schema = `upload_quota_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Upload quota fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../middleware/uploadQuota');
const db = require('../db');
const quota = require('../middleware/uploadQuota');
const describeDb = url ? describe : describe.skip;

describeDb('upload daily quota ledger (migration 822)', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/822_upload_daily_quotas.sql'), 'utf8'));
  });
  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });
  beforeEach(async () => {
    await db.query('DELETE FROM upload_daily_quotas');
  });

  test('reserveQuota accumulates bytes and reports the post-increment total', async () => {
    expect(await quota.reserveQuota('user:1', 100, 1000)).toBe(true);
    expect(await quota.reserveQuota('user:1', 200, 1000)).toBe(true);
    const { rows } = await db.query('SELECT bytes_used FROM upload_daily_quotas WHERE user_key = $1', ['user:1']);
    expect(Number(rows[0].bytes_used)).toBe(300);
  });

  test('reserveQuota returns false once the quota is exceeded', async () => {
    expect(await quota.reserveQuota('user:2', 900, 1000)).toBe(true);
    expect(await quota.reserveQuota('user:2', 200, 1000)).toBe(false);
  });

  test('quotas are per key and per day', async () => {
    expect(await quota.reserveQuota('user:3', 100, 1000)).toBe(true);
    expect(await quota.reserveQuota('ip:1.2.3.4', 100, 1000)).toBe(true);
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM upload_daily_quotas');
    expect(rows[0].n).toBe(2);
  });

  test('concurrent reservations do not lose bytes', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => quota.reserveQuota('user:4', 10, 100000))
    );
    expect(results.every(Boolean)).toBe(true);
    const { rows } = await db.query('SELECT bytes_used FROM upload_daily_quotas WHERE user_key = $1', ['user:4']);
    expect(Number(rows[0].bytes_used)).toBe(200);
  });

  test('enforceUploadQuota middleware rejects over-quota uploads with 429', async () => {
    process.env.UPLOAD_DAILY_QUOTA_BYTES = '1000';
    try {
      await quota.reserveQuota('user:5', 1000, quota.dailyQuotaBytes());
      const req = { user: { id: '5' }, file: { buffer: Buffer.alloc(10) } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();
      await quota.enforceUploadQuota(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(next).not.toHaveBeenCalled();
    } finally {
      delete process.env.UPLOAD_DAILY_QUOTA_BYTES;
    }
  });
});
