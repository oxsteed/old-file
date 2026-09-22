'use strict';

const { assertAllowedTarget } = require('../scripts/verify-isolated-app-recovery');

const isolatedEnv = {
  NODE_ENV: 'test',
  CREDIT_TEST_OUTAGE_MODE: 'true',
  CREDIT_TEST_PROJECT: 'oxsteed-credit-test-20260922t000000z-1234',
};

test('allows only disposable loopback HTTP targets', () => {
  expect(assertAllowedTarget('http://127.0.0.1:32772', isolatedEnv).hostname).toBe('127.0.0.1');
  expect(assertAllowedTarget('http://localhost:32772', isolatedEnv).port).toBe('32772');
  expect(() => assertAllowedTarget('https://oxsteed.com', isolatedEnv)).toThrow(/non-loopback/);
  expect(() => assertAllowedTarget('http://10.0.0.5:32772', isolatedEnv)).toThrow(/non-loopback/);
});

test('requires explicit disposable outage mode and project identity', () => {
  expect(() => assertAllowedTarget('http://127.0.0.1:32772', { ...isolatedEnv, CREDIT_TEST_OUTAGE_MODE: 'false' }))
    .toThrow(/CREDIT_TEST_OUTAGE_MODE/);
  expect(() => assertAllowedTarget('http://127.0.0.1:32772', { ...isolatedEnv, CREDIT_TEST_PROJECT: 'production' }))
    .toThrow(/disposable isolated project/);
});
