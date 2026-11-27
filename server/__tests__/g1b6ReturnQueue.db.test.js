'use strict';

// Group 1 checkpoint 4 (G1-B6): product return queue + notification on
// create.
//
// A return request filed by a customer now reaches someone: the helper
// who sold the order through the cart gets a `marketplace_return_requested`
// notification (action: /marketplace/returns) and the operations admins
// get one too (action: /admin/orders). The merchant queue
// (GET /api/carts/returns) lists only the caller's own carts' returns;
// the admin queue (GET /api/admin/orders/returns) lists all of them.
// An admin decision (approved/declined) is status-only: it never
// refunds (D-30 stands), the order is untouched, and no refund row is
// recorded anywhere. One open request per order still 409s.
//
// Runs against a dedicated fresh database (credit_statement_test_g1ckpt4)
// so checkpoint fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.G1_CKPT4_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g1ckpt4') {
    throw new Error('Group 1 checkpoint 4 DB tests require the loopback credit_statement_test_g1ckpt4 database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: req.get('x-test-role') || 'customer',
      email: req.get('x-test-email') || `g1ckpt4-${id}@example.invalid`,
      email_verified: true,
    };
    return next();
  };
  return {
    authenticate,
    requireAuth: authenticate,
    authenticateIfPresent: (req, res, next) => (
      req.get('x-test-user') ? authenticate(req, res, next) : next()
    ),
  };
});
jest.mock('../middleware/adminAuth', () => ({
  ...jest.requireActual('../middleware/adminAuth'),
  requireAdmin: (req, res, next) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') return res.sendStatus(403);
    return next();
  },
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../middleware/rejectImpersonated', () => ({
  rejectImpersonated: (req, res, next) => next(),
  isImpersonatedRequest: () => false,
}));

