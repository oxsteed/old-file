const { validateReadinessPayload } = require('../scripts/verify-readiness-payload');

function healthyPayload() {
  return {
    status: 'ready',
    release: 'release-2026-09-14',
    checks: {
      productionConfiguration: { ok: true },
      database: { ok: true },
      migrations: { ok: true, pendingCount: 0 },
      redis: { ok: true, configured: true },
      creditLedger: { ok: true, configured: true, dedicatedSecret: true, keyVersion: 'v1' },
      creditRail: { ok: true },
      realtime: { ok: true },
      workers: { ok: true },
      traffic: { ok: true },
      shutdown: { ok: true },
    },
  };
}

describe('post-deploy readiness payload validation', () => {
  test('accepts a fully healthy release payload', () => {
    expect(validateReadinessPayload(healthyPayload())).toEqual({ ok: true, failures: [] });
  });

  test('rejects a healthy old deployment with no release identifier', () => {
    const payload = healthyPayload();
    delete payload.release;

    expect(validateReadinessPayload(payload)).toMatchObject({
      ok: false,
      failures: ['release identifier is missing'],
    });
  });

  test('rejects pending migrations and missing shared Redis', () => {
    const payload = healthyPayload();
    payload.checks.migrations.pendingCount = 1;
    payload.checks.redis.configured = false;

    const result = validateReadinessPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      'shared Redis is not configured',
      'pending migrations are not zero',
    ]));
  });

  test('rejects unsafe production configuration', () => {
    const payload = healthyPayload();
    payload.checks.productionConfiguration = {
      ok: false,
      error: 'unsafe production environment configuration',
    };

    expect(validateReadinessPayload(payload)).toEqual({
      ok: false,
      failures: ['productionConfiguration readiness check is not healthy'],
    });
  });
});
