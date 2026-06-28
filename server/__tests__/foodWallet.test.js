'use strict';
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const foodController = require('../controllers/foodController');
const walletController = require('../controllers/foodWalletController');
const {
  verifyWalletIntegrityForCustomer,
  computeWalletEntryHash,
  CURRENT_WALLET_HASH_ALGORITHM,
  LEGACY_WALLET_HASH_ALGORITHM,
} = require('../services/foodWalletService');

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';
const OWNER_ID = '00000000-0000-4000-8000-000000000123';
const RESTAURANT_ID = 3;
const BUSINESS_ID = 42;
const ACCOUNT_ID = 55;
const MENU_ITEM_ID = 11;

function restaurantRow() {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    display_name: 'Ox Burger Lab',
    status: 'active',
    accepts_online_orders: true,
    accepts_in_store_orders: true,
    currency_code: 'USD',
    prep_time_min: 12,
    operating_hours: null,
    timezone: 'America/New_York',
    fulfillment_modes: ['pickup', 'delivery'],
    delivery_radius_meters: null,
    latitude: null,
    longitude: null,
  };
}

function buildOrderApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: CUSTOMER_ID, email: 'guest@example.com' };
    next();
  });
  app.post('/api/food/restaurants/:restaurantId/orders', foodController.createOrder);
  app.use(errorHandler);
  return app;
}

function buildMerchantApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: OWNER_ID, email: 'owner@example.com' };
    next();
  });
  app.patch('/api/food/restaurants/:restaurantId/orders/:orderId/status', foodController.updateOrderStatus);
  app.post('/api/food/restaurants/:restaurantId/customer-wallet-loads', walletController.loadCustomerWallet);
  app.get('/api/food/restaurants/:restaurantId/customer-wallet-integrity', walletController.verifyCustomerWalletIntegrity);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('food wallet security wiring', () => {
  test('createOrder uses wallet credit ledger and marks delivery order paid', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/FROM food_restaurants WHERE id = \$1 AND status = 'active' FOR UPDATE/.test(sql)) {
        return { rows: [restaurantRow()] };
      }
      if (/FROM food_menu_items/.test(sql)) {
        return {
          rows: [{
            id: MENU_ITEM_ID,
            name: 'Classic Burger',
            price_cents: 899,
            currency_code: 'USD',
            is_available: true,
          }],
        };
      }
      if (/SELECT COALESCE\(MAX\(queue_number\), 0\) \+ 1 AS next_queue/.test(sql)) {
        return { rows: [{ next_queue: 3 }] };
      }
      if (/INSERT INTO food_orders/.test(sql)) {
        return {
          rows: [{
            id: 200,
            restaurant_id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            customer_id: CUSTOMER_ID,
            fulfillment_type: 'delivery',
            payment_status: 'paid',
            queue_number: 3,
            status: 'received',
            subtotal_cents: 899,
            total_cents: 899,
            metadata: { paymentMode: 'wallet_credit' },
          }],
        };
      }
      if (/INSERT INTO food_order_items/.test(sql)) {
        return { rows: [{ id: 901 }] };
      }
      if (/INSERT INTO food_customer_wallet_accounts/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM food_customer_wallet_accounts a/.test(sql) && /FOR UPDATE/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 2500,
            status: 'active',
            ledger_version: 0,
            last_entry_hash: null,
          }],
        };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql) && /idempotency_key/.test(sql)) {
        return { rows: [] };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql) && /reference_type = \$3/.test(sql)) {
        return { rows: [] };
      }
      if (/UPDATE food_customer_wallet_accounts/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 1601,
            status: 'active',
            ledger_version: 1,
            last_entry_hash: 'hash-1',
            updated_at: new Date().toISOString(),
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_ledger/.test(sql)) {
        return {
          rows: [{
            id: 7001,
            account_id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            entry_type: 'debit',
            amount_cents: 899,
            balance_after_cents: 1601,
            currency_code: 'USD',
            description: 'Order #200 · Delivery',
            reference_type: 'food_order',
            reference_id: '200',
            metadata: { orderId: 200 },
            entry_sequence: 1,
            previous_entry_hash: null,
            entry_hash: 'hash-1',
            posted_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildOrderApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .send({
        fulfillmentType: 'delivery',
        paymentMode: 'wallet_credit',
        deliveryAddress: {
          line1: '123 Main Street',
          city: 'Columbus',
          state: 'Ohio',
          postalCode: '43215',
          country: 'US',
        },
        items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.order.payment_status).toBe('paid');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql))).toBe(true);
  });

  test('cancelled wallet-funded orders write a refund ledger entry', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT fr\.\*, b\.user_id AS business_owner_id/.test(sql) && /JOIN businesses b/.test(sql)) {
        return {
          rows: [{
            id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            owner_user_id: OWNER_ID,
            display_name: 'Ox Burger Lab',
            currency_code: 'USD',
            effective_role: 'owner',
          }],
        };
      }
      if (/UPDATE food_orders/.test(sql)) {
        return {
          rows: [{
            id: 200,
            restaurant_id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            customer_id: CUSTOMER_ID,
            queue_number: 3,
            status: 'cancelled',
            fulfillment_type: 'delivery',
            payment_status: 'refunded',
            currency_code: 'USD',
            metadata: { paymentMode: 'wallet_credit' },
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_accounts/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM food_customer_wallet_accounts a/.test(sql) && /FOR UPDATE/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 1601,
            status: 'active',
            ledger_version: 1,
            last_entry_hash: 'hash-1',
          }],
        };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql) && /entry_type = 'debit'/.test(sql)) {
        return {
          rows: [{
            id: 7001,
            account_id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            entry_type: 'debit',
            amount_cents: 899,
            balance_after_cents: 1601,
            currency_code: 'USD',
            reference_type: 'food_order',
            reference_id: '200',
          }],
        };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql) && /entry_type = 'refund'/.test(sql)) {
        return { rows: [] };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql) && /idempotency_key/.test(sql)) {
        return { rows: [] };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql) && /reference_type = \$3/.test(sql)) {
        return { rows: [] };
      }
      if (/UPDATE food_customer_wallet_accounts/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 2500,
            status: 'active',
            ledger_version: 2,
            last_entry_hash: 'hash-2',
            updated_at: new Date().toISOString(),
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_ledger/.test(sql)) {
        return {
          rows: [{
            id: 7002,
            account_id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            entry_type: 'refund',
            amount_cents: 899,
            balance_after_cents: 2500,
            currency_code: 'USD',
            description: 'Refund for order #3',
            reference_type: 'food_order_refund',
            reference_id: '200',
            metadata: { orderId: 200 },
            entry_sequence: 2,
            previous_entry_hash: 'hash-1',
            entry_hash: 'hash-2',
            posted_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          }],
        };
      }
      if (/UPDATE restaurant_runner_tasks/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildMerchantApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/orders/200/status`)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(res.body.order.payment_status).toBe('refunded');
    expect(res.body.walletRefund).toBeTruthy();
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql))).toBe(true);
  });

  test('wallet integrity audit reports valid chains and flags tampering', async () => {
    const createdAt = new Date('2026-06-28T12:00:00.000Z').toISOString();
    const firstHash = computeWalletEntryHash({
      accountId: ACCOUNT_ID,
      restaurantId: RESTAURANT_ID,
      customerId: CUSTOMER_ID,
      entryType: 'credit',
      amountCents: 1500,
      balanceAfterCents: 1500,
      currencyCode: 'USD',
      sequence: 1,
      previousEntryHash: null,
      referenceType: 'merchant_load',
      referenceId: 'seed-load',
      correlationId: 'seed-load',
      createdByUserId: OWNER_ID,
      actorType: 'restaurant_staff',
      metadata: { source: 'merchant_load' },
    }, CURRENT_WALLET_HASH_ALGORITHM);
    const secondHash = computeWalletEntryHash({
      accountId: ACCOUNT_ID,
      restaurantId: RESTAURANT_ID,
      customerId: CUSTOMER_ID,
      entryType: 'debit',
      amountCents: 400,
      balanceAfterCents: 1100,
      currencyCode: 'USD',
      sequence: 2,
      previousEntryHash: firstHash,
      referenceType: 'food_order',
      referenceId: '200',
      correlationId: 'food-order:200',
      createdByUserId: CUSTOMER_ID,
      actorType: 'customer',
      metadata: { orderId: 200 },
    }, CURRENT_WALLET_HASH_ALGORITHM);

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: ACCOUNT_ID,
          restaurant_id: RESTAURANT_ID,
          customer_id: CUSTOMER_ID,
          restaurant_name: 'Ox Burger Lab',
          restaurant_logo_url: null,
          currency_code: 'USD',
          balance_cents: 1100,
          status: 'active',
          ledger_version: 2,
          last_entry_hash: secondHash,
          updated_at: createdAt,
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            account_id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            entry_type: 'credit',
            amount_cents: 1500,
            balance_after_cents: 1500,
            currency_code: 'USD',
            reference_type: 'merchant_load',
            reference_id: 'seed-load',
            correlation_id: 'seed-load',
            created_by_user_id: OWNER_ID,
            actor_type: 'restaurant_staff',
            metadata: { source: 'merchant_load' },
            entry_sequence: 1,
            previous_entry_hash: null,
            hash_algorithm: CURRENT_WALLET_HASH_ALGORITHM,
            entry_hash: firstHash,
            created_at: createdAt,
          },
          {
            id: 2,
            account_id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            entry_type: 'debit',
            amount_cents: 400,
            balance_after_cents: 1100,
            currency_code: 'USD',
            reference_type: 'food_order',
            reference_id: '200',
            correlation_id: 'food-order:200',
            created_by_user_id: CUSTOMER_ID,
            actor_type: 'customer',
            metadata: { orderId: 200 },
            entry_sequence: 2,
            previous_entry_hash: firstHash,
            hash_algorithm: CURRENT_WALLET_HASH_ALGORITHM,
            entry_hash: secondHash,
            created_at: createdAt,
          },
        ],
      });

    const validAudit = await verifyWalletIntegrityForCustomer(RESTAURANT_ID, CUSTOMER_ID);
    expect(validAudit.valid).toBe(true);
    expect(validAudit.issues).toEqual([]);

    resetMocks();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: ACCOUNT_ID,
          restaurant_id: RESTAURANT_ID,
          customer_id: CUSTOMER_ID,
          restaurant_name: 'Ox Burger Lab',
          restaurant_logo_url: null,
          currency_code: 'USD',
          balance_cents: 9999,
          status: 'active',
          ledger_version: 2,
          last_entry_hash: 'bad-hash',
          updated_at: createdAt,
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            account_id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            entry_type: 'credit',
            amount_cents: 1500,
            balance_after_cents: 1500,
            currency_code: 'USD',
            reference_type: 'merchant_load',
            reference_id: 'seed-load',
            correlation_id: 'seed-load',
            created_by_user_id: OWNER_ID,
            actor_type: 'restaurant_staff',
            metadata: { source: 'merchant_load' },
            entry_sequence: 1,
            previous_entry_hash: null,
            hash_algorithm: LEGACY_WALLET_HASH_ALGORITHM,
            entry_hash: 'tampered-hash',
            created_at: createdAt,
          },
        ],
      });

    const invalidAudit = await verifyWalletIntegrityForCustomer(RESTAURANT_ID, CUSTOMER_ID);
    expect(invalidAudit.valid).toBe(false);
    expect(invalidAudit.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['entry_hash_mismatch', 'account_balance_mismatch', 'ledger_version_mismatch', 'account_last_hash_mismatch'])
    );
  });

  test('merchant wallet loads write an operator audit event', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT fr\.id, fr\.business_id, fr\.owner_user_id/.test(sql)) {
        return {
          rows: [{
            id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            owner_user_id: OWNER_ID,
            display_name: 'Ox Burger Lab',
            currency_code: 'USD',
            effective_role: 'owner',
          }],
        };
      }
      if (/SELECT id, first_name, last_name, email/.test(sql) && /FROM users/.test(sql)) {
        return {
          rows: [{
            id: CUSTOMER_ID,
            first_name: 'Test',
            last_name: 'Customer',
            email: 'customer@example.com',
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_accounts/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      if (/FROM food_customer_wallet_accounts a/.test(sql) && /FOR UPDATE/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 0,
            status: 'active',
            ledger_version: 0,
            last_entry_hash: null,
          }],
        };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql) && /idempotency_key/.test(sql)) {
        return { rows: [] };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql) && /reference_type = \$3/.test(sql)) {
        return { rows: [] };
      }
      if (/UPDATE food_customer_wallet_accounts/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 2500,
            status: 'active',
            ledger_version: 1,
            last_entry_hash: 'hash-1',
            updated_at: new Date().toISOString(),
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_ledger/.test(sql)) {
        return {
          rows: [{
            id: 7005,
            account_id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            entry_type: 'credit',
            amount_cents: 2500,
            balance_after_cents: 2500,
            currency_code: 'USD',
            description: 'Wallet credit loaded at Ox Burger Lab',
            reference_type: 'merchant_load',
            reference_id: 'wallet-load-1',
            metadata: { source: 'merchant_load' },
            entry_sequence: 1,
            previous_entry_hash: null,
            hash_algorithm: CURRENT_WALLET_HASH_ALGORITHM,
            entry_hash: 'hash-1',
            posted_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_operator_audit_events/.test(sql)) {
        return { rows: [{ id: 99, action_type: 'merchant_load' }], rowCount: 1 };
      }
      if (/SELECT a\.\*,\s*fr\.display_name AS restaurant_name/.test(sql) && /WHERE a\.customer_id = \$1/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 2500,
            status: 'active',
            ledger_version: 1,
            last_entry_hash: 'hash-1',
            updated_at: new Date().toISOString(),
            restaurant_name: 'Ox Burger Lab',
            restaurant_logo_url: null,
          }],
        };
      }
      if (/SELECT \*/.test(sql) && /FROM food_customer_wallet_ledger/.test(sql) && /ORDER BY created_at DESC/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildMerchantApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-loads`)
      .send({
        customerId: CUSTOMER_ID,
        amountCents: 2500,
        referenceId: 'wallet-load-1',
        correlationId: 'wallet-load-1',
      });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_operator_audit_events/.test(sql))).toBe(true);
  });

  test('wallet integrity endpoint writes an operator audit event on successful checks', async () => {
    const createdAt = new Date('2026-06-28T12:00:00.000Z').toISOString();
    const firstHash = computeWalletEntryHash({
      accountId: ACCOUNT_ID,
      restaurantId: RESTAURANT_ID,
      customerId: CUSTOMER_ID,
      entryType: 'credit',
      amountCents: 1000,
      balanceAfterCents: 1000,
      currencyCode: 'USD',
      sequence: 1,
      previousEntryHash: null,
      referenceType: 'merchant_load',
      referenceId: 'seed-load',
      correlationId: 'seed-load',
      createdByUserId: OWNER_ID,
      actorType: 'restaurant_staff',
      metadata: { source: 'merchant_load' },
    }, CURRENT_WALLET_HASH_ALGORITHM);

    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT fr\.id, fr\.business_id, fr\.owner_user_id/.test(sql)) {
        return {
          rows: [{
            id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            owner_user_id: OWNER_ID,
            display_name: 'Ox Burger Lab',
            currency_code: 'USD',
            effective_role: 'owner',
          }],
        };
      }
      if (/SELECT id, first_name, last_name, email/.test(sql) && /FROM users/.test(sql)) {
        return {
          rows: [{
            id: CUSTOMER_ID,
            first_name: 'Test',
            last_name: 'Customer',
            email: 'customer@example.com',
          }],
        };
      }
      if (/SELECT a\.\*,\s*fr\.display_name AS restaurant_name/.test(sql) && /WHERE a\.restaurant_id = \$1/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            restaurant_name: 'Ox Burger Lab',
            restaurant_logo_url: null,
            currency_code: 'USD',
            balance_cents: 1000,
            status: 'active',
            ledger_version: 1,
            last_entry_hash: firstHash,
            updated_at: createdAt,
          }],
        };
      }
      if (/SELECT \*/.test(sql) && /FROM food_customer_wallet_ledger/.test(sql) && /ORDER BY entry_sequence ASC/.test(sql)) {
        return {
          rows: [{
            id: 1,
            account_id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            entry_type: 'credit',
            amount_cents: 1000,
            balance_after_cents: 1000,
            currency_code: 'USD',
            reference_type: 'merchant_load',
            reference_id: 'seed-load',
            correlation_id: 'seed-load',
            created_by_user_id: OWNER_ID,
            actor_type: 'restaurant_staff',
            metadata: { source: 'merchant_load' },
            entry_sequence: 1,
            previous_entry_hash: null,
            hash_algorithm: CURRENT_WALLET_HASH_ALGORITHM,
            entry_hash: firstHash,
            created_at: createdAt,
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_operator_audit_events/.test(sql)) {
        return { rows: [{ id: 100, action_type: 'integrity_check' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildMerchantApp())
      .get(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-integrity`)
      .query({ customerId: CUSTOMER_ID });

    expect(res.status).toBe(200);
    expect(res.body.audit.valid).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_operator_audit_events/.test(sql))).toBe(true);
  });

  test('wallet integrity endpoint rejects non-manager business members', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: RESTAURANT_ID,
          business_id: BUSINESS_ID,
          owner_user_id: OWNER_ID,
          display_name: 'Ox Burger Lab',
          currency_code: 'USD',
          effective_role: 'employee',
        }],
      });

    const res = await request(buildMerchantApp())
      .get(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-integrity`)
      .query({ customerId: CUSTOMER_ID });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });
});
