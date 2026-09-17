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

describe('cashOutWithCard PIN handling', () => {
  it('rejects cash-out when the card has no PIN configured', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // getExistingTransaction: no replay
      .mockResolvedValueOnce({ rows: [{ id: CARD_ID, customer_id: CUSTOMER_ID, account_id: 501, status: 'active', pin_hash: null, pin_salt: null, failed_pin_attempts: 0, pin_locked_until: null, expires_at: null, credential_last4: 'AB12' }] }); // resolveCardByCredential

    await expect(cardService.cashOutWithCard({
      credential: 'raw-credential',
      pin: '1234',
      kioskDeviceId: 42,
      amountCents: 2000,
      currencyCode: 'USD',
      idempotencyKey: 'cash-out-1',
    })).rejects.toMatchObject({ code: 'credit_card_pin_not_set' });
  });
});
