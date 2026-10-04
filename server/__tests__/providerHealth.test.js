'use strict';

/**
 * V2-P1-07 — provider health contract tests.
 *
 * Covers: the registry contract shape (every provider carries capability,
 * owner, alert, retry, circuit breaker, budget, rotation, customer-safe
 * state), the circuit breaker state machine, safe probes (no external
 * network in CI), breaker integration with probes, and the operator
 * controller.
 */

const { resetMocks, mockQuery } = require('./setup');
const { createCircuitBreaker, CIRCUIT_STATES } = require('../utils/providerCircuitBreaker');
const registry = require('../services/providerHealthRegistry');
const controller = require('../controllers/providerHealthController');

const EXPECTED_IDS = ['stripe', 'maps', 'messaging', 'ai', 'scanning', 'storage', 'calendars', 'trackers'];

function responseDouble() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function reqDouble(overrides = {}) {
  return { params: {}, query: {}, body: {}, admin: { id: 7 }, headers: {}, ...overrides };
}

beforeEach(() => {
  resetMocks();
  delete process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_PORT;
});

afterEach(async () => {
  // Leave no tripped breakers behind for other suites.
  for (const id of EXPECTED_IDS) {
    try { await registry.resetProviderCircuit(id); } catch (_) { /* noop */ }
  }
});

