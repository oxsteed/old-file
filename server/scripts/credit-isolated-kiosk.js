'use strict';

const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');

const target = new URL(process.env.DATABASE_URL || 'http://invalid');
if (process.env.NODE_ENV !== 'test' || target.hostname !== 'postgres'
    || target.pathname !== '/oxsteed_db'
    || !/^oxsteed-credit-test-[a-z0-9-]+$/.test(process.env.CREDIT_TEST_PROJECT || '')
    || process.env.OXSTEED_CREDIT_CHECKOUT_KIOSK_ID !== '8900001') {
  throw new Error('Run this verifier only inside the disposable Credit kiosk harness.');
}

const pool = require('../db');
const credit = require('../services/oxsteedCreditService');
const cards = require('../services/oxsteedCreditCardService');
const { tokenHash } = require('../services/restaurantDeviceCredentials');
const admin = '22222222-2222-4222-8222-222222222222';
const customer = '66666666-6666-4666-8666-666666666666';
const owner = '33333333-3333-4333-8333-333333333333';
const kiosk = 8900001;
const otherKiosk = 8900002;
const token = randomBytes(32).toString('hex');
const otherToken = randomBytes(32).toString('hex');
const credential = cards.generateCredential();
const pin = '6294';
const checkoutPath = id => `/api/restaurants/901/devices/${id}/screen-credit-orders`;

