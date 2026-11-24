'use strict';

// Group 13 Slice 4g acceptance: operate as cashier (681-685).
// 681 location picker, 684 transaction lookup, 683 authorized transaction
// view, 682 cashier shift summary, 685 shift closeout checklist — one
// device-authenticated cashier surface on the kiosk, scoped server-side to
// the paired device. No money moves in this slice: the shift summary and
// closeout derive from the existing kiosk ledger records.
// Runs against a dedicated fresh database (credit_statement_test_g13g) so
// slice-local fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP13_SLICE4G_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13g') {
    throw new Error('Group 13 Slice 4g DB tests require the loopback credit_statement_test_g13g database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 13 Slice 4g: operate as cashier (681-685)', () => {
  let pool;
  let app;
  let owner;
  let businessId;
  let restaurantId;
  let locPrimary;
  let locSecond;
  let locPaused;
  let kioskDevice;
  let kioskToken;
  let displayKiosk;
  let displayToken;
  let otherDevice;
  let otherToken;
  let queueDevice;
  let queueToken;

  let walletId;
  let partnerPayableId;
  let treasuryId;
  let partnerId;
  let agreementId;
  let customerId;
  let cardId;
  let redemptionTxId;
  let cashOutTxId;
  let orderTxId;
  let orderId;
  let orderAttemptId;
  let orderQueueNumber;
  let otherDeviceTxId;
  let yesterdayTxId;

  beforeAll(async () => {
    pool = require('../db');
    const creditService = require('../services/oxsteedCreditService');
    app = express();
    app.use(express.json());
    // The real kiosk router, mounted exactly as in server/index.js, so the
    // cashier routes' position ahead of the credit_kiosk-only auth is
    // exercised rather than assumed.
    app.use('/api/restaurants/:restaurantId/credit-kiosks/:deviceId', require('../routes/oxsteedCreditKiosk'));
    app.use(require('../middleware/errorHandler').errorHandler);

    owner = await makeUser();
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Fixture Business', FALSE, TRUE) RETURNING id`,
      [owner.id],
    );
    businessId = business.id;
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, 'Fixture Kitchen', 'active') RETURNING id`,
      [business.id, owner.id],
    );
    restaurantId = restaurant.id;
    // Inserting the restaurant auto-creates its primary location (named
    // after the restaurant); reuse it instead of inserting a second one —
    // one primary per restaurant is a unique partial index.
    ({ rows: [{ id: locPrimary }] } = await pool.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE`,
      [restaurantId],
    ));
    locPrimary = Number(locPrimary);
    await pool.query(`UPDATE restaurant_locations SET name = 'Downtown' WHERE id = $1`, [locPrimary]);
    locSecond = await makeLocation('Uptown', {});
    locPaused = await makeLocation('Paused Store', { status: 'paused' });

    // The credit-kiosk terminal, bound to the primary location at pairing.
    ({ device: kioskDevice, token: kioskToken } = await makeDevice({
      locationId: locPrimary, appKey: 'credit_kiosk',
    }));
    // The managed display kiosk (role kiosk), with no location binding:
    // it may work any active location of the restaurant.
    ({ device: displayKiosk, token: displayToken } = await makeDevice({
      locationId: null, appKey: 'display', config: { screenRole: 'kiosk' },
    }));
    // A second terminal, bound to the other location.
    ({ device: otherDevice, token: otherToken } = await makeDevice({
      locationId: locSecond, appKey: 'credit_kiosk',
    }));
    // A display that is NOT a kiosk (queue board): never a cashier device.
    ({ device: queueDevice, token: queueToken } = await makeDevice({
      locationId: locPrimary, appKey: 'display', config: { screenRole: 'queue' },
    }));

    // 684 fixtures: the ledger accounts and the kiosk redemption records
    // the lookup reads. Directions follow the ledger integrity trigger
    // (migration 20261027110000): purchases debit the customer wallet and
    // credit the partner payable; cash-outs debit the wallet and credit
    // the platform treasury.
    const customer = await makeUser();
    customerId = customer.id;
    // Migration 488: partner rows require an active administrator creator.
    const admin = await makeUser('super_admin');
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, status, created_by)
       VALUES ($1, 'active', $2) RETURNING id`,
      [restaurantId, admin.id],
    );
    partnerId = partner.id;
    // Purchases require an active partner agreement (ledger guard), and an
    // active agreement requires a second-admin approval record (481).
    const approver = await makeUser('super_admin');
    const { rows: [agreement] } = await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements (partner_id, version, status, starts_at, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW(), $2, $3) RETURNING id`,
      [partner.id, admin.id, approver.id],
    );
    agreementId = agreement.id;
    walletId = await ensureCreditAccount({ accountType: 'customer_wallet', customerId: customer.id });
    partnerPayableId = await ensureCreditAccount({ accountType: 'partner_payable', partnerId });
    treasuryId = await ensureCreditAccount({ accountType: 'platform_treasury' });
    const { rows: [card] } = await pool.query(
      `INSERT INTO oxsteed_credit_cards (customer_id, account_id, card_type, status, credential_hash, credential_last4, idempotency_key)
       VALUES ($1, $2, 'virtual', 'active', $3, '4242', $4) RETURNING id`,
      [customer.id, walletId, crypto.createHash('sha256').update(`g13g-card-${customer.id}`).digest('hex'), `g13g-card-${customer.id}`],
    );
    cardId = card.id;
    redemptionTxId = await seedLedgerTx({
      type: 'purchase', status: 'posted', amountCents: 2500,
      debitAccountId: walletId, creditAccountId: partnerPayableId,
      referenceType: 'credit_kiosk_redemption', referenceId: String(kioskDevice.id),
      metadata: { kioskDeviceId: String(kioskDevice.id), cardId, cardLast4: '4242' },
      // Explicit timestamps so the newest-first list order is deterministic.
      createdAt: new Date(Date.now() - 3 * 60 * 1000),
    });
    cashOutTxId = await seedLedgerTx({
      type: 'cash_out', status: 'posted', amountCents: 1000,
      debitAccountId: walletId, creditAccountId: treasuryId,
      referenceType: 'credit_kiosk_cash_out', referenceId: String(kioskDevice.id),
      metadata: { kioskDeviceId: String(kioskDevice.id), cardId, cardLast4: '4242' },
      createdAt: new Date(Date.now() - 2 * 60 * 1000),
    });
    // A kiosk credit order: the ledger purchase plus the food order that
    // carries the attempt id, queue number, and transaction link.
    orderAttemptId = crypto.randomUUID();
    orderQueueNumber = 42;
    const { rows: [order] } = await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, customer_id, location_id, subtotal_cents, total_cents, currency_code, queue_number, payment_status, order_source, fulfillment_type)
       VALUES ($1, $2, $3, $4, 1800, 1800, 'USD', $5, 'paid', 'kiosk', 'dine_in') RETURNING id`,
      [restaurantId, businessId, customer.id, locPrimary, orderQueueNumber],
    );
    orderId = order.id;
    orderTxId = await seedLedgerTx({
      type: 'purchase', status: 'posted', amountCents: 1800,
      debitAccountId: walletId, creditAccountId: partnerPayableId,
      referenceType: 'food_order', referenceId: String(orderId),
      metadata: {
        kioskDeviceId: String(kioskDevice.id), cardId,
        clientOrderId: `credit-kiosk:${kioskDevice.id}:${orderAttemptId}`,
        orderId,
      },
      createdAt: new Date(Date.now() - 60 * 1000),
    });
    await pool.query(
      `UPDATE food_orders SET metadata = $2::jsonb WHERE id = $1`,
      [orderId, JSON.stringify({
        clientOrderId: `credit-kiosk:${kioskDevice.id}:${orderAttemptId}`,
        creditKioskDeviceId: String(kioskDevice.id),
        oxsteedCreditTransactionId: orderTxId,
      })],
    );
    // Records that must never appear for this device: another device's
    // redemption, a non-kiosk purchase, and a transaction from yesterday
    // (used by the date filter). The ledger only allows status 'posted'
    // (migration 641), so there is no pending-transaction state to seed.
    otherDeviceTxId = await seedLedgerTx({
      type: 'purchase', status: 'posted', amountCents: 9900,
      debitAccountId: walletId, creditAccountId: partnerPayableId,
      referenceType: 'credit_kiosk_redemption', referenceId: String(otherDevice.id),
      metadata: { kioskDeviceId: String(otherDevice.id), cardId, cardLast4: '4242' },
    });
    // A real second order, owned by the same customer: its purchase
    // carries no kioskDeviceId, so it must never appear for the device.
    const { rows: [decoyOrder] } = await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, customer_id, location_id, subtotal_cents, total_cents, currency_code, queue_number, payment_status, order_source, fulfillment_type)
       VALUES ($1, $2, $3, $4, 7700, 7700, 'USD', 43, 'paid', 'web', 'pickup') RETURNING id`,
      [restaurantId, businessId, customer.id, locPrimary],
    );
    const decoyOrderId = decoyOrder.id;
    await seedLedgerTx({
      type: 'purchase', status: 'posted', amountCents: 7700,
      debitAccountId: walletId, creditAccountId: partnerPayableId,
      referenceType: 'food_order', referenceId: String(decoyOrderId),
      metadata: { orderId: decoyOrderId },
    });
    yesterdayTxId = await seedLedgerTx({
      type: 'purchase', status: 'posted', amountCents: 500,
      debitAccountId: walletId, creditAccountId: partnerPayableId,
      referenceType: 'credit_kiosk_redemption', referenceId: String(kioskDevice.id),
      metadata: { kioskDeviceId: String(kioskDevice.id), cardId, cardLast4: '4242' },
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    async function ensureCreditAccount({ accountType, customerId = null, partnerId: pid = null }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const account = await creditService.ensureAccount(client, {
          accountType, customerId, partnerId: pid, currencyCode: 'USD',
        });
        await client.query('COMMIT');
        return account.id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    const email = `t${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE, TRUE)`,
      [id, email, role],
    );
    return { id, email, role };
  }

  async function makeLocation(name, { isPrimary = false, status = 'active' } = {}) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, is_primary, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [restaurantId, name, isPrimary, status],
    );
    return Number(row.id);
  }

  async function makeDevice({ locationId = null, appKey = 'credit_kiosk', config = {}, mode = null }) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows: [device] } = await pool.query(
      `INSERT INTO restaurant_app_devices
         (restaurant_id, location_id, app_key, device_name, mode, status, config,
          device_token_hash, device_token_expires_at, paired_at)
       VALUES ($1, $2, $3, 'Fixture device', $4, 'paired', $5, $6, NOW() + INTERVAL '90 days', NOW())
       RETURNING id`,
      [restaurantId, locationId, appKey, mode, JSON.stringify(config), hash],
    );
    // Pairing auto-registers the device in restaurant_devices; device auth
    // joins that registry row, so a missing row would fail every request.
    const { rows: [registry] } = await pool.query(
      `SELECT id, status FROM restaurant_devices WHERE source_app_device_id = $1`,
      [device.id],
    );
    expect(registry?.status).toBe('active');
    return { device, token };
  }

  async function seedLedgerTx({
    type, status = 'posted', amountCents, debitAccountId, creditAccountId,
    referenceType, referenceId, metadata, createdAt = null,
    // Migration 477: actor_type 'customer' must resolve to an active
    // customer user, so purchases carry the cardholder as actor_user_id.
    actorType = type === 'purchase' ? 'customer' : 'kiosk',
    actorUserId = type === 'purchase' ? customerId : null,
    // Purchases also require an active partner agreement on the row.
    partnerId: txPartnerId = type === 'purchase' ? partnerId : null,
    agreementId: txAgreementId = type === 'purchase' ? agreementId : null,
  }) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO oxsteed_credit_transactions
         (id, transaction_type, status, debit_account_id, credit_account_id,
          amount_cents, currency_code, idempotency_key, reference_type, reference_id,
          actor_type, actor_user_id, partner_id, agreement_id, metadata, posted_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'USD', $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, COALESCE($16, NOW()))`,
      [id, type, status, debitAccountId, creditAccountId, amountCents,
        `g13g-${id}`, referenceType, referenceId, actorType, actorUserId, txPartnerId, txAgreementId,
        JSON.stringify(metadata), status === 'posted' ? (createdAt || new Date()) : null, createdAt],
    );
    return id;
  }

  const cashierGet = (device, token, path) => request(app)
    .get(`/api/restaurants/${restaurantId}/credit-kiosks/${device.id}${path}`)
    .set('X-Device-Token', token);

  test('681: a location-bound terminal sees only its paired location, as the default', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, '/cashier/locations');
    expect(res.status).toBe(200);
    expect(res.body.pairedLocationId).toBe(locPrimary);
    expect(res.body.defaultLocationId).toBe(locPrimary);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({
      id: locPrimary, name: 'Downtown', isPaired: true,
    });
  });

  test('681: a display kiosk with no location at pairing is bound to the primary store by the DB trigger', async () => {
    // Migration 989 backfills a missing device location with the primary
    // store, so the display kiosk is bound, not unbound: one location,
    // paired, as the default.
    const res = await cashierGet(displayKiosk, displayToken, '/cashier/locations');
    expect(res.status).toBe(200);
    expect(res.body.pairedLocationId).toBe(locPrimary);
    expect(res.body.defaultLocationId).toBe(locPrimary);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({ id: locPrimary, isPaired: true });
  });

  test('681: a device with no binding authorizes nothing (fail-closed service fallback)', async () => {
    // The trigger makes this unreachable for a real device row; the service
    // is tested directly with a bare device record so the fallback is
    // proven anyway: no binding means no locations, never every location.
    const cashierService = require('../services/creditKioskCashier');
    const locations = await cashierService.getAuthorizedLocations(pool, {
      restaurant_id: restaurantId, location_id: null,
    });
    expect(locations).toEqual([]);
    expect(cashierService.defaultLocationId({ location_id: null }, locations)).toBeNull();
  });

  test('681: a second terminal bound elsewhere sees only its own location', async () => {
    const res = await cashierGet(otherDevice, otherToken, '/cashier/locations');
    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({ id: locSecond, isPaired: true });
    expect(res.body.defaultLocationId).toBe(locSecond);
  });

  test('681: another device\'s token cannot read this device\'s locations', async () => {
    const res = await cashierGet(kioskDevice, otherToken, '/cashier/locations');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_device_credential');
  });

  test('681: no token cannot read the locations', async () => {
    const res = await request(app)
      .get(`/api/restaurants/${restaurantId}/credit-kiosks/${kioskDevice.id}/cashier/locations`);
    expect(res.status).toBe(401);
  });

  test('681: a queue-board display is not a cashier device', async () => {
    const res = await cashierGet(queueDevice, queueToken, '/cashier/locations');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_kiosk_cashier_device_required');
  });

  test('681: the device must belong to the restaurant in the path', async () => {
    const res = await request(app)
      .get(`/api/restaurants/${restaurantId + 9999}/credit-kiosks/${kioskDevice.id}/cashier/locations`)
      .set('X-Device-Token', kioskToken);
    expect(res.status).toBe(401);
  });

  test('684: lookup by card last-4 finds this device\'s card transactions, including the order purchase via the card join', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, '/cashier/transactions?q=4242');
    expect(res.status).toBe(200);
    const ids = res.body.transactions.map((tx) => tx.id);
    expect(ids).toEqual(expect.arrayContaining([redemptionTxId, cashOutTxId, orderTxId, yesterdayTxId]));
    expect(ids).not.toContain(otherDeviceTxId);
    expect(res.body.transactions.every((tx) => tx.cardLast4 === '4242')).toBe(true);
  });

  test('684: lookup by bare attempt id finds only the kiosk credit order', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, `/cashier/transactions?q=${orderAttemptId}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0]).toMatchObject({
      id: orderTxId, kind: 'redemption', attemptId: orderAttemptId,
      orderId: String(orderId), queueNumber: orderQueueNumber, amountCents: 1800,
    });
  });

  test('684: lookup by full attempt key and by transaction id both resolve', async () => {
    const byKey = await cashierGet(kioskDevice, kioskToken, `/cashier/transactions?q=credit-kiosk:${kioskDevice.id}:${orderAttemptId}`);
    expect(byKey.body.transactions.map((tx) => tx.id)).toEqual([orderTxId]);
    const byId = await cashierGet(kioskDevice, kioskToken, `/cashier/transactions?q=${redemptionTxId}`);
    expect(byId.body.transactions.map((tx) => tx.id)).toEqual([redemptionTxId]);
    const byQueue = await cashierGet(kioskDevice, kioskToken, '/cashier/transactions?q=42');
    expect(byQueue.body.transactions.map((tx) => tx.id)).toContain(orderTxId);
  });

  test('684: type, amount, and date filters narrow the device\'s transactions', async () => {
    const cashOuts = await cashierGet(kioskDevice, kioskToken, '/cashier/transactions?type=cash_out');
    expect(cashOuts.body.transactions.map((tx) => tx.id)).toEqual([cashOutTxId]);
    const redemptions = await cashierGet(kioskDevice, kioskToken, '/cashier/transactions?type=redemption');
    expect(redemptions.body.transactions.map((tx) => tx.id))
      .toEqual(expect.arrayContaining([redemptionTxId, orderTxId, yesterdayTxId]));
    expect(redemptions.body.transactions.map((tx) => tx.id)).not.toContain(cashOutTxId);
    const byAmount = await cashierGet(kioskDevice, kioskToken, '/cashier/transactions?amountCents=2500');
    expect(byAmount.body.transactions.map((tx) => tx.id)).toEqual([redemptionTxId]);
    const today = new Date().toISOString().slice(0, 10);
    const todayRows = await cashierGet(kioskDevice, kioskToken, `/cashier/transactions?date=${today}`);
    expect(todayRows.body.transactions.map((tx) => tx.id)).not.toContain(yesterdayTxId);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const yesterdayRows = await cashierGet(kioskDevice, kioskToken, `/cashier/transactions?date=${yesterday}`);
    expect(yesterdayRows.body.transactions.map((tx) => tx.id)).toEqual([yesterdayTxId]);
  });

  test('684: a single transaction reads by id; another device\'s is 404, not 403', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, `/cashier/transactions/${cashOutTxId}`);
    expect(res.status).toBe(200);
    expect(res.body.transaction).toMatchObject({ id: cashOutTxId, kind: 'cash_out', amountCents: 1000 });
    const other = await cashierGet(kioskDevice, kioskToken, `/cashier/transactions/${otherDeviceTxId}`);
    expect(other.status).toBe(404);
    expect(other.body.code).toBe('credit_kiosk_transaction_not_found');
    const missing = await cashierGet(kioskDevice, kioskToken, `/cashier/transactions/${crypto.randomUUID()}`);
    expect(missing.status).toBe(404);
  });

  test('684: lookup without a device token is 401', async () => {
    const res = await request(app)
      .get(`/api/restaurants/${restaurantId}/credit-kiosks/${kioskDevice.id}/cashier/transactions?q=4242`);
    expect(res.status).toBe(401);
  });

  test('683: the unfiltered list is the device\'s authorized transactions, newest first', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, '/cashier/transactions');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.transactions.map((tx) => tx.id)).toEqual([
      orderTxId, cashOutTxId, redemptionTxId, yesterdayTxId,
    ]);
    expect(res.body.transactions.map((tx) => tx.kind)).toEqual([
      'redemption', 'cash_out', 'redemption', 'redemption',
    ]);
  });

  test('683: the list excludes another device\'s transactions and non-kiosk purchases', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, '/cashier/transactions');
    const ids = res.body.transactions.map((tx) => tx.id);
    expect(ids).not.toContain(otherDeviceTxId);
    // The decoy purchase (same customer, same restaurant, no kioskDeviceId)
    // is a real ledger row and still never appears for the device.
    expect(res.body.transactions.some((tx) => tx.amountCents === 7700)).toBe(false);
    // The other device sees only its own redemption.
    const other = await cashierGet(otherDevice, otherToken, '/cashier/transactions');
    expect(other.body.total).toBe(1);
    expect(other.body.transactions.map((tx) => tx.id)).toEqual([otherDeviceTxId]);
  });

  test('683: the list paginates with a stable total', async () => {
    const first = await cashierGet(kioskDevice, kioskToken, '/cashier/transactions?limit=2');
    expect(first.body.transactions.map((tx) => tx.id)).toEqual([orderTxId, cashOutTxId]);
    expect(first.body.total).toBe(4);
    const rest = await cashierGet(kioskDevice, kioskToken, '/cashier/transactions?limit=2&offset=2');
    expect(rest.body.transactions.map((tx) => tx.id)).toEqual([redemptionTxId, yesterdayTxId]);
    expect(rest.body.total).toBe(4);
  });
});
