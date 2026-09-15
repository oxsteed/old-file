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
    expect(result.checks.creditLedger).toMatchObject({ ok: true, configured: true });
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedisUrl;
  });

  test('exposes the configured non-secret release identifier for deployment checks', async () => {
    const previousRelease = process.env.SENTRY_RELEASE;
    const previousCommit = process.env.COMMIT_SHA;
    process.env.SENTRY_RELEASE = 'release-2026-09-14';
    delete process.env.COMMIT_SHA;
    const files = expectedMigrationFiles();
    const pool = {
      query: jest.fn(async (sql) => sql.includes('_migrations')
        ? { rows: files.map((filename) => ({ filename })) }
        : { rows: [{ '?column?': 1 }] }),
    };

    const result = await checkReadiness({ pool, redis: null });

    expect(result.release).toBe('release-2026-09-14');
    if (previousRelease === undefined) delete process.env.SENTRY_RELEASE;
    else process.env.SENTRY_RELEASE = previousRelease;
    if (previousCommit === undefined) delete process.env.COMMIT_SHA;
    else process.env.COMMIT_SHA = previousCommit;
  });

  test('falls back to the source commit when Sentry release is not supplied', async () => {
    const previousRelease = process.env.SENTRY_RELEASE;
    const previousCommit = process.env.COMMIT_SHA;
    delete process.env.SENTRY_RELEASE;
    process.env.COMMIT_SHA = 'commit-2026-09-14';
    const files = expectedMigrationFiles();
    const pool = {
      query: jest.fn(async (sql) => sql.includes('_migrations')
        ? { rows: files.map((filename) => ({ filename })) }
        : { rows: [{ '?column?': 1 }] }),
    };

    const result = await checkReadiness({ pool, redis: null });

    expect(result.release).toBe('commit-2026-09-14');
    if (previousRelease === undefined) delete process.env.SENTRY_RELEASE;
    else process.env.SENTRY_RELEASE = previousRelease;
    if (previousCommit === undefined) delete process.env.COMMIT_SHA;
    else process.env.COMMIT_SHA = previousCommit;
  });

  test('falls back to Coolify source commit when generic commit SHA is not supplied', async () => {
    const previous = {
      SENTRY_RELEASE: process.env.SENTRY_RELEASE,
      COMMIT_SHA: process.env.COMMIT_SHA,
      SOURCE_COMMIT: process.env.SOURCE_COMMIT,
    };
    delete process.env.SENTRY_RELEASE;
    delete process.env.COMMIT_SHA;
    process.env.SOURCE_COMMIT = 'coolify-source-2026-09-14';
    const files = expectedMigrationFiles();
    const pool = {
      query: jest.fn(async (sql) => sql.includes('_migrations')
        ? { rows: files.map((filename) => ({ filename })) }
        : { rows: [{ '?column?': 1 }] }),
    };

    const result = await checkReadiness({ pool, redis: null });

    expect(result.release).toBe('coolify-source-2026-09-14');
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  test('reports not_ready when production release metadata is missing', async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      SENTRY_RELEASE: process.env.SENTRY_RELEASE,
      COMMIT_SHA: process.env.COMMIT_SHA,
      SOURCE_COMMIT: process.env.SOURCE_COMMIT,
    };
    process.env.NODE_ENV = 'production';
    delete process.env.SENTRY_RELEASE;
    delete process.env.COMMIT_SHA;
    delete process.env.SOURCE_COMMIT;
    const files = expectedMigrationFiles();
    const pool = {
      query: jest.fn(async (sql) => sql.includes('_migrations')
        ? { rows: files.map((filename) => ({ filename })) }
        : { rows: [{ '?column?': 1 }] }),
    };

    const result = await checkReadiness({ pool, redis: null });

    expect(result.status).toBe('not_ready');
    expect(result.release).toBeNull();
    expect(result.checks.release).toEqual({ ok: false, error: 'release identifier is missing' });

    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
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

  test('reports unsafe production configuration through readiness', async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET,
    };
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'dev-jwt-secret-min-32-characters-long!!';
    const pool = {
      query: jest.fn(async (sql) => sql.includes('_migrations')
        ? { rows: expectedMigrationFiles().map((filename) => ({ filename })) }
        : { rows: [{ '?column?': 1 }] }),
    };

    const result = await checkReadiness({ pool, redis: null });

    expect(result.status).toBe('not_ready');
    expect(result.checks.productionConfiguration).toEqual({
      ok: false,
      error: 'unsafe production environment configuration',
    });

    process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous.JWT_SECRET;
  });

  test('requires the dedicated Credit ledger secret in production', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDedicatedSecret = process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;

    const pool = {
      query: jest.fn(async (sql) => sql.includes('_migrations')
        ? { rows: expectedMigrationFiles().map((filename) => ({ filename })) }
        : { rows: [{ '?column?': 1 }] }),
    };
    const result = await checkReadiness({ pool, redis: null });

    expect(result.status).toBe('not_ready');
    expect(result.checks.creditLedger).toMatchObject({ ok: false, configured: false, dedicatedSecret: false });

    process.env.NODE_ENV = previousNodeEnv;
    if (previousDedicatedSecret === undefined) delete process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
    else process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET = previousDedicatedSecret;
  });

  test('rejects an invalid Credit ledger rotation keyring before accepting traffic', async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      OXSTEED_CREDIT_LEDGER_HMAC_SECRET: process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET,
      OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION: process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION,
      OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON: process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON,
    };
    process.env.NODE_ENV = 'production';
    process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET = 'credit-current-ledger-secret-32-chars!!';
    process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION = 'v2';
    process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON = '{not-json';
    const pool = {
      query: jest.fn(async (sql) => sql.includes('_migrations')
        ? { rows: expectedMigrationFiles().map((filename) => ({ filename })) }
        : { rows: [{ '?column?': 1 }] }),
    };

    const result = await checkReadiness({ pool, redis: null });

    expect(result.status).toBe('not_ready');
    expect(result.checks.creditLedger).toMatchObject({ ok: false, dedicatedSecret: true });
    expect(result.checks.creditLedger.error).toContain('valid JSON');

    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  test('requires shared Redis before an enabled Credit rail can receive traffic', async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      REDIS_URL: process.env.REDIS_URL,
      OXSTEED_CREDIT_LEDGER_HMAC_SECRET: process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET,
    };
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;
    process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET = 'credit-current-ledger-secret-32-chars!!';

    const files = expectedMigrationFiles();
    const pool = {
      query: jest.fn(async (sql) => {
        if (sql.includes('_migrations')) return { rows: files.map((filename) => ({ filename })) };
        if (sql.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
        return { rows: [{ '?column?': 1 }] };
      }),
    };

    const result = await checkReadiness({ pool, redis: null });

    expect(result.status).toBe('not_ready');
    expect(result.checks.creditRail).toMatchObject({
      ok: false,
      enabled: true,
      requiresSharedRedis: true,
    });
    expect(result.checks.creditRail.error).toContain('Shared Redis');

    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  test('requires server error monitoring before an enabled production Credit rail can receive traffic', async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      REDIS_URL: process.env.REDIS_URL,
      OXSTEED_CREDIT_LEDGER_HMAC_SECRET: process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET,
      SENTRY_DSN: process.env.SENTRY_DSN,
      SENTRY_ENABLED: process.env.SENTRY_ENABLED,
    };
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = 'redis://configured';
    process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET = 'credit-current-ledger-secret-32-chars!!';
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_ENABLED;

    const pool = {
      query: jest.fn(async (sql) => {
        if (sql.includes('_migrations')) return { rows: expectedMigrationFiles().map((filename) => ({ filename })) };
        if (sql.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
        return { rows: [{ '?column?': 1 }] };
      }),
    };

    const result = await checkReadiness({ pool, redis: { ping: jest.fn().mockResolvedValue('PONG') } });

    expect(result.status).toBe('not_ready');
    expect(result.checks.creditRail).toMatchObject({
      ok: false,
      enabled: true,
      requiresSharedRedis: true,
      error: 'Server error monitoring is required before enabling OxSteed Credit',
    });

    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
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
