'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/restaurantCreditAdminController');

const RESTAURANT_ID = 41;
const ACCOUNT_ID = 9001;
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '22222222-2222-4222-8222-222222222222', role: 'super_admin' };
    next();
  });
  app.get('/overview', controller.getOverview);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('COUNT(*)::int AS total_wallets')) {
      return {
        rows: [{
          total_wallets: 1,
          total_restaurants: 1,
          active_wallets: 1,
          suspended_wallets: 0,
          closed_wallets: 0,
          total_balance_cents: '12500',
          total_reserved_cents: '2500',
          total_available_cents: '10000',
        }],
      };
    }
    if (sql.includes('SELECT COUNT(*)::int AS total')) {
      return { rows: [{ total: 1 }] };
    }
    if (sql.includes('SELECT a.id AS account_id')) {
      return {
        rows: [{
          account_id: ACCOUNT_ID,
          restaurant_id: RESTAURANT_ID,
          restaurant_name: 'Test Restaurant',
          restaurant_status: 'active',
          customer_id: CUSTOMER_ID,
          customer_name: 'Test Customer',
          customer_email: 'customer@example.com',
          currency_code: 'USD',
          balance_cents: '12500',
          reserved_cents: '2500',
          status: 'active',
          ledger_version: '2',
          updated_at: '2026-09-12T10:00:00.000Z',
          last_activity_at: '2026-09-12T10:00:00.000Z',
          last_entry_type: 'credit',
          last_entry_description: 'Approved load',
          pending_load_request_count: 0,
          active_hold_count: 1,
        }],
      };
    }
    if (sql.includes("COUNT(*) FILTER (WHERE r.status = 'pending')")) {
      return { rows: [{ pending_count: 0, approved_count: 2, cancelled_count: 0, expired_count: 0, pending_amount_cents: '0' }] };
    }
    if (sql.includes("COUNT(*) FILTER (WHERE h.status = 'active')")) {
      return { rows: [{ active_count: 1, captured_count: 0, released_count: 0, expired_count: 0, active_amount_cents: '2500' }] };
    }
    if (sql.includes('SELECT l.id, l.account_id')) {
      return { rows: [{ id: 1, account_id: ACCOUNT_ID, restaurant_id: RESTAURANT_ID, customer_id: CUSTOMER_ID, entry_type: 'credit', amount_cents: '12500', balance_after_cents: '12500', currency_code: 'USD', description: 'Approved load', created_at: '2026-09-12T10:00:00.000Z' }] };
    }
    if (sql.includes('SELECT r.*, fr.display_name AS restaurant_name')) {
      return { rows: [] };
    }
    if (sql.includes('SELECT fr.id, fr.display_name AS name')) {
      return { rows: [{ id: RESTAURANT_ID, name: 'Test Restaurant', currency_code: 'USD', wallet_count: 1, active_wallet_count: 1 }] };
    }
    return { rows: [] };
  });
});

test('returns a global restaurant-credit overview contract for super admins', async () => {
  const response = await request(createApp()).get('/overview');

  expect(response.status).toBe(200);
  expect(response.body.pagination).toMatchObject({ page: 1, pageSize: 25, total: 1 });
  expect(response.body.summary).toMatchObject({
    totalWallets: 1,
    totalRestaurants: 1,
    totalBalanceCents: 12500,
    totalReservedCents: 2500,
    totalAvailableCents: 10000,
  });
  expect(response.body.wallets[0]).toMatchObject({
    accountId: String(ACCOUNT_ID),
    customerEmail: 'customer@example.com',
    availableBalanceCents: 10000,
  });
  expect(response.body.restaurants[0]).toMatchObject({ id: String(RESTAURANT_ID), walletCount: 1 });
  expect(response.body.recentActivity[0]).toMatchObject({ entryType: 'credit', amountCents: 12500 });

  const walletQuery = mockQuery.mock.calls.find(([sql]) => String(sql).includes('ORDER BY a.updated_at DESC'));
  expect(walletQuery).toBeTruthy();
  expect(walletQuery[0]).toContain('LIMIT $1 OFFSET $2');
  expect(walletQuery[1]).toEqual([25, 0]);
});

test('rejects an invalid wallet status filter before querying the database', async () => {
  const response = await request(createApp()).get('/overview?status=unknown');

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('validation_failed');
  expect(mockQuery).not.toHaveBeenCalled();
});
