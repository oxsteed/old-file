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
 * tests - instead we export a separate `createApp` factory).
 */

'use strict';

// Set test env vars BEFORE any module is required
process.env.NODE_ENV        = 'test';
process.env.JWT_SECRET      = 'test-jwt-secret-min-32-chars-long!!';
process.env.ENCRYPTION_KEY  = 'a'.repeat(64); // 32-byte key encoded as 64 hex characters
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
jest.mock('../utils/email',  () => ({
  sendOTPEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  sendEmail: jest.fn().mockResolvedValue({ success: true, id: 'email-test' }),
  EMAIL_ADDRESSES: { support: 'support@oxsteed.com' },
}));
jest.mock('../utils/sms',    () => ({ sendOTPSMS:   jest.fn().mockResolvedValue(true) }));
jest.mock('../services/socketService', () => ({
  init: jest.fn(),
  emit: jest.fn(),
  broadcastToConversation: jest.fn(),
}));
jest.mock('../services/feeService',    () => ({ reloadFeeConfig: jest.fn().mockResolvedValue(true), getFeeConfig: jest.fn().mockReturnValue({ platform_fee_pct: 10 }) }));
jest.mock('../services/tokenRevocationService', () => ({
  isRevoked: jest.fn().mockResolvedValue(false),
  revokeAccessToken: jest.fn().mockResolvedValue(undefined),
  revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
  revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
}));

// The production TOTP adapter currently ships an ESM-only transitive module.
// Unit tests exercise our 2FA contracts, not that dependency's implementation,
// so keep the CommonJS Jest runtime isolated from the package loader.
jest.mock('@otplib/v12-adapter', () => ({
  authenticator: {
    verify: jest.fn().mockReturnValue(true),
    generateSecret: jest.fn().mockReturnValue('TESTSECRET'),
    keyuri: jest.fn().mockReturnValue('otpauth://totp/OxSteed:test@example.com?secret=TESTSECRET'),
  },
}));

// Avoid fire-and-forget DB work inside authController.register() from consuming
// the pg mock call queue unpredictably in tests.
jest.mock('../controllers/templateController', () => ({
  grantFreeTrialToUser: jest.fn().mockResolvedValue(true),
}));

// withTransaction uses pool.connect(); the pg mock has no real connections.
// Run the operation callback with pool.query bound as the client so tests queue mocks linearly.
jest.mock('../utils/transaction', () => {
  const actual = jest.requireActual('../utils/transaction');
  const runWithClient = async (pool, operation) => {
    const client = {
      query: (text, vals) => pool.query(text, vals),
      release: () => {},
    };
    return operation(client);
  };
  return {
    ...actual,
    withTransaction: runWithClient,
    withJobTransaction: runWithClient,
    withPaymentTransaction: runWithClient,
    withSubscriptionTransaction: runWithClient,
  };
});
jest.mock('../services/paymentQueue', () => ({ queuePaymentCapture: jest.fn().mockResolvedValue('job-123'), addJob: jest.fn().mockResolvedValue('job-id'), getNextJob: jest.fn(), retryJob: jest.fn(), deadLetterJob: jest.fn(), completeJob: jest.fn() }));
jest.mock('stripe', () => {
  const mockInstance = {
    paymentIntents: { create: jest.fn(), capture: jest.fn() },
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
    customers:      { create: jest.fn(), retrieve: jest.fn() },
    prices:         { create: jest.fn() },
    subscriptions:  { retrieve: jest.fn() },
    accounts:       { create: jest.fn(), retrieve: jest.fn() },
    accountLinks:   { create: jest.fn().mockResolvedValue({ url: 'https://stripe.com/onboard' }) },
    webhooks:       { constructEvent: jest.fn() },
  };
  const stripe = jest.fn().mockImplementation(() => mockInstance);
  // Expose instance so tests can import stripe() and get the same mock
  stripe.__mockInstance = mockInstance;
  return stripe;
});
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(), set: jest.fn(), del: jest.fn(), on: jest.fn(),
    lpush: jest.fn(), lrange: jest.fn(), lrem: jest.fn(), eval: jest.fn(), rpop: jest.fn(),
    zadd: jest.fn(), zrangebyscore: jest.fn(), zrem: jest.fn(), setex: jest.fn(),
    ping: jest.fn(), quit: jest.fn(),
  }));
});
jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn().mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' }),
}));

// ── Export pg mock handle ─────────────────────────────────────────────────────
const { Pool } = require('pg');
const mockQuery = Pool.mockQuery;

/**
 * Reset all mocks between tests.
 * Call in beforeEach() for tests that need a clean slate.
 */
function resetMocks() {
  mockQuery.mockReset();
  // Default empty result so tests only need to mock the DB calls they care about.
  // This prevents incidental extra queries (BEGIN/COMMIT, optional lookups, etc.)
  // from turning into TypeErrors due to `undefined.rows`.
  mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
}

module.exports = { mockQuery, resetMocks };
