'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const cardController = require('../controllers/oxsteedCreditCardController');
const cardService = require('../services/oxsteedCreditCardService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const CARD_ID = '99999999-9999-4999-8999-999999999999';

function createCustomerApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: CUSTOMER_ID, role: 'customer' };
    req.correlationId = 'request-credit-card-test';
    next();
  });
  app.get('/cards', cardController.listMyCards);
  app.post('/cards/virtual', cardController.issueMyVirtualCard);
  app.post('/cards/physical', cardController.requestMyPhysicalCard);
  app.post('/cards/:cardId/freeze', cardController.freezeMyCard);
  app.post('/cards/:cardId/unfreeze', cardController.unfreezeMyCard);
  app.post('/cards/:cardId/pin', cardController.setMyCardPin);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
});

// ---------------------------------------------------------------------------
// Pure helper behavior (no DB): credential/activation-code generation, hashing
// ---------------------------------------------------------------------------

describe('card credential primitives', () => {
  it('generates unique, sufficiently long virtual credentials', () => {
    const a = cardService.generateCredential();
    const b = cardService.generateCredential();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates activation codes without visually ambiguous characters', () => {
    const code = cardService.generateActivationCode();
    expect(code).toHaveLength(10);
    expect(code).not.toMatch(/[0O1IL]/);
  });

  it('hashes credentials deterministically with sha256', () => {
    const raw = 'sample-credential-value';
    expect(cardService.sha256Hex(raw)).toEqual(crypto.createHash('sha256').update(raw).digest('hex'));
    expect(cardService.sha256Hex(raw)).toEqual(cardService.sha256Hex(raw));
  });
});

describe('formatCard redaction', () => {
  it('never exposes credential_hash, pin_hash, pin_salt, or activation_code_hash', () => {
    const formatted = cardService.formatCard({
      id: CARD_ID,
      customer_id: CUSTOMER_ID,
      account_id: 501,
      card_type: 'virtual',
      status: 'active',
      fulfillment_status: 'not_applicable',
      credential_hash: 'deadbeef',
      credential_last4: 'AB12',
      pin_hash: 'pinhash',
      pin_salt: 'pinsalt',
      activation_code_hash: 'codehash',
      failed_pin_attempts: 0,
    });
    const serialized = JSON.stringify(formatted);
    expect(serialized).not.toContain('deadbeef');
    expect(serialized).not.toContain('pinhash');
    expect(serialized).not.toContain('pinsalt');
    expect(serialized).not.toContain('codehash');
    expect(formatted.hasCredential).toBe(true);
    expect(formatted.credentialLast4).toBe('AB12');
    expect(formatted.hasPin).toBe(true);
  });

  it('surfaces a raw credential only when explicitly issued this call', () => {
    const formatted = cardService.formatCard({ id: CARD_ID, customer_id: CUSTOMER_ID, account_id: 501, card_type: 'virtual', status: 'active', fulfillment_status: 'not_applicable' }, { includeIssuedCredential: 'raw-value-once' });
    expect(formatted.credential).toBe('raw-value-once');
  });
});

// ---------------------------------------------------------------------------
// Controller-level validation (rejected before any DB call)
// ---------------------------------------------------------------------------

