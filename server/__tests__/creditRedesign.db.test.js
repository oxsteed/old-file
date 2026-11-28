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
const bcrypt = require('bcrypt');
const express = require('express');
const request = require('supertest');

// Checkpoint 3: card numbers are stored encrypted (AES-256-GCM); the
// test key is synthetic and never leaves this disposable test database.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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
  const cardSecurity = require('../services/oxsteedCreditCardSecurity');
  const cardService = require('../services/oxsteedCreditCardService');
  // The dedicated slice DB keeps rows across runs, so every idempotency
  // key and seeded identifier is suffixed with a per-run id.
  const runId = crypto.randomUUID().slice(0, 8);

  let app;
  let customer;
  let recipient;
  let customerToken;
  let recipientToken;
  // Checkpoint 3: a card owner with a real bcrypt password and a verified
  // email, so the card-security step-up can load its context.
  let cardUser;
  let cardToken;
  let cardAccountId;

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

  // Checkpoint 3: insert a card-security challenge directly (the email
  // step is bypassed the same way the step-up tests bypass theirs), with
  // the binding hash the service will recompute at verification time.
  const insertCardSecurityChallenge = async ({ user, cardId, action, token, limits = null }) => {
    const sessionBinding = crypto.createHash('sha256').update(`Bearer ${token}`).digest('hex');
    const args = {
      cardId,
      customerId: user.id,
      sessionBinding,
      activationCode: null,
      pin: null,
      currentPin: null,
      resetPin: false,
      limits: limits || { dailyLimitCents: null, merchantTypeLimits: null },
    };
    const binding = cardSecurity.bindingHash(action, args, user);
    const codeHash = cardSecurity.hash(['card-code', '123456']);
    const { rows: [row] } = await pool.query(
      `INSERT INTO oxsteed_credit_card_security_challenges
         (customer_id, card_id, action, binding_hash, code_hash, expires_at, delivered_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '10 minutes', NOW())
       RETURNING id`,
      [user.id, cardId, action, binding, codeHash],
    );
    return row.id;
  };

  const loadCardUser = async () => {
    const { rows: [row] } = await pool.query(
      `SELECT id, email, password_hash, totp_enabled, totp_secret FROM users WHERE id = $1`,
      [cardUser.id],
    );
    return row;
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
    // Checkpoint 3: the card owner needs a bcrypt password (the step-up
    // verifies it) and a verified email (the security context requires it).
    const passwordHash = await bcrypt.hash('CardPass123!', 10);
    const { rows: [cardRow] } = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, email_verified, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'Cleo', 'Cardholder', 'customer', TRUE, TRUE, NOW(), NOW())
       RETURNING id, email, role`,
      [`redesign-card-${Date.now()}@example.com`, passwordHash],
    );
    cardUser = cardRow;
    cardToken = generateTokens({ id: cardUser.id, role: 'customer', email: cardUser.email }).accessToken;
    const account = await makeAccount(cardUser.id, 'USD');
    cardAccountId = account.id;
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

  // -- Checkpoint 3: closed-loop 16-digit cards (D-798/D-799/D-800/D-804) --

  test('issuing a virtual card mints a 16-digit OxSteed number and a 3-digit security code', async () => {
    const response = await request(app)
      .post('/api/oxsteed-credit/cards/virtual')
      .set(authAs(cardToken))
      .set('Idempotency-Key', `redesign-card-issue-1-${runId}`)
      .send({ currencyCode: 'USD' })
      .expect(201);

    const card = response.body.card;
    expect(card.credential).toMatch(/^9700\d{12}$/);
    expect(card.credential).toHaveLength(16);
    expect(card.securityCode).toMatch(/^[1-9]\d{2}$/);
    expect(card.credentialLast4).toBe(card.credential.slice(-4));
    expect(card.hasRevealableNumber).toBe(true);
    expect(card.hasSecurityCode).toBe(true);
    expect(card.dailyLimitCents).toBe(null);
    // The issued number is Luhn-valid and stored encrypted: the stored
    // row must decrypt back to the number the client saw once.
    const { rows } = await pool.query(
      `SELECT credential_encrypted, credential_hash FROM oxsteed_credit_cards WHERE id = $1`,
      [card.id],
    );
    const { decrypt } = require('../utils/encryption');
    expect(decrypt(rows[0].credential_encrypted)).toBe(card.credential);
    expect(rows[0].credential_hash).toBe(crypto.createHash('sha256').update(card.credential).digest('hex'));
  });

  test('a revealed number needs a verified challenge, is audit-logged, and is notified', async () => {
    const issued = await request(app)
      .post('/api/oxsteed-credit/cards/virtual')
      .set(authAs(cardToken))
      .set('Idempotency-Key', `redesign-card-issue-2-${runId}`)
      .send({ currencyCode: 'USD' })
      .expect(201);
    const cardId = issued.body.card.id;

    // No challenge at all: the step-up refuses before any number is read.
    await request(app)
      .post(`/api/oxsteed-credit/cards/${cardId}/reveal`)
      .set(authAs(cardToken))
      .set('Idempotency-Key', `redesign-card-reveal-no-challenge-${runId}`)
      .send({})
      .expect(403);

    const user = await loadCardUser();
    const challengeId = await insertCardSecurityChallenge({ user, cardId, action: 'reveal', token: cardToken });
    const response = await request(app)
      .post(`/api/oxsteed-credit/cards/${cardId}/reveal`)
      .set(authAs(cardToken))
      .set('Idempotency-Key', `redesign-card-reveal-1-${runId}`)
      .send({ stepupChallengeId: challengeId, stepupCode: '123456' })
      .expect(200);
    expect(response.body.cardNumber).toBe(issued.body.card.credential);
    expect(response.body.card.id).toBe(cardId);

    const { rows: auditRows } = await pool.query(
      "SELECT action_type FROM oxsteed_credit_audit_events WHERE action_type = 'credit.card.revealed' AND resource_id = $1",
      [String(cardId)],
    );
    expect(auditRows.length).toBeGreaterThan(0);
    const { rows: notifRows } = await pool.query(
      "SELECT type FROM notifications WHERE user_id = $1 AND type = 'credit_card_revealed'",
      [cardUser.id],
    );
    expect(notifRows.length).toBeGreaterThan(0);
    // The replay store must never hold the number: the persisted result
    // for this request key contains no 16-digit number.
    const { rows: opRows } = await pool.query(
      `SELECT result FROM oxsteed_credit_card_security_operations WHERE customer_id = $1 AND request_key = $2`,
      [cardUser.id, `redesign-card-reveal-1-${runId}`],
    );
    expect(opRows.length).toBe(1);
    expect(JSON.stringify(opRows[0].result)).not.toContain(issued.body.card.credential);

    // The same request retried replays without the number: start fresh.
    await request(app)
      .post(`/api/oxsteed-credit/cards/${cardId}/reveal`)
      .set(authAs(cardToken))
      .set('Idempotency-Key', `redesign-card-reveal-1-${runId}`)
      .send({ stepupChallengeId: challengeId, stepupCode: '123456' })
      .expect(409);
  });

  test('a legacy card with no encrypted number cannot be revealed', async () => {
    const { rows: [legacy] } = await pool.query(
      `INSERT INTO oxsteed_credit_cards
         (customer_id, account_id, card_type, status, fulfillment_status, credential_hash, credential_last4, activated_at)
       VALUES ($1, $2, 'virtual', 'active', 'not_applicable', $3, 'KEN1', NOW())
       RETURNING id`,
      [cardUser.id, cardAccountId, crypto.createHash('sha256').update(`legacy-base64-token-${runId}`).digest('hex')],
    );
    const user = await loadCardUser();
    const challengeId = await insertCardSecurityChallenge({ user, cardId: legacy.id, action: 'reveal', token: cardToken });
    const response = await request(app)
      .post(`/api/oxsteed-credit/cards/${legacy.id}/reveal`)
      .set(authAs(cardToken))
      .set('Idempotency-Key', `redesign-card-reveal-legacy-${runId}`)
      .send({ stepupChallengeId: challengeId, stepupCode: '123456' })
      .expect(409);
    expect(response.body.code).toBe('credit_card_reveal_unavailable');
  });

  test('limits are set behind step-up and enforced per card and order type', async () => {
    const issued = await request(app)
      .post('/api/oxsteed-credit/cards/virtual')
      .set(authAs(cardToken))
      .set('Idempotency-Key', `redesign-card-issue-3-${runId}`)
      .send({ currencyCode: 'USD' })
      .expect(201);
    const cardId = issued.body.card.id;

    const user = await loadCardUser();
    const limits = { dailyLimitCents: 5000, merchantTypeLimits: { pickup: 3000 } };
    const challengeId = await insertCardSecurityChallenge({ user, cardId, action: 'limits_set', token: cardToken, limits });
    const response = await request(app)
      .post(`/api/oxsteed-credit/cards/${cardId}/limits`)
      .set(authAs(cardToken))
      .set('Idempotency-Key', `redesign-card-limits-1-${runId}`)
      .send({ stepupChallengeId: challengeId, stepupCode: '123456', ...limits })
      .expect(200);
    expect(response.body.card.dailyLimitCents).toBe(5000);
    expect(response.body.card.merchantTypeLimits).toEqual({ pickup: 3000 });

    // Seed one posted pickup purchase of 2500 on this card today. A
    // purchase row needs a real partner + agreement (migration 424
    // integrity trigger) and must credit the partner's payable account
    // (migration 438), so the test builds the minimal chain: an admin
    // creator, an active partner with no restaurant (the kiosk flow has
    // none), an active approved agreement, and the partner payable
    // account. The reference type is the kiosk one, so the food-order
    // ownership guard (migration 498) does not apply.
    const { rows: [admin] } = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'x', 'Test', 'Admin', 'admin', TRUE, NOW(), NOW()) RETURNING id`,
      [`redesign-admin-${runId}@example.com`],
    );
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (status, created_by) VALUES ('active', $1) RETURNING id`,
      [admin.id],
    );
    const { rows: [agreement] } = await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements (partner_id, version, status, starts_at, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW(), $2, $2) RETURNING id`,
      [partner.id, admin.id],
    );
    const { rows: [payable] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, partner_id, currency_code, status, balance_cents, reserved_cents, ledger_version)
       VALUES ('partner_payable', $1, 'USD', 'active', 0, 0, 0) RETURNING id`,
      [partner.id],
    );
    await pool.query(
      `INSERT INTO oxsteed_credit_transactions
         (transaction_type, status, debit_account_id, credit_account_id, amount_cents, currency_code, idempotency_key, reference_type, reference_id, metadata, posted_at, actor_type, actor_user_id, partner_id, agreement_id)
       VALUES ('purchase', 'posted', $1, $2, 2500, 'USD', $4, 'credit_kiosk_redemption', 'kiosk-redesign-seed', $3::jsonb, NOW(), 'customer', $5, $6, $7)`,
      [cardAccountId, payable.id, JSON.stringify({ cardId: String(cardId), cardLast4: issued.body.card.credentialLast4, orderType: 'pickup' }), `redesign-limits-seed-purchase-${runId}`, cardUser.id, partner.id, agreement.id],
    );

    const client = await pool.connect();
    try {
      const { rows: [cardRow] } = await client.query(`SELECT * FROM oxsteed_credit_cards WHERE id = $1`, [cardId]);
      // 2500 already spent on pickup; another 1000 would cross the 3000 pickup cap.
      await expect(cardService.assertCardSpendLimits(client, cardRow, { amountCents: 1000, orderType: 'pickup' }))
        .rejects.toMatchObject({ code: 'credit_card_merchant_type_limit_exceeded' });
      // Delivery has no cap and the daily total (2500 + 100) stays under 5000.
      await cardService.assertCardSpendLimits(client, cardRow, { amountCents: 100, orderType: 'delivery' });
      // A 3000 cash-out would cross the 5000 daily cap.
      await expect(cardService.assertCardSpendLimits(client, cardRow, { amountCents: 3000 }))
        .rejects.toMatchObject({ code: 'credit_card_daily_limit_exceeded' });
    } finally {
      client.release();
    }

    // Activity shows which card was used: the seeded purchase carries its last 4.
    const activity = await request(app)
      .get('/api/oxsteed-credit/transactions')
      .set(authAs(cardToken))
      .expect(200);
    const seeded = (Array.isArray(activity.body) ? activity.body : activity.body.transactions || [])
      .find((row) => row.description === null && row.amountCents === 2500);
    expect(seeded).toBeDefined();
    expect(seeded.cardLast4).toBe(issued.body.card.credentialLast4);
  });
});
