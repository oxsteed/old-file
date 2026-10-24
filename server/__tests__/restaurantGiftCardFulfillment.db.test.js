'use strict';
jest.unmock('pg');
jest.unmock('../utils/transaction');
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));
const crypto = require('crypto'),
  { Pool } = require('pg');
const db = require('../db'),
  scope = require('../services/scopeModel');
const gift = require('../services/restaurantGiftCardService');
const f = require('../services/restaurantGiftCardFulfillment');
const delivery = require('../services/restaurantGiftCardDelivery');
const controller = require('../controllers/restaurantGiftCardController');
const { withTransaction } = require('../utils/transaction');
const email = require('../utils/email');
const url = process.env.GIFT_CARD_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
    u.pathname !== '/gift_card_test'
  )
    throw Error('Requires disposable loopback gift_card_test');
}
(url ? describe : describe.skip)('gift-card full-schema fulfillment', () => {
  let pool, owner, restaurantId, physical, eGift, businessId;
  const run = (fn) => withTransaction(pool, fn, 'gift_card_fixture');
  const input = () =>
    f.normalize({
      recipientEmail: 'recipient@example.invalid',
      language: 'ar',
      message: '<script>bad</script>',
    });
  async function issue(
    productId = eGift,
    key = crypto.randomUUID(),
    args = {},
  ) {
    return run(async (client) => {
      const i =
        productId === physical
          ? f.normalize({ physicalCode: args.physicalCode })
          : input();
      const result = await gift.issueGiftCard(client, {
        restaurantId,
        productId,
        actorUserId: owner,
        idempotencyKey: key,
        requestHash: f.fingerprint(i),
        code: i.physicalCode,
      });
      return {
        ...result,
        fulfillment: await f.create(client, {
          restaurant: { id: restaurantId, display_name: 'Demo Kitchen' },
          result,
          input: i,
        }),
      };
    });
  }
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db.query.mockImplementation((...a) => pool.query(...a));
    db.connect.mockImplementation(() => pool.connect());
    owner = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES($1,$2,'test','Gift','Owner')",
      [owner, `${owner}@example.invalid`],
    );
    ({
      rows: [{ id: businessId }],
    } = await pool.query(
      "INSERT INTO businesses(user_id,business_name) VALUES($1,'Gift fixture') RETURNING id",
      [owner],
    ));
    ({
      rows: [{ id: restaurantId }],
    } = await pool.query(
      "INSERT INTO food_restaurants(business_id,owner_user_id,display_name,timezone) VALUES($1,$2,'Gift Test','America/New_York') RETURNING id",
      [businessId, owner],
    ));
    for (const kind of ['physical', 'e_gift']) {
      const {
        rows: [p],
      } = await pool.query(
        "INSERT INTO restaurant_gift_card_products(restaurant_id,sku,name,amount_cents,currency_code,delivery_type) VALUES($1,$2,'Gift',2500,'USD',$2) RETURNING id",
        [restaurantId, kind],
      );
      if (kind === 'physical') physical = Number(p.id);
      else eGift = Number(p.id);
    }
    scope.resolveRestaurantAccess.mockImplementation(async (user, id) => {
      if (Number(id) !== Number(restaurantId)) throw Error('tenant denied');
      return {
        id: restaurantId,
        business_id: businessId,
        owner_user_id: owner,
        effective_role: 'owner',
        display_name: 'Demo Kitchen',
      };
    });
    email.emailDeliveryAvailable = jest.fn(() => true);
    process.env.RESTAURANT_GIFT_CARD_DELIVERY_ENABLED = 'true';
  });
  afterAll(async () => {
    delete process.env.RESTAURANT_GIFT_CARD_DELIVERY_ENABLED;
    await pool?.end();
  });
  beforeEach(async () => {
    await pool.query(
      "UPDATE restaurant_gift_card_fulfillments SET next_attempt_at=NOW()+INTERVAL '1 year',status=CASE WHEN status='sending' THEN 'needs_review' ELSE status END,lease_token=NULL,lease_expires_at=NULL",
    );
  });
  test('parallel issue retries create one funded card and one encrypted envelope', async () => {
    const key = crypto.randomUUID(),
      [a, b] = await Promise.all([issue(eGift, key), issue(eGift, key)]);
    expect(a.card.id).toBe(b.card.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const fresh = a.code ? a : b,
      row = await f.get(pool, restaurantId, a.card.id);
    expect(row.payload_ciphertext).not.toContain(fresh.code);
    expect(row.payload_ciphertext).not.toContain('recipient@example.invalid');
    expect(f.readPayload(row).code).toBe(fresh.code);
    expect(f.render(f.readPayload(row)).html).not.toContain('<script>');
    expect(f.render(f.readPayload(row)).html).toContain('dir="rtl"');
    expect(
      (
        await pool.query(
          'SELECT COUNT(*) AS n FROM restaurant_gift_card_ledger WHERE gift_card_id=$1',
          [a.card.id],
        )
      ).rows[0].n,
    ).toBe('1');
    await expect(
      run((c) =>
        gift.issueGiftCard(c, {
          restaurantId,
          productId: physical,
          actorUserId: owner,
          idempotencyKey: key,
          requestHash: 'different',
        }),
      ),
    ).rejects.toMatchObject({ code: 'gift_card_issue_conflict' });
  });
  test('recipient validation rolls back issued value and ledger', async () => {
    const before = (
      await pool.query(
        'SELECT COUNT(*) FROM restaurant_gift_cards WHERE restaurant_id=$1',
        [restaurantId],
      )
    ).rows[0].count;
    await expect(
      run(async (c) => {
        const r = await gift.issueGiftCard(c, {
          restaurantId,
          productId: eGift,
          actorUserId: owner,
          idempotencyKey: crypto.randomUUID(),
        });
        await f.create(c, {
          restaurant: { id: restaurantId },
          result: r,
          input: f.normalize({}),
        });
      }),
    ).rejects.toMatchObject({ code: 'gift_card_recipient_required' });
    expect(
      (
        await pool.query(
          'SELECT COUNT(*) FROM restaurant_gift_cards WHERE restaurant_id=$1',
          [restaurantId],
        )
      ).rows[0].count,
    ).toBe(before);
  });
  test('preprinted code, protected artifact, handoff proof and payload purge', async () => {
    const r = await issue(physical, crypto.randomUUID(), {
      physicalCode: 'ABCD2345EFGH6789',
    });
    expect(r.card.code).toBe('ABCD2345EFGH6789');
    expect(
      (await gift.lookupGiftCard(pool, { restaurantId, code: r.card.code })).id,
    ).toBe(r.card.id);
    const result = await run((c) =>
      f.handoff(c, restaurantId, r.card.id, owner, 'receipt-42'),
    );
    expect(result.status).toBe('handed_out');
    expect(
      (await f.get(pool, restaurantId, r.card.id)).payload_ciphertext,
    ).toBeNull();
    await expect(
      run((c) => f.handoff(c, restaurantId, r.card.id, owner, 'other')),
    ).rejects.toMatchObject({ code: 'gift_card_handoff_conflict' });
    expect(
      (
        await run((c) =>
          f.handoff(c, restaurantId, r.card.id, owner, 'receipt-42'),
        )
      ).status,
    ).toBe('handed_out');
  });
  test('worker acceptance is distinct from delivery and poll purges the code', async () => {
    const r = await issue(),
      send = jest.fn(async () => ({ success: true, id: crypto.randomUUID() }));
    expect(
      await delivery.processGiftCardDelivery({ db: pool, send }),
    ).toMatchObject({ claimed: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    let row = await f.get(pool, restaurantId, r.card.id);
    expect(row.status).toBe('accepted');
    await pool.query(
      'UPDATE restaurant_gift_card_fulfillments SET next_attempt_at=NOW() WHERE id=$1',
      [row.id],
    );
    const inspect = jest.fn(async () => ({
      success: true,
      event: 'delivered',
    }));
    await delivery.processGiftCardDelivery({ db: pool, send, inspect });
    row = await f.get(pool, restaurantId, r.card.id);
    expect(row.status).toBe('delivered');
    expect(row.payload_ciphertext).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
  test('network retry keeps provider identity; old uncertain sends require evidence', async () => {
    const r = await issue(),
      send = jest.fn(async () => ({ success: false }));
    await delivery.processGiftCardDelivery({ db: pool, send });
    const row = await f.get(pool, restaurantId, r.card.id);
    const first = send.mock.calls[0][0];
    await pool.query(
      'UPDATE restaurant_gift_card_fulfillments SET next_attempt_at=NOW() WHERE id=$1',
      [row.id],
    );
    await delivery.processGiftCardDelivery({ db: pool, send });
    expect(send.mock.calls[1][0]).toEqual(first);
    await pool.query(
      "UPDATE restaurant_gift_card_fulfillments SET next_attempt_at=NOW(),first_attempt_at=NOW()-INTERVAL '24 hours' WHERE id=$1",
      [row.id],
    );
    await delivery.processGiftCardDelivery({ db: pool, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect((await f.get(pool, restaurantId, r.card.id)).status).toBe(
      'needs_review',
    );
    const resolved = await run((c) =>
      f.resolve(c, restaurantId, r.card.id, {
        action: 'confirm_not_sent',
        evidence: 'provider-log-1',
        recipientEmail: 'corrected@example.invalid',
      }),
    );
    expect(resolved.fulfillment.status).toBe('pending');
    const corrected = await f.get(pool, restaurantId, r.card.id);
    expect(corrected.provider_key).not.toBe(row.provider_key);
    expect(f.readPayload(corrected).to).toBe('corrected@example.invalid');
  });
  test('concurrent workers lease a delivery only once', async () => {
    await issue();
    const send = jest.fn(async () => ({
      success: true,
      id: crypto.randomUUID(),
    }));
    await Promise.all([
      delivery.processGiftCardDelivery({ db: pool, send }),
      delivery.processGiftCardDelivery({ db: pool, send }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  test('reconciliation is immutable, currency separated, stale after a redemption, and never adjusts value', async () => {
    const r = await issue(),
      data = {
        source: 'external-ledger',
        externalReference: 'statement-001',
        currencyCode: 'USD',
        externalBalanceCents: 2400,
        note: 'Review mismatch',
      };
    const saved = await run((c) =>
      f.reconcile(c, restaurantId, r.card.id, owner, data),
    );
    expect(Number(saved.variance_cents)).toBe(-100);
    expect(
      (await run((c) => f.reconcile(c, restaurantId, r.card.id, owner, data)))
        .id,
    ).toBe(saved.id);
    await expect(
      run((c) =>
        f.reconcile(c, restaurantId, r.card.id, owner, {
          ...data,
          externalBalanceCents: 0,
        }),
      ),
    ).rejects.toMatchObject({ code: 'gift_card_reconciliation_conflict' });
    expect(
      (await gift.lookupGiftCard(pool, { restaurantId, code: r.card.code }))
        .balanceCents,
    ).toBe(2500);
    await expect(
      pool.query(
        'UPDATE restaurant_gift_card_reconciliations SET variance_cents=0 WHERE id=$1',
        [saved.id],
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(
        'DELETE FROM restaurant_gift_card_ledger WHERE gift_card_id=$1',
        [r.card.id],
      ),
    ).rejects.toThrow(/append-only/);
    await run((c) =>
      gift.redeemGiftCard(c, {
        restaurantId,
        code: r.card.code,
        amountCents: 100,
        currencyCode: 'USD',
        actorUserId: owner,
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    const report = await f.report(pool, restaurantId);
    expect(
      report.rows.find((x) => Number(x.id) === r.card.id).statement_current,
    ).toBe(false);
    await expect(
      run((c) =>
        f.reconcile(c, restaurantId, r.card.id, owner, {
          ...data,
          currencyCode: 'JPY',
        }),
      ),
    ).rejects.toMatchObject({ code: 'gift_card_currency_mismatch' });
  });
  test('cross-restaurant fulfillment and statement access is rejected', async () => {
    const r = await issue();
    await expect(
      f.get(pool, Number(restaurantId) + 100000, r.card.id),
    ).rejects.toMatchObject({ code: 'gift_card_fulfillment_not_found' });
    await expect(
      run((c) =>
        f.reconcile(c, Number(restaurantId) + 100000, r.card.id, owner, {
          source: 'external',
          externalReference: '1',
          currencyCode: 'USD',
          externalBalanceCents: 0,
        }),
      ),
    ).rejects.toMatchObject({ code: 'gift_card_not_found' });
  });
  test('delivery disabled performs no provider request', async () => {
    await issue();
    process.env.RESTAURANT_GIFT_CARD_DELIVERY_ENABLED = 'false';
    const send = jest.fn();
    expect(
      await delivery.processGiftCardDelivery({ db: pool, send }),
    ).toMatchObject({ skipped: true });
    expect(send).not.toHaveBeenCalled();
    process.env.RESTAURANT_GIFT_CARD_DELIVERY_ENABLED = 'true';
  });
  test('print controller sets private headers and refuses reprints after handoff', async () => {
    const r = await issue(physical),
      req = {
        params: {
          restaurantId: String(restaurantId),
          cardId: String(r.card.id),
        },
        user: { id: owner },
        body: {},
        query: {},
        get: () => '',
      };
    const res = {
      set: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    const next = jest.fn();
    await controller.printCard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0]).toContain(r.code);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      }),
    );
    await run((c) =>
      f.handoff(c, restaurantId, r.card.id, owner, 'fixture-handoff'),
    );
    await controller.printCard(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'gift_card_state_invalid' }),
    );
  });
  test('required controller audit failure rolls back card and delivery together', async () => {
    const connection = await pool.connect(),
      query = connection.query.bind(connection);
    connection.query = (sql, ...args) => {
      if (String(sql).includes('INSERT INTO business_audit_log'))
        throw Error('injected audit failure');
      return query(sql, ...args);
    };
    db.connect.mockResolvedValueOnce(connection);
    const req = {
      params: { restaurantId: String(restaurantId) },
      user: { id: owner },
      body: { productId: eGift, recipientEmail: 'recipient@example.invalid' },
      query: {},
      get: () => `rollback-${crypto.randomUUID()}`,
    };
    const res = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      },
      next = jest.fn();
    const before = (
      await pool.query(
        'SELECT COUNT(*) FROM restaurant_gift_cards WHERE restaurant_id=$1',
        [restaurantId],
      )
    ).rows[0].count;
    await controller.issueValue(req, res, next);
    connection.query = query;
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'injected audit failure' }),
    );
    expect(res.json).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          'SELECT COUNT(*) FROM restaurant_gift_cards WHERE restaurant_id=$1',
          [restaurantId],
        )
      ).rows[0].count,
    ).toBe(before);
  });
  test('stale provider acknowledgements cannot overwrite a replacement lease', async () => {
    const r = await issue();
    let release, start;
    const started = new Promise((resolve) => (start = resolve));
    const send = () => {
      start();
      return new Promise((resolve) => (release = resolve));
    };
    const work = delivery.processGiftCardDelivery({ db: pool, send });
    await started;
    await pool.query(
      'UPDATE restaurant_gift_card_fulfillments SET lease_token=$2 WHERE gift_card_id=$1',
      [r.card.id, crypto.randomUUID()],
    );
    release({ success: true, id: crypto.randomUUID() });
    expect(await work).toMatchObject({ acknowledged: 0 });
    expect((await f.get(pool, restaurantId, r.card.id)).status).toBe('sending');
  });
  test('expired uncertain delivery can be closed with evidence without code access', async () => {
    const r = await issue();
    await pool.query(
      "UPDATE restaurant_gift_card_fulfillments SET status='needs_review',payload_ciphertext=NULL WHERE gift_card_id=$1",
      [r.card.id],
    );
    const input = {
      action: 'confirm_delivered',
      evidence: 'provider-accepted-and-delivered',
    };
    const a = await run((c) => f.resolve(c, restaurantId, r.card.id, input));
    expect(a.fulfillment.status).toBe('delivered');
    const b = await run((c) => f.resolve(c, restaurantId, r.card.id, input));
    expect(b.fulfillment.status).toBe('delivered');
  });
  test('retention purges expired physical artifacts while sending is disabled', async () => {
    const r=await issue(physical);
    await pool.query("UPDATE restaurant_gift_card_fulfillments SET payload_expires_at=NOW()-INTERVAL '1 day' WHERE gift_card_id=$1",[r.card.id]);
    process.env.RESTAURANT_GIFT_CARD_DELIVERY_ENABLED='false';
    try {
      const send=jest.fn();await delivery.processGiftCardDelivery({db:pool,send});expect(send).not.toHaveBeenCalled();
      const row=await f.get(pool,restaurantId,r.card.id);expect(row.payload_ciphertext).toBeNull();expect(row.status).toBe('needs_review');expect(()=>f.readPayload(row)).toThrow(/expired/);
      expect((await run(c=>f.handoff(c,restaurantId,r.card.id,owner,'previously-printed'))).status).toBe('handed_out');
    } finally {process.env.RESTAURANT_GIFT_CARD_DELIVERY_ENABLED='true';}
  });
  test('a provider bounce is failed delivery rather than a delivered gift', async () => {
    const r=await issue();await delivery.processGiftCardDelivery({db:pool,send:async()=>({success:true,id:crypto.randomUUID()})});
    await pool.query('UPDATE restaurant_gift_card_fulfillments SET next_attempt_at=NOW() WHERE gift_card_id=$1',[r.card.id]);
    await delivery.processGiftCardDelivery({db:pool,inspect:async()=>({success:true,event:'bounced'})});
    expect((await f.get(pool,restaurantId,r.card.id)).status).toBe('failed');
  });

});
