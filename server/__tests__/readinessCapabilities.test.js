'use strict';

const runtimeState = require('../services/runtimeState');
const { checkReadiness, expectedMigrationFiles } = require('../services/readinessService');
const { getPublicCapabilities } = require('../services/featureCapabilities');

describe('runtime readiness', () => {
  beforeEach(() => runtimeState.reset());

  test('reports ready only when durable dependencies and runtime services are ready', async () => {
    runtimeState.update({
      acceptingTraffic: true,
      realtimeReady: true,
      workersReady: true,
    });
    const files = expectedMigrationFiles();
    const pool = {
      query: jest.fn(async (sql) => sql.includes('_migrations')
        ? { rows: files.map((filename) => ({ filename })) }
        : { rows: [{ '?column?': 1 }] }),
    };
    const redis = { ping: jest.fn(async () => 'PONG') };
    const previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://configured';

    const result = await checkReadiness({ pool, redis });

    expect(result.status).toBe('ready');
    expect(result.checks.migrations).toMatchObject({ ok: true, pendingCount: 0 });
    expect(result.checks.redis).toMatchObject({ ok: true, configured: true });
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedisUrl;
  });

  test('reports not_ready when a migration is pending or workers are stopped', async () => {
    runtimeState.update({ acceptingTraffic: true, realtimeReady: true, workersReady: false });
    const files = expectedMigrationFiles();
    const pool = {
      query: jest.fn(async (sql) => sql.includes('_migrations')
        ? { rows: files.slice(1).map((filename) => ({ filename })) }
        : { rows: [] }),
    };

    const result = await checkReadiness({ pool, redis: null });

    expect(result.status).toBe('not_ready');
    expect(result.checks.migrations.pendingCount).toBe(1);
    expect(result.checks.workers.ok).toBe(false);
  });
});

describe('public feature capabilities', () => {
  test('exposes availability without exposing credential values', () => {
    const previous = {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
      CHECKR_API_KEY: process.env.CHECKR_API_KEY,
      CHECKR_WEBHOOK_SECRET: process.env.CHECKR_WEBHOOK_SECRET,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    };
    process.env.TWILIO_ACCOUNT_SID = 'secret';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_PHONE_NUMBER = '+15555550100';
    delete process.env.CHECKR_API_KEY;
    delete process.env.CHECKR_WEBHOOK_SECRET;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;

    const capabilities = getPublicCapabilities();

    expect(capabilities.smsOtp.status).toBe('available');
    expect(capabilities.backgroundChecks.status).toBe('unavailable');
    expect(JSON.stringify(capabilities)).not.toContain('secret');

    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });
});
