'use strict';

/**
 * Admin-ops audit 2026-11-02, track T3 (money UI): reproduction tests for
 * items 3, 4, and 11.
 *
 * - Item 3: a top-up lookup endpoint must exist so the clawback dialog can
 *   preview amount, restaurant, and status before any step-up is issued.
 *   It is permission-gated with the same manage_financials grant family as
 *   the approvals page, returns 404 for unknown ids, and 400 for malformed
 *   ids instead of leaking a database error.
 * - Item 4: a transfer-recipient lookup endpoint must exist so the review
 *   panel can show a display name. It returns the name only (never an
 *   email), only for active customer accounts, and 404s otherwise.
 * - Item 11 (fee-quote failure) is covered client-side by the transfer
 *   review gates (see client/src/lib/transferReviewGuards.test.mjs): the
 *   review/confirm buttons stay disabled until a quote succeeds.
 */

const { mockQuery, resetMocks } = require('./setup');

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const TOPUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const capturedPermissions = [];
jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, _res, next) => {
    req.user = { id: ADMIN_ID, role: 'super_admin' };
    req.isSuper = true;
    req.isSuperAdmin = true;
    next();
  },
  requirePermission: (perm) => (_req, _res, next) => {
    capturedPermissions.push(perm);
    next();
  },
  requireSuperAdminOrPermission: (perm) => (_req, _res, next) => {
    capturedPermissions.push(perm);
    if (globalThis.__t3DenyGrant) return _res.status(403).json({ message: 'Forbidden' });
    next();
  },
  requireSuperAdmin: (_req, _res, next) => next(),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: CUSTOMER_ID, role: 'customer' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../middleware/errorHandler');
const adminRestaurantTopupRoutes = require('../routes/adminRestaurantTopups');
const oxsteedCreditRoutes = require('../routes/oxsteedCredit');

function buildAdminApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/restaurant-topups', adminRestaurantTopupRoutes);
  app.use(errorHandler);
  return app;
}

function buildCreditApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/oxsteed-credit', oxsteedCreditRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  capturedPermissions.length = 0;
  globalThis.__t3DenyGrant = false;
});

afterEach(() => {
  globalThis.__t3DenyGrant = false;
});

describe('item 3: restaurant top-up lookup for the clawback preview', () => {
  const topupRow = {
    id: TOPUP_ID,
    restaurant_id: 7,
    amount_cents: 5000,
    currency: 'USD',
    status: 'succeeded',
    created_at: '2026-10-01T14:00:00.000Z',
    restaurant_name: 'Test Kitchen',
  };

  test('returns amount, restaurant, and status for a known top-up', async () => {
    mockQuery.mockImplementation((sql) => {
      if (String(sql).includes('FROM restaurant_topups t')) {
        return Promise.resolve({ rows: [topupRow], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const response = await request(buildAdminApp()).get(`/api/admin/restaurant-topups/topups/${TOPUP_ID}`);
    expect(response.status).toBe(200);
    expect(response.body.topup).toMatchObject({
      id: TOPUP_ID,
      restaurantId: '7',
      restaurantName: 'Test Kitchen',
      amountCents: 5000,
      currency: 'USD',
      status: 'succeeded',
    });
    // No customer or wallet details leak through the preview.
    expect(response.body.topup).not.toHaveProperty('user_id');
    expect(response.body.topup).not.toHaveProperty('userId');
  });

  test('is gated on the manage_financials grant family', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await request(buildAdminApp()).get(`/api/admin/restaurant-topups/topups/${TOPUP_ID}`);
    expect(capturedPermissions).toContain('manage_financials');
  });

  test('a caller without the grant never reaches the lookup', async () => {
    globalThis.__t3DenyGrant = true;
    const response = await request(buildAdminApp()).get(`/api/admin/restaurant-topups/topups/${TOPUP_ID}`);
    expect(response.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('unknown top-up returns 404, not an empty preview', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const response = await request(buildAdminApp()).get(`/api/admin/restaurant-topups/topups/${TOPUP_ID}`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('restaurant_topup_not_found');
  });

  test('malformed id returns 400 without touching the database', async () => {
    const response = await request(buildAdminApp()).get('/api/admin/restaurant-topups/topups/not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('restaurant_topup_id_invalid');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('item 4: transfer recipient lookup for the review panel', () => {
  test('returns the display name only, never an email address', async () => {
    const seenSql = [];
    mockQuery.mockImplementation((sql) => {
      seenSql.push(String(sql));
      return Promise.resolve({ rows: [{ id: OTHER_CUSTOMER_ID, first_name: 'Ada', last_name: 'Example' }], rowCount: 1 });
    });
    const response = await request(buildCreditApp()).get(`/api/oxsteed-credit/transfer-recipients/${OTHER_CUSTOMER_ID}`);
    expect(response.status).toBe(200);
    expect(response.body.recipient).toEqual({ customerId: OTHER_CUSTOMER_ID, displayName: 'Ada Example' });
    expect(JSON.stringify(response.body)).not.toContain('@');
    // The lookup mirrors the transfer recipient check: active customers only.
    expect(seenSql.join('\n')).toContain("role = 'customer'");
    expect(seenSql.join('\n')).toContain('is_active');
  });

  test('unknown recipient returns the same 404 the transfer POST returns', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const response = await request(buildCreditApp()).get(`/api/oxsteed-credit/transfer-recipients/${OTHER_CUSTOMER_ID}`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('credit_recipient_not_found');
  });

  test('malformed id returns 400 without touching the database', async () => {
    const response = await request(buildCreditApp()).get('/api/oxsteed-credit/transfer-recipients/not-a-uuid');
    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
