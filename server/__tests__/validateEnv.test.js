'use strict';

jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const { getProductionConfigurationErrors } = require('../utils/validateEnv');

test('rejects placeholder and test credentials in production', () => {
  const errors = getProductionConfigurationErrors({
    NODE_ENV: 'production',
    JWT_SECRET: 'dev-jwt-secret-min-32-characters-long!!',
    DATABASE_URL: 'postgresql://user:dev-password-change-in-production@postgres/db',
    STRIPE_SECRET_KEY: 'sk_test_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_example',
    ENCRYPTION_KEY: 'a'.repeat(64),
    OXSTEED_CREDIT_LEDGER_HMAC_SECRET: 'dev-credit-ledger-secret-32-chars-long!!',
  });

  expect(errors).toEqual(expect.arrayContaining([
    'JWT_SECRET contains a placeholder value',
    'DATABASE_URL contains a placeholder value',
    'STRIPE_SECRET_KEY must use a live Stripe key in production',
    'STRIPE_WEBHOOK_SECRET must use a live Stripe signing secret in production',
  ]));
});

test('accepts non-placeholder production credentials', () => {
  expect(getProductionConfigurationErrors({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(64),
    DATABASE_URL: 'postgresql://user:strong-random-password@postgres/db',
    STRIPE_SECRET_KEY: 'sk_live_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_live_example',
    ENCRYPTION_KEY: 'b'.repeat(64),
    OXSTEED_CREDIT_LEDGER_HMAC_SECRET: 'c'.repeat(64),
})).toEqual([]);
});

test('requires the dedicated Credit ledger secret in production', () => {
  const errors = getProductionConfigurationErrors({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(64),
    DATABASE_URL: 'postgresql://user:strong-random-password@postgres/db',
    STRIPE_SECRET_KEY: 'sk_live_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_live_example',
    ENCRYPTION_KEY: 'b'.repeat(64),
  });

  expect(errors).toContain('OXSTEED_CREDIT_LEDGER_HMAC_SECRET is required in production');
});

test('does not apply production credential rules to tests', () => {
  expect(getProductionConfigurationErrors({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-min-32-chars-long!!',
    DATABASE_URL: 'postgresql://test:test@localhost/test_db',
    STRIPE_SECRET_KEY: 'sk_test_dummy',
    STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
    ENCRYPTION_KEY: 'a'.repeat(64),
    OXSTEED_CREDIT_LEDGER_HMAC_SECRET: 'dev-credit-ledger-secret-32-chars-long!!',
  })).toEqual([]);
});

test('rejects malformed production database URLs before connection attempts', () => {
  const errors = getProductionConfigurationErrors({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(64),
    DATABASE_URL: 'mysql://user:password@db/oxsteed',
    STRIPE_SECRET_KEY: 'sk_live_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_live_example',
    ENCRYPTION_KEY: 'b'.repeat(64),
    OXSTEED_CREDIT_LEDGER_HMAC_SECRET: 'c'.repeat(64),
  });

  expect(errors).toContain('DATABASE_URL is invalid: DATABASE_URL must use the postgres or postgresql scheme');
});
