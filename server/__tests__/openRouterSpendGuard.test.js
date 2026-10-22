'use strict';

// OpenRouter spend guardrail: a paid model behind the public chat must not
// become an open spend vector. Daily cap, fail-closed skip, alerting.
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../utils/logger');
const guard = require('../services/openRouterSpendGuard');

const PAID = 'openai/gpt-4o-mini';
const FREE = 'openrouter/free';

function env(overrides = {}) {
  return {
    OPENROUTER_DAILY_SPEND_CAP_USD: '0.02',
    OPENROUTER_ESTIMATED_COST_PER_CALL_USD: '0.01',
    ...overrides,
  };
}

beforeEach(() => {
  guard._resetLocal();
  jest.clearAllMocks();
});

describe('openRouterSpendGuard', () => {
  test('the free router is never gated or counted', async () => {
    const e = env({ OPENROUTER_DAILY_SPEND_CAP_USD: '0' });
    expect(await guard.isOpenRouterAllowed(FREE, e)).toBe(true);
    await guard.recordOpenRouterCall(FREE, e);
    // A paid call afterwards still sees zero accrued spend.
    expect(await guard.isOpenRouterAllowed(PAID, env())).toBe(true);
  });

  test('paid calls accrue and the cap fails closed', async () => {
    const e = env(); // cap 0.02, cost 0.01 per call
    expect(await guard.isOpenRouterAllowed(PAID, e)).toBe(true);
    await guard.recordOpenRouterCall(PAID, e);
    expect(await guard.isOpenRouterAllowed(PAID, e)).toBe(true);
    await guard.recordOpenRouterCall(PAID, e);
    // 0.02 accrued: the next call would exceed the cap.
    expect(await guard.isOpenRouterAllowed(PAID, e)).toBe(false);
  });

  test('cap breach emits the alert exactly once per day', async () => {
    const e = env();
    await guard.recordOpenRouterCall(PAID, e);
    await guard.recordOpenRouterCall(PAID, e);
    await guard.isOpenRouterAllowed(PAID, e);
    await guard.isOpenRouterAllowed(PAID, e);
    const alerts = logger.error.mock.calls.filter(([msg]) => msg === 'openrouter_spend_cap_exceeded');
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).toMatchObject({ capUsd: 0.02 });
  });

  test('env parsing falls back to safe defaults', () => {
    expect(guard.spendCapUsd({})).toBe(5);
    expect(guard.spendCapUsd({ OPENROUTER_DAILY_SPEND_CAP_USD: '25' })).toBe(25);
    expect(guard.spendCapUsd({ OPENROUTER_DAILY_SPEND_CAP_USD: '-3' })).toBe(5);
    expect(guard.estimatedCostPerCallUsd({})).toBe(0.005);
    expect(guard.isPaidModel('openrouter/free')).toBe(false);
    expect(guard.isPaidModel('anthropic/claude-3')).toBe(true);
    expect(guard.isPaidModel('')).toBe(false);
    expect(guard.isPaidModel(null)).toBe(false);
  });

  test('never throws, even when the store fails', async () => {
    await expect(guard.isOpenRouterAllowed(PAID, null)).resolves.toBe(true);
    await expect(guard.recordOpenRouterCall(PAID, null)).resolves.toBeDefined();
  });
});
