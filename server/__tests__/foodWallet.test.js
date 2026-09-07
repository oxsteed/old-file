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
const MANAGER_ID = '00000000-0000-4000-8000-000000000789';
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
  app.get('/api/food/customer/wallets/:restaurantId/integrity', walletController.verifyMyWalletIntegrity);
  app.use(errorHandler);
  return app;
}

function buildUnauthenticatedOrderApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/food/restaurants/:restaurantId/orders', foodController.createOrder);
  app.use(errorHandler);
  return app;
}

function buildMerchantApp(user = { id: OWNER_ID, email: 'owner@example.com' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.patch('/api/food/restaurants/:restaurantId/orders/:orderId/status', foodController.updateOrderStatus);
  app.post('/api/food/restaurants/:restaurantId/customer-wallet-loads', walletController.loadCustomerWallet);
  app.post('/api/food/restaurants/:restaurantId/customer-wallet-load-requests', walletController.loadCustomerWallet);
  app.get('/api/food/restaurants/:restaurantId/customer-wallet-load-requests', walletController.listCustomerWalletLoadRequests);
  app.post('/api/food/restaurants/:restaurantId/customer-wallet-load-requests/:requestId/approve', walletController.approveCustomerWalletLoadRequest);
  app.post('/api/food/restaurants/:restaurantId/customer-wallet-load-requests/:requestId/cancel', walletController.cancelCustomerWalletLoadRequest);
  app.patch('/api/food/restaurants/:restaurantId/customer-wallet-status', walletController.updateCustomerWalletStatus);
  app.get('/api/food/restaurants/:restaurantId/customer-wallet-integrity', walletController.verifyCustomerWalletIntegrity);
  app.get('/api/food/restaurants/:restaurantId/customer-wallet-reconciliation', walletController.getCustomerWalletReconciliation);
  app.get('/api/food/restaurants/:restaurantId/customer-wallet-statement', walletController.getCustomerWalletStatement);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('food wallet security wiring', () => {
  test('createOrder uses wallet credit ledger and marks delivery order paid', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/FROM food_restaurants fr/.test(sql) && /LEFT JOIN businesses b ON b.id = fr.business_id/.test(sql) && /FOR UPDATE/.test(sql)) {
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
      if (/INSERT INTO restaurant_pos_payments/.test(sql)) {
        return {
          rows: [{
            id: 8101,
            food_order_id: 200,
            payment_type: 'wallet_credit',
            amount_cents: 899,
            provider: 'food_wallet',
            metadata: { source: 'food_wallet', currencyCode: 'USD' },
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

  test('kiosk wallet-credit pickup order is created as requires_payment without debiting wallet', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM food_restaurants fr/.test(sql) && /LEFT JOIN businesses b ON b.id = fr.business_id/.test(sql) && /FOR UPDATE/.test(sql)) {
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
        return { rows: [{ next_queue: 4 }] };
      }
      if (/INSERT INTO food_orders/.test(sql)) {
        return {
          rows: [{
            id: 201,
            restaurant_id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            customer_id: null,
            order_source: 'kiosk',
            fulfillment_type: 'pickup',
            payment_status: 'requires_payment',
            queue_number: 4,
            status: 'received',
            subtotal_cents: 899,
            total_cents: 899,
            currency_code: 'USD',
            metadata: { paymentMode: 'wallet_credit' },
          }],
        };
      }
      if (/INSERT INTO food_order_items/.test(sql)) {
        return { rows: [{ id: 902 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildUnauthenticatedOrderApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .send({
        orderSource: 'kiosk',
        fulfillmentType: 'pickup',
        paymentMode: 'wallet_credit',
        items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.order.payment_status).toBe('requires_payment');
    expect(res.body.payment.status).toBe('requires_payment');
    expect(res.body.payment.reason).toBe('awaiting_pos_qr_redemption');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO restaurant_pos_payments/.test(sql))).toBe(false);
  });

  test('wallet-funded delivery is rejected when the wallet is suspended', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM food_restaurants fr/.test(sql) && /LEFT JOIN businesses b ON b.id = fr.business_id/.test(sql) && /FOR UPDATE/.test(sql)) {
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
            status: 'suspended',
            ledger_version: 0,
            last_entry_hash: null,
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

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('wallet_inactive');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql))).toBe(false);
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
      if (/INSERT INTO restaurant_pos_payments/.test(sql)) {
        return {
          rows: [{
            id: 8102,
            food_order_id: 200,
            payment_type: 'refund',
            amount_cents: 899,
            provider: 'food_wallet',
            metadata: { source: 'food_wallet', currencyCode: 'USD' },
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
          reserved_cents: 10,
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
      expect.arrayContaining([
        'entry_hash_mismatch',
        'account_balance_mismatch',
        'reserved_balance_mismatch',
        'ledger_version_mismatch',
        'account_last_hash_mismatch',
      ])
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

    const secondRes = await request(buildMerchantApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-loads`)
      .send({
        customerId: CUSTOMER_ID,
        amountCents: 2500,
      });

    expect(secondRes.status).toBe(201);
    const ledgerInsertParams = mockQuery.mock.calls
      .filter(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql))
      .map(([, params]) => params);
    expect(ledgerInsertParams).toHaveLength(2);
    expect(ledgerInsertParams[0][9]).not.toBe(ledgerInsertParams[1][9]);
    expect(ledgerInsertParams[0][9]).toBe('wallet-load-1');
    expect(ledgerInsertParams[1][9]).toMatch(/^merchant-load:/);
  });

  test('large merchant wallet load request alias requires pending approval before ledger posting', async () => {
    mockQuery.mockImplementation(async (sql) => {
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
      if (/FROM food_customer_wallet_load_requests/.test(sql) && /idempotency_key/.test(sql) && /LIMIT 1/.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO food_customer_wallet_load_requests/.test(sql)) {
        return {
          rows: [{
            id: 501,
            restaurant_id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            customer_id: CUSTOMER_ID,
            requested_by_user_id: OWNER_ID,
            approved_by_user_id: null,
            cancelled_by_user_id: null,
            amount_cents: 75000,
            currency_code: 'USD',
            status: 'pending',
            note: 'Large catering credit',
            reference_id: 'large-load-1',
            idempotency_key: 'large-load-1',
            correlation_id: 'large-load-1',
            metadata: { source: 'merchant_load_request' },
            approved_at: null,
            cancelled_at: null,
            expires_at: '2026-07-05T12:00:00.000Z',
            created_at: '2026-06-28T12:00:00.000Z',
            updated_at: '2026-06-28T12:00:00.000Z',
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_operator_audit_events/.test(sql)) {
        return { rows: [{ id: 103, action_type: 'merchant_load_requested' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildMerchantApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-load-requests`)
      .send({
        customerId: CUSTOMER_ID,
        amountCents: 75000,
        referenceId: 'large-load-1',
        idempotencyKey: 'large-load-1',
        correlationId: 'large-load-1',
        note: 'Large catering credit',
      });

    expect(res.status).toBe(202);
    expect(res.body.pendingApproval).toBe(true);
    expect(res.body.loadRequest.status).toBe('pending');
    expect(res.body.loadRequest.amountCents).toBe(75000);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql, params]) => (
      /INSERT INTO food_customer_wallet_operator_audit_events/.test(sql)
      && params?.includes('merchant_load_requested')
    ))).toBe(true);
  });

  test('owner can list pending wallet load approval requests', async () => {
    mockQuery.mockImplementation(async (sql) => {
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
      if (/FROM food_customer_wallet_load_requests r/.test(sql) && /LEFT JOIN users u/.test(sql)) {
        return {
          rows: [{
            id: 501,
            restaurant_id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            customer_id: CUSTOMER_ID,
            customer_name: 'Test Customer',
            customer_email: 'customer@example.com',
            requested_by_user_id: OWNER_ID,
            approved_by_user_id: null,
            cancelled_by_user_id: null,
            amount_cents: 75000,
            currency_code: 'USD',
            status: 'pending',
            note: 'Large catering credit',
            reference_id: 'large-load-1',
            idempotency_key: 'large-load-1',
            correlation_id: 'large-load-1',
            metadata: { source: 'merchant_load_request' },
            approved_at: null,
            cancelled_at: null,
            expires_at: '2999-07-05T12:00:00.000Z',
            created_at: '2026-06-28T12:00:00.000Z',
            updated_at: '2026-06-28T12:00:00.000Z',
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildMerchantApp())
      .get(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-load-requests`)
      .query({ status: 'pending', limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.filters.statuses).toEqual(['pending']);
    expect(res.body.loadRequests).toHaveLength(1);
    expect(res.body.loadRequests[0]).toEqual(
      expect.objectContaining({
        id: '501',
        status: 'pending',
        amountCents: 75000,
        customerEmail: 'customer@example.com',
      })
    );
  });

  test('owner can cancel a pending wallet load request with audit logging', async () => {
    mockQuery.mockImplementation(async (sql) => {
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
      if (/FROM food_customer_wallet_load_requests/.test(sql) && /FOR UPDATE/.test(sql)) {
        return {
          rows: [{
            id: 501,
            restaurant_id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            customer_id: CUSTOMER_ID,
            requested_by_user_id: OWNER_ID,
            approved_by_user_id: null,
            cancelled_by_user_id: null,
            amount_cents: 75000,
            currency_code: 'USD',
            status: 'pending',
            note: 'Large catering credit',
            reference_id: 'large-load-1',
            idempotency_key: 'large-load-1',
            correlation_id: 'large-load-1',
            metadata: { source: 'merchant_load_request' },
            approved_at: null,
            cancelled_at: null,
            expires_at: '2999-07-05T12:00:00.000Z',
            created_at: '2026-06-28T12:00:00.000Z',
            updated_at: '2026-06-28T12:00:00.000Z',
          }],
        };
      }
      if (/UPDATE food_customer_wallet_load_requests/.test(sql) && /status = 'cancelled'/.test(sql)) {
        return {
          rows: [{
            id: 501,
            restaurant_id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            customer_id: CUSTOMER_ID,
            requested_by_user_id: OWNER_ID,
            approved_by_user_id: null,
            cancelled_by_user_id: OWNER_ID,
            amount_cents: 75000,
            currency_code: 'USD',
            status: 'cancelled',
            note: 'Large catering credit',
            reference_id: 'large-load-1',
            idempotency_key: 'large-load-1',
            correlation_id: 'large-load-1',
            metadata: { cancellationReason: 'Duplicate request' },
            approved_at: null,
            cancelled_at: '2026-06-28T12:02:00.000Z',
            expires_at: '2999-07-05T12:00:00.000Z',
            created_at: '2026-06-28T12:00:00.000Z',
            updated_at: '2026-06-28T12:02:00.000Z',
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_operator_audit_events/.test(sql)) {
        return { rows: [{ id: 105, action_type: 'merchant_load_cancelled' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildMerchantApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-load-requests/501/cancel`)
      .send({ reason: 'Duplicate request' });

    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
    expect(res.body.loadRequest.status).toBe('cancelled');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql, params]) => (
      /INSERT INTO food_customer_wallet_operator_audit_events/.test(sql)
      && params?.includes('merchant_load_cancelled')
    ))).toBe(true);
  });

  test('second wallet operator can approve a pending load and post ledger credit', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT fr\.id, fr\.business_id, fr\.owner_user_id/.test(sql)) {
        return {
          rows: [{
            id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            owner_user_id: OWNER_ID,
            display_name: 'Ox Burger Lab',
            currency_code: 'USD',
            effective_role: 'manager',
          }],
        };
      }
      if (/FROM food_customer_wallet_load_requests/.test(sql) && /FOR UPDATE/.test(sql)) {
        return {
          rows: [{
            id: 501,
            restaurant_id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            customer_id: CUSTOMER_ID,
            requested_by_user_id: OWNER_ID,
            approved_by_user_id: null,
            cancelled_by_user_id: null,
            amount_cents: 75000,
            currency_code: 'USD',
            status: 'pending',
            note: 'Large catering credit',
            reference_id: 'large-load-1',
            idempotency_key: 'large-load-1',
            correlation_id: 'large-load-1',
            metadata: { source: 'merchant_load_request' },
            approved_at: null,
            cancelled_at: null,
            expires_at: '2999-07-05T12:00:00.000Z',
            created_at: '2026-06-28T12:00:00.000Z',
            updated_at: '2026-06-28T12:00:00.000Z',
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
            balance_cents: 75000,
            status: 'active',
            ledger_version: 1,
            last_entry_hash: 'hash-approved',
            updated_at: '2026-06-28T12:01:00.000Z',
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_ledger/.test(sql)) {
        return {
          rows: [{
            id: 8001,
            account_id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            entry_type: 'credit',
            amount_cents: 75000,
            balance_after_cents: 75000,
            currency_code: 'USD',
            description: 'Large catering credit',
            reference_type: 'merchant_load_request',
            reference_id: '501',
            metadata: { source: 'merchant_load_request_approval' },
            entry_sequence: 1,
            previous_entry_hash: null,
            hash_algorithm: CURRENT_WALLET_HASH_ALGORITHM,
            entry_hash: 'hash-approved',
            posted_at: '2026-06-28T12:01:00.000Z',
            created_at: '2026-06-28T12:01:00.000Z',
          }],
        };
      }
      if (/UPDATE food_customer_wallet_load_requests/.test(sql) && /status = 'approved'/.test(sql)) {
        return {
          rows: [{
            id: 501,
            restaurant_id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            customer_id: CUSTOMER_ID,
            requested_by_user_id: OWNER_ID,
            approved_by_user_id: MANAGER_ID,
            cancelled_by_user_id: null,
            amount_cents: 75000,
            currency_code: 'USD',
            status: 'approved',
            note: 'Large catering credit',
            reference_id: 'large-load-1',
            idempotency_key: 'large-load-1',
            correlation_id: 'large-load-1',
            metadata: { ledgerEntryId: '8001' },
            approved_at: '2026-06-28T12:01:00.000Z',
            cancelled_at: null,
            expires_at: '2999-07-05T12:00:00.000Z',
            created_at: '2026-06-28T12:00:00.000Z',
            updated_at: '2026-06-28T12:01:00.000Z',
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_operator_audit_events/.test(sql)) {
        return { rows: [{ id: 104, action_type: 'merchant_load_approved' }], rowCount: 1 };
      }
      if (/SELECT a\.\*,\s*fr\.display_name AS restaurant_name/.test(sql) && /WHERE a\.customer_id = \$1/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 75000,
            status: 'active',
            ledger_version: 1,
            last_entry_hash: 'hash-approved',
            updated_at: '2026-06-28T12:01:00.000Z',
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

    const res = await request(buildMerchantApp({ id: MANAGER_ID, email: 'manager@example.com' }))
      .post(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-load-requests/501/approve`)
      .send({ approvalNote: 'Verified cash receipt' });

    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
    expect(res.body.loadRequest.status).toBe('approved');
    expect(res.body.wallet.balanceCents).toBe(75000);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql, params]) => (
      /INSERT INTO food_customer_wallet_operator_audit_events/.test(sql)
      && params?.includes('merchant_load_approved')
    ))).toBe(true);
  });

  test('wallet load requester cannot approve their own pending load', async () => {
    mockQuery.mockImplementation(async (sql) => {
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
      if (/FROM food_customer_wallet_load_requests/.test(sql) && /FOR UPDATE/.test(sql)) {
        return {
          rows: [{
            id: 501,
            restaurant_id: RESTAURANT_ID,
            business_id: BUSINESS_ID,
            customer_id: CUSTOMER_ID,
            requested_by_user_id: OWNER_ID,
            approved_by_user_id: null,
            cancelled_by_user_id: null,
            amount_cents: 75000,
            currency_code: 'USD',
            status: 'pending',
            note: 'Large catering credit',
            reference_id: 'large-load-1',
            idempotency_key: 'large-load-1',
            correlation_id: 'large-load-1',
            metadata: { source: 'merchant_load_request' },
            approved_at: null,
            cancelled_at: null,
            expires_at: '2999-07-05T12:00:00.000Z',
            created_at: '2026-06-28T12:00:00.000Z',
            updated_at: '2026-06-28T12:00:00.000Z',
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildMerchantApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-load-requests/501/approve`)
      .send({ approvalNote: 'Trying to approve my own request' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('wallet_load_requires_second_operator');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_customer_wallet_load_requests/.test(sql) && /status = 'approved'/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_operator_audit_events/.test(sql))).toBe(false);
  });

  test('owner can suspend a customer wallet with audit logging', async () => {
    mockQuery.mockImplementation(async (sql) => {
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
      if (/FROM food_customer_wallet_accounts a/.test(sql) && /FOR UPDATE/.test(sql)) {
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
          }],
        };
      }
      if (/UPDATE food_customer_wallet_accounts/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 2500,
            status: 'suspended',
            ledger_version: 1,
            last_entry_hash: 'hash-1',
            updated_at: new Date().toISOString(),
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_operator_audit_events/.test(sql)) {
        return { rows: [{ id: 101, action_type: 'wallet_suspended' }], rowCount: 1 };
      }
      if (/SELECT a\.\*,\s*fr\.display_name AS restaurant_name/.test(sql) && /WHERE a\.customer_id = \$1/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 2500,
            status: 'suspended',
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
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-status`)
      .send({
        customerId: CUSTOMER_ID,
        status: 'suspended',
        reason: 'Customer reported unauthorized activity',
        correlationId: 'status-change-1',
      });

    expect(res.status).toBe(200);
    expect(res.body.wallet.status).toBe('suspended');
    expect(res.body.changed).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_operator_audit_events/.test(sql))).toBe(true);
  });

  test('owner can reconcile customer wallet accounts and ledger movement', async () => {
    mockQuery.mockImplementation(async (sql) => {
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
      if (/FROM food_customer_wallet_accounts/.test(sql) && /GROUP BY currency_code/.test(sql)) {
        return {
          rows: [{
            currency_code: 'USD',
            total_accounts: 2,
            active_accounts: 1,
            suspended_accounts: 1,
            closed_accounts: 0,
            total_balance_cents: 6150,
            active_balance_cents: 4150,
            locked_balance_cents: 2000,
          }],
        };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql) && /GROUP BY currency_code, entry_type/.test(sql)) {
        return {
          rows: [
            {
              currency_code: 'USD',
              entry_type: 'credit',
              entry_count: 3,
              amount_cents: 8000,
            },
            {
              currency_code: 'USD',
              entry_type: 'debit',
              entry_count: 2,
              amount_cents: 1850,
            },
          ],
        };
      }
      if (/FROM food_customer_wallet_operator_audit_events/.test(sql)) {
        return {
          rows: [{
            id: 12,
            wallet_account_id: ACCOUNT_ID,
            customer_id: CUSTOMER_ID,
            operator_user_id: OWNER_ID,
            action_type: 'wallet_integrity_failed_lock',
            amount_cents: null,
            currency_code: 'USD',
            correlation_id: 'lock-1',
            metadata: { issueCodes: ['account_balance_mismatch'] },
            created_at: '2026-06-15T12:00:00.000Z',
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildMerchantApp())
      .get(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-reconciliation`)
      .query({
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-30T23:59:59.999Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.restaurant.name).toBe('Ox Burger Lab');
    expect(res.body.accounts.totalAccounts).toBe(2);
    expect(res.body.accounts.activeAccounts).toBe(1);
    expect(res.body.accounts.suspendedAccounts).toBe(1);
    expect(res.body.accounts.balances[0].lockedBalanceCents).toBe(2000);
    expect(res.body.ledger.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryType: 'credit', count: 3, amountCents: 8000 }),
        expect.objectContaining({ entryType: 'debit', count: 2, amountCents: 1850 }),
      ])
    );
    expect(res.body.auditEvents[0].actionType).toBe('wallet_integrity_failed_lock');
    expect(res.body.requiresAttention).toBe(true);
  });

  test('owner can export a customer-scoped wallet statement with ledger hashes', async () => {
    mockQuery.mockImplementation(async (sql) => {
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
      if (/FROM food_customer_wallet_ledger l/.test(sql) && /LEFT JOIN users u/.test(sql)) {
        return {
          rows: [
            {
              id: 7001,
              account_id: ACCOUNT_ID,
              restaurant_id: RESTAURANT_ID,
              customer_id: CUSTOMER_ID,
              customer_name: 'Test Customer',
              customer_email: 'customer@example.com',
              entry_type: 'credit',
              amount_cents: 5000,
              balance_after_cents: 5000,
              currency_code: 'USD',
              description: 'Wallet load',
              reference_type: 'merchant_load',
              reference_id: 'load-1',
              correlation_id: 'load-1',
              metadata: { source: 'merchant_load' },
              entry_sequence: 1,
              previous_entry_hash: null,
              entry_hash: 'hash-1',
              hash_algorithm: CURRENT_WALLET_HASH_ALGORITHM,
              created_by_user_id: OWNER_ID,
              actor_type: 'restaurant_staff',
              created_at: '2026-06-10T12:00:00.000Z',
            },
            {
              id: 7002,
              account_id: ACCOUNT_ID,
              restaurant_id: RESTAURANT_ID,
              customer_id: CUSTOMER_ID,
              customer_name: 'Test Customer',
              customer_email: 'customer@example.com',
              entry_type: 'debit',
              amount_cents: 1850,
              balance_after_cents: 3150,
              currency_code: 'USD',
              description: 'Order #200',
              reference_type: 'food_order',
              reference_id: '200',
              correlation_id: 'order-200',
              metadata: { orderId: 200 },
              entry_sequence: 2,
              previous_entry_hash: 'hash-1',
              entry_hash: 'hash-2',
              hash_algorithm: CURRENT_WALLET_HASH_ALGORITHM,
              created_by_user_id: CUSTOMER_ID,
              actor_type: 'customer',
              created_at: '2026-06-11T12:00:00.000Z',
            },
          ],
        };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql) && /GROUP BY currency_code, entry_type/.test(sql)) {
        return {
          rows: [
            { currency_code: 'USD', entry_type: 'credit', entry_count: 1, amount_cents: 5000 },
            { currency_code: 'USD', entry_type: 'debit', entry_count: 1, amount_cents: 1850 },
          ],
        };
      }
      if (/FROM food_customer_wallet_accounts/.test(sql) && /GROUP BY currency_code/.test(sql)) {
        return {
          rows: [{
            currency_code: 'USD',
            wallet_count: 1,
            active_wallet_count: 1,
            suspended_wallet_count: 0,
            closed_wallet_count: 0,
            balance_cents: 3150,
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildMerchantApp())
      .get(`/api/food/restaurants/${RESTAURANT_ID}/customer-wallet-statement`)
      .query({
        customerEmail: 'customer@example.com',
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-30T23:59:59.999Z',
        limit: 25,
      });

    expect(res.status).toBe(200);
    expect(res.body.statement.version).toBe('food-wallet-statement-v1');
    expect(res.body.statement.id).toMatch(/^[a-f0-9]{32}$/);
    expect(res.body.statement.generatedByUserId).toBe(OWNER_ID);
    expect(res.body.customer.email).toBe('customer@example.com');
    expect(res.body.currentBalances[0].balanceCents).toBe(3150);
    expect(res.body.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryType: 'credit', signedAmountCents: 5000 }),
        expect.objectContaining({ entryType: 'debit', signedAmountCents: -1850 }),
      ])
    );
    expect(res.body.entries[1]).toEqual(
      expect.objectContaining({
        entryType: 'debit',
        signedAmountCents: -1850,
        previousEntryHash: 'hash-1',
        entryHash: 'hash-2',
        hashAlgorithm: CURRENT_WALLET_HASH_ALGORITHM,
      })
    );
    expect(res.body.audit).toEqual(
      expect.objectContaining({
        hashChainIncluded: true,
        entryCount: 2,
        filters: { customerScoped: true },
      })
    );
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

  test('customer wallet integrity endpoint verifies only the signed-in customer wallet', async () => {
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

    mockQuery.mockImplementation(async (sql) => {
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
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildOrderApp())
      .get(`/api/food/customer/wallets/${RESTAURANT_ID}/integrity`);

    expect(res.status).toBe(200);
    expect(res.body.audit.valid).toBe(true);
    expect(res.body.audit.wallet.restaurantId).toBe(String(RESTAURANT_ID));
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_operator_audit_events/.test(sql))).toBe(false);
  });

  test('customer wallet integrity endpoint suspends active wallets when ledger verification fails', async () => {
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

    mockQuery.mockImplementation(async (sql) => {
      if (/SELECT a\.\*,\s*fr\.display_name AS restaurant_name/.test(sql) && /WHERE a\.restaurant_id = \$1/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            restaurant_name: 'Ox Burger Lab',
            restaurant_logo_url: null,
            currency_code: 'USD',
            balance_cents: 1500,
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
      if (/UPDATE food_customer_wallet_accounts/.test(sql) && /status = 'active'/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            restaurant_id: RESTAURANT_ID,
            customer_id: CUSTOMER_ID,
            currency_code: 'USD',
            balance_cents: 1500,
            status: 'suspended',
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_operator_audit_events/.test(sql)) {
        return { rows: [{ id: 102, action_type: 'wallet_integrity_failed_lock' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildOrderApp())
      .get(`/api/food/customer/wallets/${RESTAURANT_ID}/integrity`);

    expect(res.status).toBe(200);
    expect(res.body.audit.valid).toBe(false);
    expect(res.body.audit.locked).toBe(true);
    expect(res.body.audit.wallet.status).toBe('suspended');
    expect(res.body.audit.issueCodes).toContain('account_balance_mismatch');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_customer_wallet_accounts/.test(sql))).toBe(true);
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