describe('card controller validation', () => {
  it('rejects an invalid card id before querying the database', async () => {
    const app = createCustomerApp();
    const res = await request(app).post('/cards/not-a-uuid/freeze').send({ reason: 'lost phone' });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a physical card request without a shipping address', async () => {
    const app = createCustomerApp();
    const res = await request(app)
      .post('/cards/physical')
      .set('Idempotency-Key', 'req-physical-1')
      .send({ currencyCode: 'USD' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('credit_card_shipping_address_required');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects issuing a card without an Idempotency-Key', async () => {
    const app = createCustomerApp();
    const res = await request(app).post('/cards/virtual').send({ currencyCode: 'USD' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('credit_idempotency_key_required');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric PIN', async () => {
    const app = createCustomerApp();
    const res = await request(app).post(`/cards/${CARD_ID}/pin`).send({ pin: 'abcd' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('credit_card_pin_invalid');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path: issuing a virtual card end to end against the mocked pool
// ---------------------------------------------------------------------------

describe('issueVirtualCard', () => {
  it('mints a card tied to the customer account and returns the raw credential once', async () => {
    // The test harness runs withTransaction's operation directly against
    // pool.query (see __tests__/setup.js), so no BEGIN/COMMIT calls appear
    // here -- only the queries the service itself issues, in order.
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // idempotency lookup: no existing card
      .mockResolvedValueOnce({ rows: [] }) // lockCreditRail advisory lock
      .mockResolvedValueOnce({ rows: [{ is_enabled: true }] }) // isCreditRailEnabled
      .mockResolvedValueOnce({ rows: [] }) // assertCreditRailNotFrozen: no open freeze (Phase 4)
      .mockResolvedValueOnce({ rows: [] }) // ensureAccount insert ON CONFLICT DO NOTHING
      .mockResolvedValueOnce({ rows: [{ id: 501, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, currency_code: 'USD', status: 'active', balance_cents: 0, reserved_cents: 0 }] }) // ensureAccount select
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID, account_id: 501, card_type: 'virtual', status: 'active', fulfillment_status: 'not_applicable', credential_hash: 'x'.repeat(64), credential_last4: 'AB12', issued_at: new Date() }] }) // card insert
      .mockResolvedValueOnce({ rows: [] }); // audit event insert

    const app = createCustomerApp();
    const res = await request(app)
      .post('/cards/virtual')
      .set('Idempotency-Key', 'issue-virtual-1')
      .send({ currencyCode: 'USD', nickname: 'My OxSteed Card' });

    expect(res.status).toBe(201);
    expect(res.body.card.status).toBe('active');
    expect(res.body.card.cardType).toBe('virtual');
    expect(typeof res.body.card.credential).toBe('string');
    expect(res.body.card.credential.length).toBeGreaterThanOrEqual(32);
    // The stored hash must never be echoed back to the client.
    expect(JSON.stringify(res.body)).not.toContain('x'.repeat(64));
  });

  it('replays idempotently without minting a second card', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID, account_id: 501, card_type: 'virtual', status: 'active', fulfillment_status: 'not_applicable', credential_hash: 'x'.repeat(64), credential_last4: 'AB12' }] }); // idempotency lookup: existing card found

    const app = createCustomerApp();
    const res = await request(app)
      .post('/cards/virtual')
      .set('Idempotency-Key', 'issue-virtual-1')
      .send({ currencyCode: 'USD' });

    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
    // A replay must never re-mint or return a fresh raw credential.
    expect(res.body.card.credential).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PIN lockout behavior on the shared card service (unit-level, direct call)
// ---------------------------------------------------------------------------

describe('admin card issuance', () => {
  it('rejects admin issuance with no identified actor at all', async () => {
    await expect(cardService.adminIssueVirtualCard({
      customerId: CUSTOMER_ID,
      currencyCode: 'USD',
      idempotencyKey: 'admin-issue-1',
      actorUserId: null, // no administrator identified
    })).rejects.toMatchObject({ code: 'credit_card_admin_actor_required' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('keeps the admin issuance HTTP routes behind requireSuperAdmin, not the customer-facing pipeline', () => {
    const adminRoutesSource = require('fs').readFileSync(require.resolve('../routes/admin'), 'utf8');
    expect(adminRoutesSource).toMatch(/router\.post\('\/super\/oxsteed-credit\/cards\/issue-virtual',\s*requireSuperAdmin/);
    expect(adminRoutesSource).toMatch(/router\.post\('\/super\/oxsteed-credit\/cards\/issue-physical',\s*requireSuperAdmin/);
    // The customer-facing router must never expose the admin-issuance handlers.
    const customerRoutesSource = require('fs').readFileSync(require.resolve('../routes/oxsteedCredit'), 'utf8');
    expect(customerRoutesSource).not.toContain('adminIssueVirtualCard');
    expect(customerRoutesSource).not.toContain('adminIssuePhysicalCard');
  });

  it('lets an administrator issue a virtual card directly to a customer who never applied', async () => {
    const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // idempotency lookup: no existing card
      .mockResolvedValueOnce({ rows: [] }) // lockCreditRail advisory lock
      .mockResolvedValueOnce({ rows: [{ is_enabled: true }] }) // isCreditRailEnabled
      .mockResolvedValueOnce({ rows: [] }) // assertCreditRailNotFrozen: no open freeze (Phase 4)
      .mockResolvedValueOnce({ rows: [] }) // ensureAccount insert ON CONFLICT DO NOTHING
      .mockResolvedValueOnce({ rows: [{ id: 501, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, currency_code: 'USD', status: 'active', balance_cents: 0, reserved_cents: 0 }] }) // ensureAccount select
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID, account_id: 501, card_type: 'virtual', status: 'active', fulfillment_status: 'not_applicable', credential_hash: 'y'.repeat(64), credential_last4: 'CD34' }] }) // card insert
      .mockResolvedValueOnce({ rows: [] }); // audit event insert

    const result = await cardService.adminIssueVirtualCard({
      customerId: CUSTOMER_ID,
      currencyCode: 'USD',
      idempotencyKey: 'admin-issue-2',
      actorUserId: ADMIN_ID,
      reason: 'Support-driven replacement per ticket #4821',
    });

    expect(result.replayed).toBe(false);
    expect(result.card.status).toBe('active');
    expect(typeof result.card.credential).toBe('string');
  });
});

describe('cashOutWithCard PIN handling', () => {
  it('rejects cash-out when the card has no PIN configured', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID }] }) // resolveCardIdentityByCredential
      .mockResolvedValueOnce({ rows: [{ id: 501, customer_id: CUSTOMER_ID, currency_code: 'USD' }] }) // findCustomerAccount
      .mockResolvedValueOnce({ rows: [] }) // getExistingCashOutTransaction: no replay
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID, account_id: 501, status: 'active', owner_is_active: true, pin_hash: null, pin_salt: null, failed_pin_attempts: 0, pin_locked_until: null, expires_at: null, credential_last4: 'AB12' }] }) // resolveCardByCredential
      .mockResolvedValueOnce({ rows: [{ is_active: true }] }); // assertCardOwnerIsActive

    await expect(cardService.cashOutWithCard({
      credential: 'raw-credential',
      pin: '1234',
      kioskDeviceId: 42,
      amountCents: 2000,
      currencyCode: 'USD',
      idempotencyKey: 'cash-out-1',
    })).rejects.toMatchObject({ code: 'credit_card_pin_not_set' });
  });

  it('rejects cash-out when the card owner is deactivated (H17)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID }] }) // resolveCardIdentityByCredential
      .mockResolvedValueOnce({ rows: [{ id: 501, customer_id: CUSTOMER_ID, currency_code: 'USD' }] }) // findCustomerAccount
      .mockResolvedValueOnce({ rows: [] }) // getExistingCashOutTransaction: no replay
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID, account_id: 501, status: 'active', owner_is_active: false, pin_hash: 'x', pin_salt: 'y', failed_pin_attempts: 0, pin_locked_until: null, expires_at: null, credential_last4: 'AB12' }] }); // resolveCardByCredential

    await expect(cardService.cashOutWithCard({
      credential: 'raw-credential',
      pin: '1234',
      kioskDeviceId: 42,
      amountCents: 2000,
      currencyCode: 'USD',
      idempotencyKey: 'cash-out-inactive',
    })).rejects.toMatchObject({ code: 'credit_card_customer_inactive', statusCode: 403 });
  });

  it('rejects an idempotent replay whose key was used by a different card (H3)', async () => {
    const otherCardId = '88888888-8888-4888-8888-888888888888';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID }] }) // resolveCardIdentityByCredential
      .mockResolvedValueOnce({ rows: [{ id: 501, customer_id: CUSTOMER_ID, currency_code: 'USD' }] }) // findCustomerAccount
      .mockResolvedValueOnce({
        rows: [{
          id: 'txn-1',
          transaction_type: 'cash_out',
          debit_customer_id: CUSTOMER_ID,
          amount_cents: 2000,
          currency_code: 'USD',
          metadata: { cardId: otherCardId },
        }],
      }); // getExistingCashOutTransaction: replay bound to another card

    await expect(cardService.cashOutWithCard({
      credential: 'raw-credential',
      pin: '1234',
      kioskDeviceId: 42,
      amountCents: 2000,
      currencyCode: 'USD',
      idempotencyKey: 'cash-out-replay-mismatch',
    })).rejects.toMatchObject({ code: 'credit_idempotency_conflict', statusCode: 409 });
  });

  it('rejects an idempotent replay whose key was used for a different amount (H3)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID }] }) // resolveCardIdentityByCredential
      .mockResolvedValueOnce({ rows: [{ id: 501, customer_id: CUSTOMER_ID, currency_code: 'USD' }] }) // findCustomerAccount
      .mockResolvedValueOnce({
        rows: [{
          id: 'txn-1',
          transaction_type: 'cash_out',
          debit_customer_id: CUSTOMER_ID,
          amount_cents: 9999,
          currency_code: 'USD',
          metadata: { cardId: CARD_ID },
        }],
      }); // getExistingCashOutTransaction: replay with different amount

    await expect(cardService.cashOutWithCard({
      credential: 'raw-credential',
      pin: '1234',
      kioskDeviceId: 42,
      amountCents: 2000,
      currencyCode: 'USD',
      idempotencyKey: 'cash-out-replay-amount',
    })).rejects.toMatchObject({ code: 'credit_idempotency_conflict', statusCode: 409 });
  });

  it('replays a matching cash-out idempotently without re-verifying card status (H3)', async () => {
    const replayedTxn = {
      id: 'txn-1',
      transaction_type: 'cash_out',
      debit_customer_id: CUSTOMER_ID,
      amount_cents: 2000,
      currency_code: 'USD',
      metadata: { cardId: CARD_ID },
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID }] }) // resolveCardIdentityByCredential
      .mockResolvedValueOnce({ rows: [{ id: 501, customer_id: CUSTOMER_ID, currency_code: 'USD' }] }) // findCustomerAccount
      .mockResolvedValueOnce({ rows: [replayedTxn] }) // getExistingCashOutTransaction
      .mockResolvedValueOnce({ rows: [] }); // loadAccountEntries

    const result = await cardService.cashOutWithCard({
      credential: 'raw-credential',
      pin: '1234',
      kioskDeviceId: 42,
      amountCents: 2000,
      currencyCode: 'USD',
      idempotencyKey: 'cash-out-replay-ok',
    });
    expect(result.replayed).toBe(true);
    expect(result.transaction.replayed).toBe(true);
  });
});

