/**
 * __tests__/setup.js
 *
 * Shared test utilities for the OxSteed API test suite.
 *
 * Tests run against an isolated in-memory mock of the DB and external services
 * (Stripe, S3, Twilio, etc.) so no real network calls are made and no real
 * database is required to run the test suite locally or in CI.
 *
 * The express app is imported WITHOUT starting the HTTP server (the server
 * calls httpServer.listen inside index.js, which we deliberately avoid in
 * tests — instead we export a separate `createApp` factory).
 */

'use strict';

// Set test env vars BEFORE any module is required
process.env.NODE_ENV        = 'test';
process.env.JWT_SECRET      = 'test-jwt-secret-min-32-chars-long!!';
process.env.DATABASE_URL    = 'postgresql://test:test@localhost/test_db';
process.env.STRIPE_SECRET_KEY    = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
process.env.LOG_LEVEL       = 'error'; // suppress info/debug noise in tests

// ── Mock pg pool ─────────────────────────────────────────────────────────────
// We expose a jest mock so individual tests can override query responses.
jest.mock('pg', () => {
  const mockQuery = jest.fn();
  const mockRelease = jest.fn();
  const mockConnect = jest.fn().mockResolvedValue({
    query:   mockQuery,
    release: mockRelease,
  });

  const Pool = jest.fn().mockImplementation(() => ({
    query:   mockQuery,
    connect: mockConnect,
    end:     jest.fn().mockResolvedValue(undefined),
    on:      jest.fn(),
  }));

  Pool.mockQuery   = mockQuery;
  Pool.mockConnect = mockConnect;
  Pool.mockRelease = mockRelease;

  return { Pool };
});

// ── Mock external services ────────────────────────────────────────────────────
jest.mock('../utils/email',  () => ({ sendOTPEmail: jest.fn().mockResolvedValue(true), sendPasswordResetEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('../utils/sms',    () => ({ sendOTPSMS:   jest.fn().mockResolvedValue(true) }));
jest.mock('../services/socketService', () => ({ init: jest.fn(), emit: jest.fn() }));
jest.mock('../services/feeService',    () => ({ reloadFeeConfig: jest.fn().mockResolvedValue(true), getFeeConfig: jest.fn().mockReturnValue({ platform_fee_pct: 10 }) }));
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { create: jest.fn(), capture: jest.fn() },
    customers:      { create: jest.fn(), retrieve: jest.fn() },
    webhooks:       { constructEvent: jest.fn() },
  }));
});
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(), set: jest.fn(), del: jest.fn(), on: jest.fn(),
  }));
});

// ── Export pg mock handle ─────────────────────────────────────────────────────
const { Pool } = require('pg');
const mockQuery = Pool.mockQuery;

/**
 * Reset all mocks between tests.
 * Call in beforeEach() for tests that need a clean slate.
 */
function resetMocks() {
  mockQuery.mockReset();
}

module.exports = { mockQuery, resetMocks };
