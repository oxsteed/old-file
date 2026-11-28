'use strict';

// Credit redesign checkpoint 2 (D-795/D-796/D-797/D-798/D-803): bank-like
// account identity over HTTP — account details mint a stable 10-digit
// account number + 8-digit member code, the Send drawer resolves a
// recipient by account number or card number, the account letter needs a
// fresh step-up challenge, and every money-out path refuses while the
// rail is paused.
//
// Runs against a dedicated fresh database (credit_statement_test_creditredesign)
// so redesign fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.CREDIT_REDESIGN_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_creditredesign') {
    throw new Error('Credit redesign DB tests require the loopback credit_statement_test_creditredesign database');
  }
  process.env.DATABASE_URL = dbUrl;
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-credit-redesign';
process.env.OXSTEED_CREDIT_STEPUP_PEPPER = process.env.JWT_SECRET;
// The customer-transfer kill switch defaults off; enable it here so the
// transfer path reaches the rail gate it is meant to pin.
process.env.OXSTEED_CREDIT_ALLOW_CUSTOMER_TRANSFERS = 'true';

jest.setTimeout(120000);

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Credit redesign checkpoint 2: account identity, recipient resolve, account letter, rail-off', () => {
  const { generateTokens } = require('../middleware/auth');
  const { errorHandler } = require('../middleware/errorHandler');
  const oxsteedCreditRouter = require('../routes/oxsteedCredit');
  const pool = require('../db');

  let app;
  let customer;
  let recipient;
  let customerToken;
  let recipientToken;

  const makeUser = async ({ role, firstName, lastName }) => {
    const { rows: [row] } = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'x', $2, $3, $4, TRUE, NOW(), NOW()) RETURNING id, email, role`,
      [`redesign-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`, firstName, lastName, role],
    );
    return row;
  };

  const makeAccount = async (customerId, currencyCode = 'USD') => {
    const { rows: [row] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, status, balance_cents, reserved_cents, ledger_version)
       VALUES ('customer_wallet', $1, $2, 'active', 0, 0, 0) RETURNING id`,
      [customerId, currencyCode],
    );
    return row;
  };

  const setRailEnabled = (enabled) => pool.query(
    "UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'",
    [enabled],
  );

  const authAs = (token) => ({ Authorization: `Bearer ${token}` });

  const stepupCodeHash = (code) => crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(`stepup:${code}`)
    .digest('hex');

  const insertStepupChallenge = async (userId) => {
    const { rows: [row] } = await pool.query(
      `INSERT INTO oxsteed_credit_stepup_challenges
         (actor_user_id, action_type, amount_cents, currency_code, code_hash, method, max_attempts, expires_at)
       VALUES ($1, 'account_letter', 1, 'USD', $2, 'email', 5, NOW() + INTERVAL '10 minutes')
       RETURNING id`,
      [userId, stepupCodeHash('123456')],
    );
    return row.id;
  };

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/oxsteed-credit', oxsteedCreditRouter);
    app.use(errorHandler);

    customer = await makeUser({ role: 'customer', firstName: 'Ada', lastName: 'Credit' });
    recipient = await makeUser({ role: 'customer', firstName: 'Bo', lastName: 'Receiver' });
    customerToken = generateTokens({ id: customer.id, role: 'customer', email: customer.email }).accessToken;
    recipientToken = generateTokens({ id: recipient.id, role: 'customer', email: recipient.email }).accessToken;
    await makeAccount(customer.id, 'USD');
    await makeAccount(recipient.id, 'USD');
    await setRailEnabled(true);
  });

  afterAll(async () => {
    await pool.end();
  });

  test('account details mint a stable 10-digit account number and 8-digit member code', async () => {
    const first = await request(app)
      .get('/api/oxsteed-credit/account-details')
      .set(authAs(customerToken))
      .expect(200);
    const second = await request(app)
      .get('/api/oxsteed-credit/account-details')
      .set(authAs(customerToken))
      .expect(200);

    const details = first.body.details;
    expect(details.accountNumber).toMatch(/^8\d{9}$/);
    expect(details.memberCode).toMatch(/^[1-9]\d{7}$/);
    expect(details.accountHolderName).toBe('Ada Credit');
    // Stable across reads: the number is minted once, never re-rolled.
    expect(second.body.details.accountNumber).toBe(details.accountNumber);
    expect(second.body.details.memberCode).toBe(details.memberCode);
  });

  test('a second currency account gets its own account number but the same member code', async () => {
    await makeAccount(customer.id, 'EUR');
    const response = await request(app)
      .get('/api/oxsteed-credit/account-details')
      .query({ currencyCode: 'EUR' })
      .set(authAs(customerToken))
      .expect(200);
    const usd = await request(app)
      .get('/api/oxsteed-credit/account-details')
      .set(authAs(customerToken))
      .expect(200);

    expect(response.body.details.accountNumber).toMatch(/^8\d{9}$/);
    expect(response.body.details.accountNumber).not.toBe(usd.body.details.accountNumber);
    expect(response.body.details.memberCode).toBe(usd.body.details.memberCode);
  });

  test('the Send drawer resolves a recipient by account number', async () => {
    const details = await request(app)
      .get('/api/oxsteed-credit/account-details')
      .set(authAs(recipientToken))
      .expect(200);
    const response = await request(app)
      .post('/api/oxsteed-credit/transfer-recipients/resolve')
      .set(authAs(customerToken))
      .send({ accountNumber: details.body.details.accountNumber })
      .expect(200);

    expect(response.body.recipient.customerId).toBe(String(recipient.id));
    expect(response.body.recipient.displayName).toBe('Bo Receiver');
  });

  test('resolving by an unknown account number is a 404, never a guess', async () => {
    const response = await request(app)
      .post('/api/oxsteed-credit/transfer-recipients/resolve')
      .set(authAs(customerToken))
      .send({ accountNumber: '8123456789' })
      .expect(404);
    expect(response.body.code).toBe('credit_recipient_not_found');
  });

  test('resolving needs exactly one identifier', async () => {
    await request(app)
      .post('/api/oxsteed-credit/transfer-recipients/resolve')
      .set(authAs(customerToken))
      .send({})
      .expect(400);
    await request(app)
      .post('/api/oxsteed-credit/transfer-recipients/resolve')
      .set(authAs(customerToken))
      .send({ accountNumber: '8123456789', cardNumber: '9700123456789012' })
      .expect(400);
  });

  test('the account letter needs a fresh step-up challenge', async () => {
    const response = await request(app)
      .post('/api/oxsteed-credit/account-details/letter')
      .set(authAs(customerToken))
      .send({ currencyCode: 'USD' })
      .expect(403);
    expect(response.body.code).toBe('credit_stepup_challenge_required');
  });

  test('the account letter downloads once per challenge and is audit-logged', async () => {
    const challengeId = await insertStepupChallenge(customer.id);
    const details = await request(app)
      .get('/api/oxsteed-credit/account-details')
      .set(authAs(customerToken))
      .expect(200);
    const response = await request(app)
      .post('/api/oxsteed-credit/account-details/letter')
      .set(authAs(customerToken))
      .send({ currencyCode: 'USD', stepupChallengeId: challengeId, stepupCode: '123456' })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain(details.body.details.accountNumber);
    expect(response.text).toContain(details.body.details.memberCode);
    expect(response.text).toContain('not a bank routing number');
    expect(response.text).toContain('Ada Credit');

    const { rows } = await pool.query(
      "SELECT action_type FROM oxsteed_credit_audit_events WHERE action_type = 'credit.account_letter.downloaded' AND actor_user_id = $1",
      [customer.id],
    );
    expect(rows.length).toBeGreaterThan(0);

    // The challenge is consumed: a second download with it fails.
    await request(app)
      .post('/api/oxsteed-credit/account-details/letter')
      .set(authAs(customerToken))
      .send({ currencyCode: 'USD', stepupChallengeId: challengeId, stepupCode: '123456' })
      .expect(403);
  });

  test('a wrong step-up code does not reveal the letter', async () => {
    const challengeId = await insertStepupChallenge(customer.id);
    const response = await request(app)
      .post('/api/oxsteed-credit/account-details/letter')
      .set(authAs(customerToken))
      .send({ currencyCode: 'USD', stepupChallengeId: challengeId, stepupCode: '000000' })
      .expect(403);
    expect(response.body.code).toBe('credit_stepup_challenge_invalid');
  });

  test('every money-out path refuses while the rail is paused', async () => {
    await setRailEnabled(false);
    try {
      const cases = [
        ['top-up', () => request(app).post('/api/oxsteed-credit/topups').set(authAs(customerToken)).set('Idempotency-Key', 'redesign-rail-off-topup').send({ amountCents: 1000, currencyCode: 'USD' })],
        ['transfer', () => request(app).post('/api/oxsteed-credit/transfers').set(authAs(customerToken)).set('Idempotency-Key', 'redesign-rail-off-transfer').send({ recipientCustomerId: recipient.id, amountCents: 100, currencyCode: 'USD' })],
        ['hold', () => request(app).post('/api/oxsteed-credit/holds').set(authAs(customerToken)).set('Idempotency-Key', 'redesign-rail-off-hold').send({ partnerId: 999999, amountCents: 100, currencyCode: 'USD', purpose: 'test', orderType: 'pickup' })],
        ['withdrawal', () => request(app).post('/api/oxsteed-credit/withdrawals').set(authAs(customerToken)).set('Idempotency-Key', 'redesign-rail-off-withdrawal').send({ amountCents: 5000, currencyCode: 'USD' })],
        ['conversion quote', () => request(app).post('/api/oxsteed-credit/conversion-quotes').set(authAs(customerToken)).send({ sourceCurrency: 'USD', targetCurrency: 'EUR', sourceAmountMinorUnits: 100 })],
      ];
      for (const [label, call] of cases) {
        const response = await call();
        expect({ label, status: response.status, code: response.body.code })
          .toEqual({ label, status: 503, code: 'credit_rail_suspended' });
      }
    } finally {
      await setRailEnabled(true);
    }
  });
});