describe('provider registry contract', () => {
  test('registers exactly the eight expected providers', () => {
    expect(registry.PROVIDERS.map((p) => p.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  test('every provider carries the full contract', () => {
    for (const p of registry.PROVIDERS) {
      expect(typeof p.name).toBe('string');
      expect(typeof p.category).toBe('string');
      expect(typeof p.owner).toBe('string');
      expect(typeof p.alertChannel).toBe('string');
      expect(Array.isArray(p.dependencies)).toBe(true);
      expect(p.dependencies.length).toBeGreaterThan(0);
      expect(typeof p.customerSafeSummaryKey).toBe('string');
      expect(typeof p.probe).toBe('function');

      expect(Array.isArray(p.capabilities)).toBe(true);
      expect(p.capabilities.length).toBeGreaterThan(0);
      for (const cap of p.capabilities) {
        expect(typeof cap.id).toBe('string');
        expect(registry.FAILURE_MODES).toContain(cap.failureMode);
        expect(typeof cap.labelKey).toBe('string');
        expect(typeof cap.customerSafeKey).toBe('string');
      }

      const r = p.retryPolicy;
      expect(r.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(r.baseDelayMs).toBeGreaterThan(0);
      expect(r.maxDelayMs).toBeGreaterThanOrEqual(r.baseDelayMs);
      expect(['exponential', 'fixed']).toContain(r.backoff);
      expect(typeof r.jitter).toBe('boolean');
      expect(Array.isArray(r.retryOn)).toBe(true);
      expect(r.retryOn.length).toBeGreaterThan(0);

      const cb = p.circuitBreaker;
      expect(cb.failureThreshold).toBeGreaterThanOrEqual(1);
      expect(cb.resetTimeoutMs).toBeGreaterThan(0);
      expect(cb.halfOpenMaxCalls).toBeGreaterThanOrEqual(1);

      expect('monthlyUsd' in p.budget).toBe(true);
      expect(typeof p.budget.noteKey).toBe('string');
      expect('keyRotationDays' in p.rotationPolicy).toBe(true);
      expect(typeof p.rotationPolicy.procedureKey).toBe('string');
    }
  });

  test('status and failure-mode vocabularies are frozen', () => {
    expect(registry.PROVIDER_STATUSES).toEqual(['ok', 'degraded', 'down', 'not_configured', 'unknown']);
    expect(registry.FAILURE_MODES).toEqual(['fail_closed', 'fail_open', 'degraded', 'queued_retry']);
  });
});

describe('circuit breaker', () => {
  test('opens after the failure threshold and fails fast', async () => {
    const breaker = createCircuitBreaker('test-open', { failureThreshold: 3, resetTimeoutMs: 60000 });
    await breaker.recordFailure();
    await breaker.recordFailure();
    let state = await breaker.getState();
    expect(state.state).toBe(CIRCUIT_STATES.CLOSED);

    await breaker.recordFailure();
    state = await breaker.getState();
    expect(state.state).toBe(CIRCUIT_STATES.OPEN);
    expect(state.failures).toBe(3);

    await expect(breaker.execute(async () => 'nope')).rejects.toMatchObject({ code: 'circuit_open' });
  });

  test('half-opens after the reset timeout and closes on success', async () => {
    const breaker = createCircuitBreaker('test-halfopen', { failureThreshold: 1, resetTimeoutMs: 1000, halfOpenMaxCalls: 1 });
    await breaker.recordFailure();
    expect((await breaker.getState()).state).toBe(CIRCUIT_STATES.OPEN);

    await new Promise((r) => setTimeout(r, 1100));
    const result = await breaker.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect((await breaker.getState()).state).toBe(CIRCUIT_STATES.CLOSED);
  });

  test('reopens when a half-open trial fails', async () => {
    const breaker = createCircuitBreaker('test-retrial', { failureThreshold: 1, resetTimeoutMs: 1000, halfOpenMaxCalls: 1 });
    await breaker.recordFailure();
    await new Promise((r) => setTimeout(r, 1100));
    await expect(breaker.execute(async () => { throw new Error('still down'); })).rejects.toThrow('still down');
    expect((await breaker.getState()).state).toBe(CIRCUIT_STATES.OPEN);
  });

  test('reset() clears a tripped breaker', async () => {
    const breaker = createCircuitBreaker('test-reset', { failureThreshold: 1, resetTimeoutMs: 60000 });
    await breaker.recordFailure();
    expect((await breaker.getState()).state).toBe(CIRCUIT_STATES.OPEN);
    await breaker.reset();
    expect((await breaker.getState()).state).toBe(CIRCUIT_STATES.CLOSED);
  });
});

describe('probes', () => {
  test('scanning reports not_configured without CLAMAV_HOST (no network)', async () => {
    const probe = await registry.probeProvider('scanning', { force: true });
    expect(probe.status).toBe('not_configured');
    expect(probe.providerId).toBe('scanning');
  });

  test('scanning reports down on TCP refused (local loopback, no external network)', async () => {
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = '1';
    const probe = await registry.probeProvider('scanning', { force: true });
    expect(probe.status).toBe('down');
  }, 15000);

  test('stripe reports not_configured without a secret key (no network)', async () => {
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const probe = await registry.probeProvider('stripe', { force: true });
      expect(probe.status).toBe('not_configured');
    } finally {
      if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
    }
  });

  test('unknown provider id throws', async () => {
    await expect(registry.probeProvider('nope')).rejects.toThrow('Unknown provider');
  });
});

describe('breaker integration with probes', () => {
  test('consecutive down probes open the circuit (down is not counted as success)', async () => {
    // Deterministic down probe: CLAMAV_HOST points at refused loopback port 1.
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = '1';
    await registry.resetProviderCircuit('scanning');
    try {
      const breaker = registry.getCircuitBreaker('scanning');
      expect((await breaker.getState()).state).toBe(CIRCUIT_STATES.CLOSED);

      const first = await registry.probeProvider('scanning', { force: true });
      expect(first.status).toBe('down');
      expect((await breaker.getState()).failures).toBe(1);

      const second = await registry.probeProvider('scanning', { force: true });
      expect(second.status).toBe('down');
      expect((await breaker.getState()).failures).toBe(2);

      // Third consecutive down probe trips the breaker (failureThreshold: 3).
      const third = await registry.probeProvider('scanning', { force: true });
      expect(third.status).toBe('down');
      expect((await breaker.getState()).state).toBe(CIRCUIT_STATES.OPEN);

      // While open, probes fail fast without touching the provider.
      const fast = await registry.probeProvider('scanning', { force: true });
      expect(fast.status).toBe('down');
      expect(fast.detail).toMatch(/Circuit breaker/);
    } finally {
      delete process.env.CLAMAV_HOST;
      delete process.env.CLAMAV_PORT;
      await registry.resetProviderCircuit('scanning');
    }
  }, 30000);

  test('recorded failures trip the breaker and probes fail fast until reset', async () => {
    await registry.resetProviderCircuit('scanning');
    await registry.recordProviderOutcome('scanning', false);
    await registry.recordProviderOutcome('scanning', false);
    await registry.recordProviderOutcome('scanning', false);

    const breaker = registry.getCircuitBreaker('scanning');
    expect((await breaker.getState()).state).toBe(CIRCUIT_STATES.OPEN);

    const probe = await registry.probeProvider('scanning', { force: true });
    expect(probe.status).toBe('down');
    expect(probe.detail).toMatch(/Circuit breaker/);

    await registry.resetProviderCircuit('scanning');
    const reopened = await registry.probeProvider('scanning', { force: true });
    expect(reopened.status).toBe('not_configured');
  });
});

describe('getAllProviderHealth', () => {
  test('returns all providers with status, detail, and circuit state (no external network)', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const health = await registry.getAllProviderHealth({ force: true });
    expect(health.providers).toHaveLength(8);
    for (const p of health.providers) {
      expect(registry.PROVIDER_STATUSES).toContain(p.status);
      expect(typeof p.detail).toBe('string');
      expect(p.circuit).toMatchObject({ state: expect.any(String) });
      expect(Array.isArray(p.capabilities)).toBe(true);
      expect(p.retryPolicy).toBeDefined();
      expect(p.budget).toBeDefined();
      expect(p.rotationPolicy).toBeDefined();
    }
    expect(typeof health.generatedAt).toBe('string');
  }, 30000);
});

describe('providerHealthController', () => {
  test('listProviders returns the aggregate operator view', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const res = responseDouble();
    await controller.listProviders(reqDouble(), res, (e) => { throw e; });
    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body.providers).toHaveLength(8);
    expect(body.providers[0]).toHaveProperty('owner');
    expect(body.providers[0]).toHaveProperty('alertChannel');
  }, 30000);

  test('getProvider 404s on an unknown provider', async () => {
    const res = responseDouble();
    await controller.getProvider(reqDouble({ params: { id: 'nope' } }), res, (e) => { throw e; });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unknown provider', code: 'unknown_provider' });
  });

  test('resetCircuit resets the breaker and audit-logs the action', async () => {
    await registry.recordProviderOutcome('scanning', false);
    await registry.recordProviderOutcome('scanning', false);
    await registry.recordProviderOutcome('scanning', false);
    expect((await registry.getCircuitBreaker('scanning').getState()).state).toBe(CIRCUIT_STATES.OPEN);

    const res = responseDouble();
    await controller.resetCircuit(reqDouble({ params: { id: 'scanning' } }), res, (e) => { throw e; });
    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body.providerId).toBe('scanning');
    expect(body.circuit.state).toBe(CIRCUIT_STATES.CLOSED);
    expect(mockQuery).toHaveBeenCalled(); // audit log write attempted
  });
});
