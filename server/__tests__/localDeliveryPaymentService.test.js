'use strict';

// Optional real PostgreSQL-engine verification without a server, credentials or
// network. Install @electric-sql/pglite in a disposable directory, then set
// DELIVERY_PAYMENT_TEST_PGLITE to that package's absolute directory and run Jest
// with NODE_OPTIONS=--experimental-vm-modules. The normal
// suite can skip this harness; hook delegation tests run without this dependency.
const fs = require('fs');
const path = require('path');
jest.unmock('../utils/transaction');
const { createService } = require('../services/localDeliveryPaymentService');

const enginePath = process.env.DELIVERY_PAYMENT_TEST_PGLITE;
const describeWithEngine = enginePath ? describe : describe.skip;
const customer = '00000000-0000-4000-8000-000000000001';
const admin = '00000000-0000-4000-8000-000000000002';
const copy = value => JSON.parse(JSON.stringify(value));

describeWithEngine('local delivery payment service against isolated PostgreSQL engine', () => {
  let pg, db, service, stripe, issueRefund, sessions, refunds, checkoutKeys, refundKeys;
  let time, jobId, extraId, pendingRefund;
  const read = name => fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8');
  const run = (sql, values) => pg.query(sql, values);
  const row = async (sql, values = []) => (await run(sql, values)).rows[0];
  const base = extra => service.createBaseCheckout({ deliveryJobId: jobId, customerUserId: customer, ...extra });
  const extra = args => service.createExtraCheckout({ extraId, customerUserId: customer, ...args });
  const sync = paymentId => service.syncPayment({ paymentId, customerUserId: customer });
  const refund = (paymentId, target, args = {}) => service.refundPayment({ paymentId,
    actor: { id: admin, role: 'admin' }, targetRefundedAmountCents: target, reason: 'Approved adjustment', ...args });
  const paymentRow = id => row('SELECT * FROM delivery_payments WHERE id = $1', [id]);
  const ledgerRows = async () => (await run('SELECT * FROM platform_ledger ORDER BY id')).rows;
  const latestSession = () => [...sessions.values()].at(-1);

  function settle(session = latestSession(), refunded = 0) {
    session.status = 'complete';
    session.payment_status = 'paid';
    session.url = null;
    session.payment_intent = {
      id: `pi_${session.id}`, metadata: copy(session.metadata), amount: session.amount_total,
      amount_received: session.amount_total, currency: session.currency, status: 'succeeded',
      latest_charge: { id: `ch_${session.id}`, payment_intent: `pi_${session.id}`,
        amount: session.amount_total, currency: session.currency, paid: true, captured: true,
        amount_refunded: refunded, receipt_url: 'https://pay.stripe.com/receipts/test' },
    };
    return session;
  }

  beforeAll(async () => {
    const { PGlite } = require(enginePath);
    pg = new PGlite();
    await pg.exec(`CREATE TABLE users (id UUID PRIMARY KEY);
      CREATE TABLE jobs (id UUID PRIMARY KEY);
      INSERT INTO users VALUES ('${customer}'), ('${admin}');`);
    const initial = read('001_initial_schema.sql');
    await pg.exec(initial.slice(initial.indexOf('CREATE TABLE platform_ledger ('),
      initial.indexOf('-- ─── NOTIFICATIONS')));
    for (const name of ['566_local_delivery_mvp.sql', '570_local_delivery_operations.sql',
      '571_local_delivery_integrity.sql', '574_local_delivery_payment_service.sql']) await pg.exec(read(name));
    // One PGlite connection: serialize whole transactions. This checks actual SQL
    // and rollback, but does NOT claim to test PostgreSQL multi-connection locks.
    let tail = Promise.resolve();
    db = {
      query: (...args) => pg.query(...args),
      connect: async () => {
        const previous = tail;
        let release;
        tail = new Promise(resolve => { release = resolve; });
        await previous;
        return { query: (...args) => db.query(...args), release };
      },
    };
  }, 60000);

  afterAll(async () => { if (pg) await pg.close(); });

  beforeEach(async () => {
    await pg.exec('TRUNCATE delivery_jobs, delivery_quotes, platform_ledger RESTART IDENTITY CASCADE');
    time = 0;
    sessions = new Map(); refunds = new Map(); checkoutKeys = new Map(); refundKeys = new Map();
    pendingRefund = false;
    jobId = (await row(`INSERT INTO delivery_jobs
      (reference, customer_user_id, origin_address, origin_lat, origin_lng,
       destination_address, destination_lat, destination_lng, distance_miles,
       package_type, price_snapshot, customer_total_cents, driver_payout_cents)
      VALUES ('TEST-1',$1,'Origin',1,1,'Destination',2,2,5,'small','{}',2000,1200) RETURNING id`, [customer])).id;
    const quote = await row(`INSERT INTO delivery_quotes
      (delivery_job_id, customer_user_id, request_hash, input_snapshot, price_snapshot,
       customer_total_cents, driver_payout_cents, expires_at, accepted_at, accepted_by_user_id)
      VALUES ($1,$2,$3,'{}','{}',2000,1200,NOW() + INTERVAL '15 minutes', NOW(),$2) RETURNING id`,
    [jobId, customer, 'a'.repeat(64)]);
    await run('UPDATE delivery_jobs SET quote_id = $2 WHERE id = $1', [jobId, quote.id]);
    extraId = (await row(`INSERT INTO delivery_extras
      (delivery_job_id, category, amount_cents, approved_amount_cents, notes, status,
       reviewed_by_user_id, reviewed_at, payment_status)
      VALUES ($1,'tolls',900,500,'Approved reduced toll amount','approved',$2,NOW(),'requires_action') RETURNING id`,
    [jobId, customer])).id;
    stripe = {
      checkout: { sessions: {
        create: jest.fn(async (request, options) => {
          if (checkoutKeys.has(options.idempotencyKey)) return copy(sessions.get(checkoutKeys.get(options.idempotencyKey)));
          const session = { id: `cs_${sessions.size + 1}`, mode: request.mode, status: 'open',
            payment_status: 'unpaid', payment_intent: null, client_reference_id: request.client_reference_id,
            metadata: copy(request.metadata), amount_total: request.line_items[0].price_data.unit_amount,
            currency: request.line_items[0].price_data.currency, url: 'https://checkout.stripe.com/test' };
          sessions.set(session.id, session); checkoutKeys.set(options.idempotencyKey, session.id);
          return copy(session);
        }),
        retrieve: jest.fn(async id => copy(sessions.get(id))),
      } },
      paymentIntents: { retrieve: jest.fn(async id => copy([...sessions.values()].find(s => s.payment_intent?.id === id)?.payment_intent)) },
      charges: { retrieve: jest.fn(async id => copy([...sessions.values()].find(s => s.payment_intent?.latest_charge?.id === id)?.payment_intent.latest_charge)) },
      refunds: { retrieve: jest.fn(async id => copy(refunds.get(id))) },
    };
    issueRefund = jest.fn(async (intent, amount, key) => {
      if (refundKeys.has(key)) return copy(refunds.get(refundKeys.get(key)));
      const session = [...sessions.values()].find(s => s.payment_intent?.id === intent);
      const result = { id: `re_${refunds.size + 1}`, payment_intent: intent, amount,
        currency: 'usd', status: pendingRefund ? 'pending' : 'succeeded' };
      if (!pendingRefund) session.payment_intent.latest_charge.amount_refunded += amount;
      refunds.set(result.id, result); refundKeys.set(key, result.id);
      return copy(result);
    });
    service = createService({ db, getStripe: () => stripe, issueRefund,
      now: () => Date.now() + time, appUrl: () => 'https://example.test', paymentsEnabled: () => true });
  });

  test('migration is additive and re-applicable', async () => {
    await pg.exec(read('574_local_delivery_payment_service.sql'));
    expect((await extra()).payment.amount_cents).toBe(500);
  });

  test('base and approved extra amounts come from database, ignoring caller amount/key/redirect', async () => {
    const a = await base({ amountCents: 1, currency: 'JPY', idempotencyKey: 'caller-a', appUrl: 'https://evil.test' });
    const b = await extra({ amountCents: 1, idempotencyKey: 'caller-b' });
    expect(a.payment.amount_cents).toBe(2000);
    expect(b.payment.amount_cents).toBe(500);
    expect(b.payment.receipt_url).toBeNull();
    expect(b.checkoutUrl).toBe('https://checkout.stripe.com/test');
    expect(stripe.checkout.sessions.create.mock.calls[0][0].success_url).toMatch(/^https:\/\/example.test\//);
    expect(stripe.checkout.sessions.create.mock.calls[1][0].payment_intent_data.metadata).toEqual(latestSession().metadata);
  });

  test('different caller keys and simultaneous checkout requests share one obligation/session', async () => {
    const results = await Promise.all([base({ idempotencyKey: 'one' }), base({ idempotencyKey: 'two' }), base()]);
    expect(new Set(results.map(r => r.payment.id)).size).toBe(1);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(sessions.size).toBe(1);
  });

  test('database uniqueness rejects duplicate financial obligations', async () => {
    await base();
    await expect(run(`INSERT INTO delivery_payments
      (delivery_job_id,customer_user_id,amount_cents,idempotency_key,service_version)
      VALUES ($1,$2,2000,'another-key',1)`, [jobId, customer])).rejects.toMatchObject({ code: '23505' });
  });

  test.each(['pending', 'rejected', 'voided'])('rejects %s extras', async status => {
    await run('UPDATE delivery_extras SET status = $1 WHERE id = $2', [status, extraId]);
    await expect(extra()).rejects.toMatchObject({ code: 'delivery_extra_not_approved' });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('requires approved amount, accepted quote, owner and supported currency', async () => {
    await run('UPDATE delivery_extras SET approved_amount_cents = NULL WHERE id = $1', [extraId]);
    await expect(extra()).rejects.toMatchObject({ code: 'delivery_payment_amount_invalid' });
    await expect(base({ customerUserId: admin })).rejects.toMatchObject({ status: 404 });
    await run("UPDATE delivery_quotes SET currency = 'JPY'");
    await expect(base()).rejects.toMatchObject({ code: 'delivery_payment_currency_unsupported' });
    await run("UPDATE delivery_quotes SET currency = 'USD', accepted_at = NULL");
    await expect(base()).rejects.toMatchObject({ code: 'delivery_payment_quote_required' });
    expect(sessions.size).toBe(0);
  });

  test('legacy sessions block new charges regardless of caller key', async () => {
    await run(`INSERT INTO delivery_payments (delivery_job_id,customer_user_id,amount_cents,idempotency_key)
      VALUES ($1,$2,2000,'old-controller-key')`, [jobId, customer]);
    await expect(base()).rejects.toMatchObject({ code: 'delivery_payment_reconciliation_required' });
    expect(sessions.size).toBe(0);
  });

  test('lost Stripe response retries the committed attempt with unchanged key and payload', async () => {
    const create = stripe.checkout.sessions.create.getMockImplementation();
    stripe.checkout.sessions.create.mockImplementationOnce(async (...args) => { await create(...args); throw new Error('network lost'); });
    await expect(base()).rejects.toThrow('network lost');
    expect((await row('SELECT COUNT(*) AS n FROM delivery_payment_attempts')).n).toBe(1);
    await base({ idempotencyKey: 'different' });
    expect(stripe.checkout.sessions.create.mock.calls[0]).toEqual(stripe.checkout.sessions.create.mock.calls[1]);
    expect(sessions.size).toBe(1);
  });

  test('uncertain creation older than safe retry window fails closed', async () => {
    stripe.checkout.sessions.create.mockRejectedValueOnce(new Error('network lost'));
    await expect(base()).rejects.toThrow('network lost');
    time += 24 * 60 * 60 * 1000;
    await expect(base()).rejects.toMatchObject({ code: 'delivery_payment_reconciliation_required' });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  test('completed webhook recovers a lost session response and posts ledger once', async () => {
    const create = stripe.checkout.sessions.create.getMockImplementation();
    stripe.checkout.sessions.create.mockImplementationOnce(async (...args) => { await create(...args); throw new Error('network lost'); });
    await expect(base()).rejects.toThrow();
    const session = settle();
    const event = { type: 'checkout.session.completed', data: { object: copy(session) } };
    await service.handleStripeEvent(event);
    await service.handleStripeEvent(event);
    expect(await ledgerRows()).toHaveLength(1);
    expect((await paymentRow(1)).status).toBe('paid');
  });

  test('only definitively expired unpaid session gets a new canonical generation', async () => {
    const first = await base();
    latestSession().status = 'expired';
    const second = await base();
    expect(first.payment.id).toBe(second.payment.id);
    expect(sessions.size).toBe(2);
    expect(stripe.checkout.sessions.create.mock.calls[1][1].idempotencyKey).toMatch(/checkout:2$/);
    expect((await run('SELECT status FROM delivery_payment_attempts ORDER BY generation')).rows.map(r => r.status)).toEqual(['expired', 'open']);
  });

  test('approved amount changes cannot silently create a replacement charge', async () => {
    await extra();
    await run('UPDATE delivery_extras SET approved_amount_cents = 600 WHERE id = $1', [extraId]);
    await expect(extra()).rejects.toMatchObject({ code: 'delivery_payment_amount_conflict' });
    expect(sessions.size).toBe(1);
  });

  test.each([
    ['session identity', s => { s.id = 'cs_other'; }],
    ['client identity', s => { s.client_reference_id = '999'; }],
    ['customer metadata', s => { s.metadata.customerUserId = admin; }],
    ['job metadata', s => { s.metadata.deliveryJobId = '999'; }],
    ['extra metadata', s => { s.metadata.deliveryExtraId = '999'; }],
    ['amount', s => { s.amount_total = 1; }],
    ['currency', s => { s.currency = 'eur'; }],
    ['intent amount', s => { s.payment_intent.amount = 1; }],
    ['intent metadata', s => { s.payment_intent.metadata.source = 'other'; }],
    ['received amount', s => { s.payment_intent.amount_received = 1; }],
    ['charge identity', s => { s.payment_intent.latest_charge.payment_intent = 'pi_other'; }],
    ['charge amount', s => { s.payment_intent.latest_charge.amount = 1; }],
    ['charge currency', s => { s.payment_intent.latest_charge.currency = 'eur'; }],
    ['charge capture', s => { s.payment_intent.latest_charge.captured = false; }],
    ['refund overflow', s => { s.payment_intent.latest_charge.amount_refunded = 9999; }],
  ])('rejects mismatched %s without ledger or paid mutation', async (_name, mutate) => {
    const result = await base();
    mutate(settle());
    await expect(sync(result.payment.id)).rejects.toMatchObject({ code: 'delivery_payment_verification_failed' });
    expect(await ledgerRows()).toHaveLength(0);
    expect((await paymentRow(result.payment.id)).status).toBe('pending');
  });

  test('capture records real receipt and duplicate/late failed events do not regress state', async () => {
    const result = await extra(); settle();
    const paid = await sync(result.payment.id);
    expect(paid.payment.receipt_url).toBe('https://pay.stripe.com/receipts/test');
    expect(paid.checkoutUrl).toBeNull();
    await sync(result.payment.id);
    await service.handleStripeEvent({ type: 'payment_intent.payment_failed', data: { object: {
      ...copy(latestSession().payment_intent), status: 'requires_payment_method', last_payment_error: { message: 'stale' },
    } } });
    expect((await paymentRow(result.payment.id)).status).toBe('paid');
    expect(await ledgerRows()).toHaveLength(1);
    expect((await row('SELECT payment_status FROM delivery_extras WHERE id = $1', [extraId])).payment_status).toBe('captured');
  });

  test('partial, duplicate, full and out-of-order refund events append only incremental ledger amounts', async () => {
    const result = await base(); settle();
    const charge = latestSession().payment_intent.latest_charge;
    charge.amount_refunded = 400;
    const event = { type: 'charge.refunded', data: { object: copy(charge) } };
    await service.handleStripeEvent(event); await service.handleStripeEvent(event);
    expect((await paymentRow(result.payment.id)).status).toBe('paid');
    charge.amount_refunded = 2000;
    await service.handleStripeEvent({ ...event, data: { object: copy(charge) } });
    await service.handleStripeEvent(event);
    expect((await ledgerRows()).map(r => r.amount_cents)).toEqual([2000, -400, -1600]);
    expect((await sync(result.payment.id)).payment.status).toBe('refunded');
    expect(sessions.size).toBe(1);
  });

  test('database rollback after Stripe success recovers without duplicated ledger', async () => {
    const result = await base(); settle();
    const query = db.query;
    let failOnce = true;
    db.query = async (sql, values) => {
      if (failOnce && sql.includes('UPDATE delivery_payments SET status = $2')) { failOnce = false; throw new Error('DB outage'); }
      return query(sql, values);
    };
    try { await expect(sync(result.payment.id)).rejects.toThrow('DB outage'); } finally { db.query = query; }
    expect(await ledgerRows()).toHaveLength(0);
    await sync(result.payment.id);
    expect(await ledgerRows()).toHaveLength(1);
  });

  test('refunds reuse authoritative refund service and canonical cumulative target', async () => {
    const result = await base(); settle(); await sync(result.payment.id);
    const a = await refund(result.payment.id, 500);
    expect(a.payment.refunded_amount_cents).toBe(500);
    await refund(result.payment.id, 500);
    await refund(result.payment.id);
    expect(issueRefund.mock.calls.map(c => c[1])).toEqual([500, 1500]);
    expect(issueRefund.mock.calls[0][2]).toMatch(/refund-total:500:v1$/);
    expect((await ledgerRows()).map(r => r.amount_cents)).toEqual([2000, -500, -1500]);
  });

  test('pending refunds are not treated as succeeded and block a different target', async () => {
    const result = await base(); settle(); await sync(result.payment.id); pendingRefund = true;
    const response = await refund(result.payment.id, 500);
    expect(response.refundStatus).toBe('pending');
    expect(response.payment.refunded_amount_cents).toBe(0);
    await expect(refund(result.payment.id, 1000)).rejects.toMatchObject({ code: 'delivery_refund_pending' });
    await refund(result.payment.id, 500);
    expect(issueRefund).toHaveBeenCalledTimes(1);
    const provider = refunds.get(response.refundId); provider.status = 'succeeded';
    latestSession().payment_intent.latest_charge.amount_refunded = 500;
    await service.handleStripeEvent({ type: 'refund.updated', data: { object: copy(provider) } });
    expect((await row('SELECT status FROM delivery_payment_refunds')).status).toBe('succeeded');
    expect((await paymentRow(result.payment.id)).refunded_amount_cents).toBe(500);
  });

  test('uncertain refund response can be replayed without a second provider refund', async () => {
    const result = await base(); settle(); await sync(result.payment.id);
    const create = issueRefund.getMockImplementation();
    issueRefund.mockImplementationOnce(async (...args) => { await create(...args); throw new Error('refund response lost'); });
    await expect(refund(result.payment.id, 500)).rejects.toThrow('refund response lost');
    await refund(result.payment.id, 500);
    expect(refunds.size).toBe(1);
    expect((await paymentRow(result.payment.id)).refunded_amount_cents).toBe(500);
  });

  test('authorization and feature gate reject before a provider write', async () => {
    const result = await base();
    await expect(service.syncPayment({ paymentId: result.payment.id, customerUserId: admin })).rejects.toMatchObject({ status: 404 });
    await expect(refund(result.payment.id, 100, { actor: { id: customer, role: 'customer' } })).rejects.toMatchObject({ status: 403 });
    const disabled = createService({ db, getStripe: () => stripe, paymentsEnabled: () => false });
    await expect(disabled.createBaseCheckout({ deliveryJobId: jobId, customerUserId: customer })).rejects.toMatchObject({ code: 'feature_disabled' });
    expect(issueRefund).not.toHaveBeenCalled();
  });

  test('platform event scope, foreign provider identities and unknown tagged payments fail closed', async () => {
    await base(); settle();
    const event = { type: 'checkout.session.completed', data: { object: copy(latestSession()) } };
    await expect(service.handleStripeEvent({ ...event, account: 'acct_foreign' })).rejects.toMatchObject({ code: 'delivery_payment_verification_failed' });
    event.data.object.metadata.deliveryPaymentId = '999'; event.data.object.id = 'cs_unknown';
    await expect(service.handleStripeEvent(event)).rejects.toMatchObject({ code: 'delivery_payment_reconciliation_required' });
    expect(await ledgerRows()).toHaveLength(0);
    await expect(service.handleStripeEvent({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_unrelated' } } })).resolves.toEqual({ handled: false });
  });
});