describe('redeemCardAtPartner PIN requirement (H17)', () => {
  it('rejects redemption without a PIN before any database call', async () => {
    await expect(cardService.redeemCardAtPartner({
      credential: 'raw-credential',
      partnerId: 9,
      amountCents: 1500,
      idempotencyKey: 'redeem-no-pin',
    })).rejects.toMatchObject({ code: 'credit_card_pin_required', statusCode: 400 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects redemption for a deactivated customer', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID, account_id: 501, status: 'active', owner_is_active: false, pin_hash: 'x', pin_salt: 'y', failed_pin_attempts: 0, pin_locked_until: null, expires_at: null, credential_last4: 'AB12' }],
    }); // resolveCardByCredential

    await expect(cardService.redeemCardAtPartner({
      credential: 'raw-credential',
      pin: '1234',
      partnerId: 9,
      amountCents: 1500,
      idempotencyKey: 'redeem-inactive',
    })).rejects.toMatchObject({ code: 'credit_card_customer_inactive', statusCode: 403 });
  });
});

describe('setCardPin current-PIN requirement (M27b)', () => {
  // Domain PIN tests exercise the mutation after step-up. The actual gate is
  // tested separately in oxsteedCreditCardSecurity.test.js, without this spy.
  beforeEach(() => jest.spyOn(require('../services/oxsteedCreditCardSecurity'), 'runVerified')
    .mockImplementation((_args, _action, operation) => operation({ query: mockQuery })));
  afterEach(() => jest.restoreAllMocks());
  const cardWithPin = (overrides = {}) => ({
    id: CARD_ID,
    customer_id: CUSTOMER_ID,
    account_id: 501,
    status: 'active',
    card_type: 'virtual',
    fulfillment_status: 'not_applicable',
    credential_last4: 'AB12',
    failed_pin_attempts: 0,
    pin_locked_until: null,
    ...overrides,
  });

  it('allows the initial PIN enrollment without a current PIN', async () => {
    const updated = cardWithPin({ pin_hash: 'newhash', pin_salt: 'newsalt' });
    mockQuery
      .mockResolvedValueOnce({ rows: [cardWithPin({ pin_hash: null, pin_salt: null })] }) // SELECT card FOR UPDATE
      .mockResolvedValueOnce({ rows: [updated] }) // UPDATE ... RETURNING *
      .mockResolvedValueOnce({ rows: [] }); // audit insert

    const result = await cardService.setCardPin({
      cardId: CARD_ID,
      customerId: CUSTOMER_ID,
      pin: '1234',
      actorUserId: CUSTOMER_ID,
    });
    expect(result.card.hasPin).toBe(true);
  });

  it('rejects a PIN change without the current PIN', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [cardWithPin({ pin_hash: 'oldhash', pin_salt: 'oldsalt' })],
    }); // SELECT card FOR UPDATE

    await expect(cardService.setCardPin({
      cardId: CARD_ID,
      customerId: CUSTOMER_ID,
      pin: '5678',
      actorUserId: CUSTOMER_ID,
    })).rejects.toMatchObject({ code: 'credit_card_current_pin_required', statusCode: 400 });
  });

  it('rejects a PIN change with the wrong current PIN', async () => {
    const salt = 'salty';
    const pinHash = cardService.sha256Hex(`${salt}:1234`);
    mockQuery.mockResolvedValueOnce({
      rows: [cardWithPin({ pin_hash: pinHash, pin_salt: salt })],
    }); // SELECT card FOR UPDATE
    // verifyCardPin UPDATE of failed attempts uses the default empty rows

    await expect(cardService.setCardPin({
      cardId: CARD_ID,
      customerId: CUSTOMER_ID,
      pin: '5678',
      currentPin: '0000',
      actorUserId: CUSTOMER_ID,
    })).rejects.toMatchObject({ code: 'credit_card_pin_incorrect', statusCode: 401 });
  });

  it('accepts a PIN change with the correct current PIN', async () => {
    const salt = 'salty';
    const pinHash = cardService.sha256Hex(`${salt}:1234`);
    const updated = cardWithPin({ pin_hash: 'newhash', pin_salt: 'newsalt' });
    mockQuery
      .mockResolvedValueOnce({ rows: [cardWithPin({ pin_hash: pinHash, pin_salt: salt })] }) // SELECT card FOR UPDATE
      .mockResolvedValueOnce({ rows: [updated] }) // UPDATE ... RETURNING *
      .mockResolvedValueOnce({ rows: [] }); // audit insert

    const result = await cardService.setCardPin({
      cardId: CARD_ID,
      customerId: CUSTOMER_ID,
      pin: '5678',
      currentPin: '1234',
      actorUserId: CUSTOMER_ID,
    });
    expect(result.card.hasPin).toBe(true);
  });
});