async function request(path, { body, headers = {}, method, expected } = {}) {
  const response = await fetch(`http://127.0.0.1:5000${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (expected) {
    assert.ok([expected].flat().includes(response.status), `${method || 'request'} ${path.split('/').slice(0, -1).join('/')} expected ${expected}, got ${response.status} (${result.code || 'unknown'}: ${result.error || ''})`);
  }
  return { status: response.status, result };
}

async function run() {
  await pool.query(`UPDATE businesses SET is_listed=TRUE, setup_status='active', business_kind='restaurant' WHERE id=901`);
  await pool.query(`UPDATE food_restaurants SET screens_v2_enabled=TRUE, accepts_in_store_orders=TRUE WHERE id=901`);
  await pool.query(`INSERT INTO restaurant_locations (id,restaurant_id,name) VALUES (8900001,901,'Synthetic kiosk store') ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO food_menu_items (id,restaurant_id,name,price_cents) VALUES (8900001,901,'Synthetic kiosk item',700) ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO credit_participants
    (partner_id,participant_type,restaurant_id,status,didit_verified,didit_verified_at,allowed_surfaces)
    VALUES (901,'restaurant',901,'active',TRUE,NOW(),ARRAY['food_pos','food_online'])
    ON CONFLICT (partner_id,participant_type) DO UPDATE SET status='active',didit_verified=TRUE,didit_verified_at=NOW(),allowed_surfaces=EXCLUDED.allowed_surfaces`);
  for (const [id, raw] of [[kiosk, token], [otherKiosk, otherToken]]) {
    await pool.query(`INSERT INTO restaurant_app_devices
      (id,restaurant_id,location_id,app_key,device_name,mode,status,config,device_token_hash,device_token_expires_at)
      VALUES ($1,901,8900001,'display','Synthetic kiosk','kiosk','paired','{"screenRole":"kiosk"}',$2,NOW()+INTERVAL '1 hour')
      ON CONFLICT (id) DO UPDATE SET device_token_hash=EXCLUDED.device_token_hash,
        device_token_expires_at=EXCLUDED.device_token_expires_at`, [id, tokenHash(raw)]);
  }
  const salt = randomBytes(16).toString('hex');
  const { rows: [card] } = await pool.query(`INSERT INTO oxsteed_credit_cards
    (customer_id,account_id,card_type,status,fulfillment_status,credential_hash,credential_last4,pin_hash,pin_salt,activated_at)
    VALUES ($1,12001,'physical','active','delivered',$2,$3,$4,$5,NOW()) RETURNING id`,
  [customer, cards.sha256Hex(credential), credential.slice(-4), await cards.hashCardPinScrypt(pin, salt), salt]);
  const balance = async () => Number((await credit.getCustomerCreditAccount(customer, 'USD')).balanceCents);
  await credit.setCreditRailStatus({ enabled: true, actorUserId: admin, reason: 'Disposable kiosk verification' });
  await credit.loadCustomerCredit({
    customerId: customer, amountCents: 1000, actorUserId: admin,
    reason: 'Disposable kiosk verification', idempotencyKey: randomUUID(), referenceId: randomUUID(),
  });
  const before = await balance();
  const body = { items: [{ menuItemId: 8900001, quantity: 1 }], fulfillmentType: 'dine_in' };
  const { result: { quote } } = await request('/api/food/restaurants/901/orders/quote', {
    body: { ...body, orderSource: 'kiosk', paymentMode: 'pay_at_counter', locationId: 8900001 }, expected: 200,
  });
  const send = (attempt, change = {}, deviceId = kiosk, raw = token, expected = 201) =>
    request(checkoutPath(deviceId), {
      headers: { 'X-Device-Token': raw, 'Idempotency-Key': attempt }, expected,
      body: { ...body, credential, pin, expectedTotalCents: quote.totalCents, menuFingerprint: quote.menuFingerprint, ...change },
    });

  await send(randomUUID(), {}, otherKiosk, otherToken, 403);
  await send(randomUUID(), { expectedTotalCents: quote.totalCents + 1 }, kiosk, token, 409);
  await send(randomUUID(), { pin: '0000' }, kiosk, token, 401);
  assert.equal(await balance(), before);
  const pinFailures = await pool.query('SELECT failed_pin_attempts FROM oxsteed_credit_cards WHERE id=$1', [card.id]);
  assert.equal(pinFailures.rows[0].failed_pin_attempts, 1);

  const attempt = randomUUID();
  const submissions = await Promise.all([
    send(attempt, {}, kiosk, token, [200, 201]),
    send(attempt, {}, kiosk, token, [200, 201]),
  ]);
  assert.deepEqual(submissions.map(result => result.status).sort(), [200, 201]);
  const receiptPath = `${checkoutPath(kiosk)}/${attempt}`;
  const { result: { receipt } } = await request(receiptPath, { headers: { 'X-Device-Token': token }, expected: 200 });
  for (const submission of submissions) assert.deepEqual(submission.result, { receipt });
  assert.equal(receipt.paymentStatus, 'paid');
  assert.equal(receipt.amountCents, quote.totalCents);
  assert.equal(await balance(), before - quote.totalCents);
  const conflict = await send(attempt, { expectedTotalCents: quote.totalCents + 1 }, kiosk, token, 409);
  assert.equal(conflict.result.code, 'food_order_idempotency_conflict');
  assert.equal(await balance(), before - quote.totalCents);
  await request(`${checkoutPath(otherKiosk)}/${attempt}`, { headers: { 'X-Device-Token': otherToken }, expected: 404 });
  await request(receiptPath.replace('/901/', '/902/'), { headers: { 'X-Device-Token': token }, expected: 401 });

  const { rows: [sale] } = await pool.query(`SELECT o.metadata, o.location_id, t.transaction_type,
    o.customer_id, a.customer_id AS debit_customer_id, t.reference_id
    FROM food_orders o JOIN oxsteed_credit_transactions t ON t.id::text=o.metadata->>'oxsteedCreditTransactionId'
    JOIN oxsteed_credit_accounts a ON a.id=t.debit_account_id
    WHERE o.id=$1`, [receipt.orderId]);
  assert.equal(sale.transaction_type, 'purchase');
  assert.equal(sale.customer_id, customer);
  assert.equal(sale.debit_customer_id, customer);
  assert.equal(sale.reference_id, receipt.orderId);
  assert.equal(Number(sale.location_id), 8900001);
  assert.equal(sale.metadata.creditKioskDeviceId, String(kiosk));
  assert.equal(JSON.stringify(sale.metadata).includes(credential), false);
  assert.equal(Object.hasOwn(sale.metadata, 'pin'), false);

  const ownerToken = jwt.sign({ id: owner, role: 'helper', typ: 'access', sid: 'isolated-kiosk' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  await request(`/api/food/restaurants/901/orders/${receipt.orderId}/status`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    body: { status: 'cancelled', reason: 'Synthetic kiosk refund' }, expected: 200,
  });
  assert.equal(await balance(), before);
  const { result: { receipt: refunded } } = await request(receiptPath, { headers: { 'X-Device-Token': token }, expected: 200 });
  assert.equal(refunded.paymentStatus, 'refunded');
  console.log('Credit kiosk verified: wrong PIN rollback and durable counter, price conflict, concurrent retry, receipt recovery, device and restaurant isolation, authorized refund.');
}

run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await credit.setCreditRailStatus({ enabled: false, actorUserId: admin, reason: 'Disposable kiosk verification finished' });
  await pool.end();
});