// Expo push is observed, never sent: the SDK is mocked before
// notificationService loads it. Email is mocked too; the in-app rows
// the real send path inserts are what these tests assert.
const mockSendExpo = jest.fn();
jest.mock('expo-server-sdk', () => {
  const Expo = jest.fn().mockImplementation(() => ({
    chunkPushNotifications: jest.fn((messages) => [messages]),
    sendPushNotificationsAsync: (...args) => mockSendExpo(...args),
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(true);
  return { Expo };
});
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true, id: 'email-test' }),
  sendEmailOrThrow: jest.fn().mockResolvedValue({ success: true }),
  sendOTPEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
}));

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 1 checkpoint 4: return queue + notification on create (G1-B6)', () => {
  let db;
  let app;
  let customer;
  let helperA;
  let helperB;
  let stranger;
  let superAdmin;
  let plainAdmin;
  let cartA;
  let cartB;
  let orderA;
  let orderB;
  let orderC;
  let orderD;
  let product;
  let returnA;
  let returnB;
  let returnC;

  async function addUser(role) {
    const id = randomUUID();
    const { rows: [row] } = await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', 'Checkpoint', 'Fixture', $3, 'customer', TRUE, TRUE, TRUE, 'pending', NULL)
       RETURNING id`,
      [id, `g1ckpt4-${id}@example.invalid`, role],
    );
    return row;
  }

  async function addCart(helperId) {
    const { rows: [row] } = await db.query(
      `INSERT INTO shopping_carts (helper_id, name, status) VALUES ($1, 'G1 ckpt4 cart', 'draft') RETURNING id`,
      [helperId],
    );
    return row;
  }

  async function addProduct() {
    const { rows: [row] } = await db.query(
      `INSERT INTO marketplace_products (name, price_cents) VALUES ('G1 ckpt4 widget', 2500) RETURNING id`,
    );
    return row;
  }

  async function addOrder(customerId, cartId) {
    const { rows: [row] } = await db.query(
      `INSERT INTO marketplace_orders (customer_id, cart_id, total_cents, subtotal_cents, status)
       VALUES ($1, $2, 2500, 2500, 'paid') RETURNING id`,
      [customerId, cartId],
    );
    return row;
  }

  function as(user, role) {
    return (req) => req.set('x-test-user', user.id).set('x-test-role', role || 'customer');
  }

  beforeAll(async () => {
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/orders', require('../routes/orders'));
    app.use('/api/carts', require('../routes/shoppingCarts'));
    app.use('/api/admin/orders', require('../routes/adminOrders'));
    app.use(require('../middleware/errorHandler').errorHandler);

    customer = await addUser('customer');
    helperA = await addUser('helper');
    helperB = await addUser('helper');
    stranger = await addUser('customer');
    superAdmin = await addUser('super_admin');
    plainAdmin = await addUser('admin');
    cartA = await addCart(helperA.id);
    cartB = await addCart(helperB.id);
    const productRow = await addProduct();
    product = productRow;
    orderA = await addOrder(customer.id, cartA.id);
    orderB = await addOrder(customer.id, cartB.id);
    // No cart: no merchant exists, so only the admins are notified.
    orderC = await addOrder(customer.id, null);
    orderD = await addOrder(customer.id, cartA.id);
    await db.query(
      `INSERT INTO marketplace_order_items (order_id, product_id, quantity, unit_price_cents, total_price_cents)
       VALUES ($1, $2, 1, 2500, 2500)`,
      [orderA.id, product.id],
    );
  });

  afterAll(async () => {
    // Coordinator correction: the suite as delivered had no cleanup, so
    // its absolute-total assertions (admin queue total 3, approved total
    // 1) failed on any re-run against the same dedicated DB — the
    // worker's 6/6 was true only on a fresh DB. Remove every fixture
    // this suite created so a re-run sees a clean slate. Cleanup uses
    // email-pattern subselects (not array parameters) so it also clears
    // residue from earlier runs. Users are NOT deleted: any DELETE FROM
    // users in this database raises the pre-existing
    // oxsteed_credit_partner_funding_records RI rule-rewrite error, so
    // the user rows stay as inert orphans (distinctive g1ckpt4- emails,
    // no child rows left after this cleanup).
    if (!db) return;
    const pattern = 'g1ckpt4-%';
    await db.query(
      `DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [pattern],
    );
    await db.query(
      `DELETE FROM order_return_requests WHERE order_id IN
         (SELECT id FROM marketplace_orders WHERE customer_id IN
           (SELECT id FROM users WHERE email LIKE $1))`,
      [pattern],
    );
    await db.query(
      `DELETE FROM marketplace_order_items WHERE order_id IN
         (SELECT id FROM marketplace_orders WHERE customer_id IN
           (SELECT id FROM users WHERE email LIKE $1))`,
      [pattern],
    );
    await db.query(
      `DELETE FROM marketplace_orders WHERE customer_id IN
         (SELECT id FROM users WHERE email LIKE $1)`,
      [pattern],
    );
    await db.query(
      `DELETE FROM shopping_carts WHERE helper_id IN
         (SELECT id FROM users WHERE email LIKE $1)`,
      [pattern],
    );
    await db.query(`DELETE FROM marketplace_products WHERE name = 'G1 ckpt4 widget'`);
    await db.end().catch(() => {});
  });

  test('create notifies the cart helper and the operations admins', async () => {
    const res = await request(app)
      .post(`/api/orders/${orderA.id}/return`)
      .use(as(customer))
      .send({ reason: 'Arrived damaged' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('requested');
    returnA = res.body.data;

    // The helper who sold the order gets a real stored notification
    // with a non-empty resolved title (the type is registered, not
    // just a caller-supplied string) and the merchant queue link.
    const { rows: merchantRows } = await db.query(
      `SELECT title, body, action_url FROM notifications
        WHERE user_id = $1 AND type = 'marketplace_return_requested'`,
      [helperA.id],
    );
    expect(merchantRows).toHaveLength(1);
    expect(merchantRows[0].title).toBeTruthy();
    expect(merchantRows[0].body).toBeTruthy();
    expect(merchantRows[0].action_url).toBe('/marketplace/returns');

    // The operations super-admin gets one too, pointing at the admin queue.
    const { rows: adminRows } = await db.query(
      `SELECT title, action_url FROM notifications
        WHERE user_id = $1 AND type = 'marketplace_return_requested'`,
      [superAdmin.id],
    );
    expect(adminRows).toHaveLength(1);
    expect(adminRows[0].title).toBeTruthy();
    expect(adminRows[0].action_url).toBe('/admin/orders');

    // A plain admin with no manage_operations grant is not notified.
    const { rows: plainRows } = await db.query(
      `SELECT id FROM notifications
        WHERE user_id = $1 AND type = 'marketplace_return_requested'`,
      [plainAdmin.id],
    );
    expect(plainRows).toHaveLength(0);

    // The type is registered in the catalog (the N3 sync test pins it).
    const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');
    expect(NOTIFICATION_TYPES.some((entry) => entry.type === 'marketplace_return_requested')).toBe(true);
  });

  test('a cart-less order notifies the admins only', async () => {
    const res = await request(app)
      .post(`/api/orders/${orderC.id}/return`)
      .use(as(customer))
      .send({ reason: 'Wrong item' });
    expect(res.status).toBe(201);
    returnC = res.body.data;

    const { rows: adminRows } = await db.query(
      `SELECT id FROM notifications
        WHERE user_id = $1 AND type = 'marketplace_return_requested'
          AND data ->> 'order_id' = $2`,
      [superAdmin.id, String(orderC.id)],
    );
    expect(adminRows).toHaveLength(1);
    // Neither helper got a notice for the cart-less order.
    const { rows: helperRows } = await db.query(
      `SELECT id FROM notifications
        WHERE user_id IN ($1, $2) AND type = 'marketplace_return_requested'
          AND data ->> 'order_id' = $3`,
      [helperA.id, helperB.id, String(orderC.id)],
    );
    expect(helperRows).toHaveLength(0);
  });

  test('merchant queue lists only the caller helper own carts returns', async () => {
    const resB = await request(app)
      .post(`/api/orders/${orderB.id}/return`)
      .use(as(customer))
      .send({ reason: 'Changed my mind' });
    expect(resB.status).toBe(201);
    returnB = resB.body.data;

    const asA = await request(app).get('/api/carts/returns').use(as(helperA, 'helper'));
    expect(asA.status).toBe(200);
    expect(asA.body.data.map((r) => r.orderId)).toEqual([orderA.id]);
    expect(asA.body.data[0].status).toBe('requested');
    expect(asA.body.data[0].reason).toBe('Arrived damaged');

    const asB = await request(app).get('/api/carts/returns').use(as(helperB, 'helper'));
    expect(asB.status).toBe(200);
    expect(asB.body.data.map((r) => r.orderId)).toEqual([orderB.id]);

    // A user with no carts sees nothing, not an error and not others' rows.
    const asStranger = await request(app).get('/api/carts/returns').use(as(stranger));
    expect(asStranger.status).toBe(200);
    expect(asStranger.body.data).toHaveLength(0);
    expect(asStranger.body.pagination.total).toBe(0);

    // The cart-less order's return is in no merchant queue.
    const allMerchant = await db.query(
      `SELECT id FROM notifications
        WHERE user_id IN ($1, $2) AND type = 'marketplace_return_requested'
          AND data ->> 'order_id' = $3`,
      [helperA.id, helperB.id, String(orderC.id)],
    );
    expect(allMerchant.rows).toHaveLength(0);
  });

  test('admin queue lists every return', async () => {
    const res = await request(app)
      .get('/api/admin/orders/returns')
      .use(as(superAdmin, 'super_admin'));
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.data.map((r) => r.orderId).sort()).toEqual(
      [orderA.id, orderB.id, orderC.id].sort(),
    );

    const requested = await request(app)
      .get('/api/admin/orders/returns?status=requested')
      .use(as(superAdmin, 'super_admin'));
    expect(requested.body.pagination.total).toBe(3);

    // A non-admin cannot open the admin queue at all.
    const asCustomer = await request(app)
      .get('/api/admin/orders/returns')
      .use(as(customer));
    expect(asCustomer.status).toBe(403);
  });

  test('admin decision is status-only and never refunds', async () => {
    const res = await request(app)
      .post(`/api/admin/orders/returns/${returnA.id}/decision`)
      .use(as(superAdmin, 'super_admin'))
      .send({ decision: 'approved', note: 'Return accepted, label sent' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.admin_note).toBe('Return accepted, label sent');
    expect(res.body.data.decided_by).toBe(superAdmin.id);
    expect(res.body.data.decided_at).toBeTruthy();

    // The order is untouched and no money moved anywhere: no
    // marketplace transaction and no refund attempt exist for it.
    const { rows: [order] } = await db.query(
      'SELECT status FROM marketplace_orders WHERE id = $1', [orderA.id],
    );
    expect(order.status).toBe('paid');
    const { rows: [tx] } = await db.query(
      'SELECT COUNT(*)::int AS n FROM marketplace_transactions WHERE order_id = $1', [orderA.id],
    );
    expect(tx.n).toBe(0);
    const { rows: [attempts] } = await db.query(
      'SELECT COUNT(*)::int AS n FROM payment_refund_attempts',
    );
    expect(attempts.n).toBe(0);

    // The decision is visible in both queues.
    const adminList = await request(app)
      .get('/api/admin/orders/returns?status=approved')
      .use(as(superAdmin, 'super_admin'));
    expect(adminList.body.pagination.total).toBe(1);
    expect(adminList.body.data[0].id).toBe(returnA.id);
    const merchantList = await request(app).get('/api/carts/returns').use(as(helperA, 'helper'));
    expect(merchantList.body.data[0].status).toBe('approved');

    // A decided request cannot be decided again, and 'refunded' is not
    // a decision the endpoint can make (refunds stay in money approvals).
    const again = await request(app)
      .post(`/api/admin/orders/returns/${returnA.id}/decision`)
      .use(as(superAdmin, 'super_admin'))
      .send({ decision: 'declined' });
    expect(again.status).toBe(409);
    const refunded = await request(app)
      .post(`/api/admin/orders/returns/${returnB.id}/decision`)
      .use(as(superAdmin, 'super_admin'))
      .send({ decision: 'refunded' });
    expect(refunded.status).toBe(400);
    const { rows: [stillRequested] } = await db.query(
      'SELECT status FROM order_return_requests WHERE id = $1', [returnB.id],
    );
    expect(stillRequested.status).toBe('requested');
  });

  test('duplicate open request still 409s; cancelling frees the slot', async () => {
    const first = await request(app)
      .post(`/api/orders/${orderD.id}/return`)
      .use(as(customer))
      .send({ reason: 'Too big' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/orders/${orderD.id}/return`)
      .use(as(customer))
      .send({ reason: 'Still too big' });
    expect(second.status).toBe(409);

    // A stranger cannot file against someone else's order at all.
    const strangerCall = await request(app)
      .post(`/api/orders/${orderD.id}/return`)
      .use(as(stranger))
      .send({ reason: 'Not mine' });
    expect(strangerCall.status).toBe(404);

    const cancel = await request(app)
      .post(`/api/orders/${orderD.id}/return/${first.body.data.id}/cancel`)
      .use(as(customer));
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('cancelled');

    const again = await request(app)
      .post(`/api/orders/${orderD.id}/return`)
      .use(as(customer))
      .send({ reason: 'Still want a return' });
    expect(again.status).toBe(201);
  });
});