describe('kiosk idempotency key requirement (H3)', () => {
  function createKioskApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.creditKioskRestaurantId = 7;
      req.creditKioskDevice = { id: 42 };
      req.correlationId = 'kiosk-idempotency-test';
      next();
    });
    app.post('/kiosk/redeem', cardController.kioskRedeemCard);
    app.post('/kiosk/cashout', cardController.kioskCashOut);
    app.use(errorHandler);
    return app;
  }

  it('rejects kiosk redemption without an Idempotency-Key', async () => {
    const app = createKioskApp();
    const res = await request(app).post('/kiosk/redeem').send({ credential: 'raw', pin: '1234', amountCents: 1500 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('credit_idempotency_key_required');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects kiosk cash-out without an Idempotency-Key', async () => {
    const app = createKioskApp();
    const res = await request(app).post('/kiosk/cashout').send({ credential: 'raw', pin: '1234', amountCents: 1500 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('credit_idempotency_key_required');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects kiosk redemption without a PIN', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9 }] }); // requireCreditPartnerForRestaurant
    const app = createKioskApp();
    const res = await request(app)
      .post('/kiosk/redeem')
      .set('Idempotency-Key', 'kiosk-redeem-pin-test')
      .send({ credential: 'raw', amountCents: 1500 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('credit_card_pin_required');
  });
});
