'use strict';

// Group 13 Slice 4c acceptance: Manage credentials (661-665).
// 661/662/663/664 are EXISTS re-checks (evidence in
// docs/persona-roadmap/group13.md); this suite proves them live against
// the endpoints and the services, plus the 665 suspension confirmation
// (D-362/D-363/D-364): a platform freeze/revoke notifies the customer
// with the reason, stores the reason on the card row, shows it on the
// card list and in the customer history, and a platform-frozen card
// cannot be unfrozen by the customer (the customer-only unfreeze guard
// holds because freeze_origin records 'admin').
// Runs against a dedicated fresh database (credit_statement_test_g13c) so
// slice-local fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP13_SLICE4C_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13c') {
    throw new Error('Group 13 Slice 4c DB tests require the loopback credit_statement_test_g13c database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const { tNotif } = require('../utils/i18n');

// Pure localization: no database needed, runs on every invocation.
describe('Group 13 Slice 4c: suspension templates are localized (665, D-362)', () => {
  test.each(['credit_card_frozen', 'credit_card_revoked'])('%s has a title and body in all five languages', (type) => {
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      const n = tNotif(type, lang);
      expect(n.title).toBeTruthy();
      expect(n.body).toBeTruthy();
    }
  });

  test('the two types name different actions', () => {
    expect(tNotif('credit_card_frozen', 'en').title).not.toBe(tNotif('credit_card_revoked', 'en').title);
  });
});

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 13 Slice 4c: credential reads and suspension confirmation (661-665)', () => {
  let pool;
  let cardCtrl;
  let app;
  let admin;
  let cardService;
  let recovery;
  let security;

  beforeAll(async () => {
    pool = require('../db');
    cardService = require('../services/oxsteedCreditCardService');
    recovery = require('../services/oxsteedCreditCardRecovery');
    security = require('../services/oxsteedCreditCardSecurity');
    cardCtrl = require('../controllers/oxsteedCreditCardController');
    const { authenticate } = require('../middleware/auth');
    app = express();
    app.use(express.json());
    app.get('/api/oxsteed-credit/cards', authenticate, cardCtrl.listMyCards);
    app.get('/api/oxsteed-credit/cards/:cardId/history', authenticate, cardCtrl.myCardHistory);
    app.post('/api/oxsteed-credit/cards/:cardId/freeze', authenticate, cardCtrl.freezeMyCard);
    app.use(require('../middleware/errorHandler').errorHandler);

    admin = await makeUser('super_admin');
    // Card issuance requires the credit rail on (assertCreditRailEnabled);
    // this dedicated test DB is only used by this suite.
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'Group 13 Slice 4c test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`,
    );
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
      await pool.end();
    }
  });

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    const email = `t${id}@example.invalid`;
    const passwordHash = await bcrypt.hash('test-password', 4);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, $3, 'Test', 'Fixture', $4, TRUE, TRUE, FALSE)`,
      [id, email, passwordHash, role],
    );
    return { id, email, role };
  }

  async function makeWallet(user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await require('../services/oxsteedCreditService').ensureAccount(client, {
        accountType: 'customer_wallet', customerId: user.id, currencyCode: 'USD',
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

  async function issueCard(user, { physical = false } = {}) {
    await makeWallet(user);
    if (physical) {
      const { card } = await cardService.requestPhysicalCard({
        customerId: user.id,
        currencyCode: 'USD',
        shippingAddress: { line1: '1 Test Street', city: 'Testville', country: 'US' },
        idempotencyKey: `g13c-physical-${crypto.randomUUID()}`,
        actorUserId: user.id,
      });
      return card;
    }
    const { card } = await cardService.issueVirtualCard({
      customerId: user.id,
      currencyCode: 'USD',
      idempotencyKey: `g13c-virtual-${crypto.randomUUID()}`,
      actorUserId: user.id,
    });
    return card;
  }

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const getAs = (user, path) => request(app).get(path).set('Authorization', `Bearer ${tokenFor(user)}`);
  const postAs = (user, path) => request(app).post(path).set('Authorization', `Bearer ${tokenFor(user)}`);

  async function notificationsFor(userId, type) {
    const { rows } = await pool.query(
      `SELECT type, title, body FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at`,
      [userId, type],
    );
    return rows;
  }

  // A real step-up grant for the unfreeze action, inserted the way the
  // security service mints one (binding + code hashes from the service's
  // own helpers, delivered, unexpired). Lets the test drive unfreezeCard
  // through the real verified path without an email round-trip.
  async function grantUnfreeze(user, card) {
    const { rows: [userRow] } = await pool.query(
      `SELECT id, email, email_verified, password_hash, totp_enabled, totp_secret, is_active
         FROM users WHERE id = $1`,
      [user.id],
    );
    const args = {
      customerId: user.id, actorUserId: user.id, cardId: card.id,
      sessionBinding: 'g13c-test-session', idempotencyKey: `g13c-unfreeze-${crypto.randomUUID()}`,
    };
    const grantId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO oxsteed_credit_card_security_challenges
         (id, customer_id, card_id, action, binding_hash, code_hash, expires_at, delivered_at)
       VALUES ($1, $2, $3, 'unfreeze', $4, $5, NOW() + INTERVAL '10 minutes', NOW())`,
      [grantId, user.id, card.id, security.bindingHash('unfreeze', args, userRow), security.hash(['card-code', '123456'])],
    );
    return { ...args, stepupChallengeId: grantId, stepupCode: '123456' };
  }

  test('661 re-check: the card list shows the owner’s cards only, with type/status/fulfillment/PIN state', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const mine = await issueCard(owner);
    await issueCard(other);

    const res = await getAs(owner, '/api/oxsteed-credit/cards');
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(1);
    expect(res.body.cards[0]).toMatchObject({
      id: String(mine.id),
      cardType: 'virtual',
      status: 'active',
      fulfillmentStatus: 'not_applicable',
      hasPin: false,
    });
    expect(res.body.cards[0]).toHaveProperty('credentialLast4');
  });

  test('662 re-check: a pending physical card is listed as pending', async () => {
    const owner = await makeUser();
    const pending = await issueCard(owner, { physical: true });

    const res = await getAs(owner, '/api/oxsteed-credit/cards');
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(1);
    expect(res.body.cards[0]).toMatchObject({ id: String(pending.id), cardType: 'physical', status: 'pending' });
  });

  test('663 re-check: report lost, history, and mark found', async () => {
    const owner = await makeUser();
    const card = await issueCard(owner);

    const lost = await cardService.reportCardLostOrStolen({
      cardId: card.id, customerId: owner.id, status: 'lost', actorUserId: owner.id, reason: 'Left at the market',
    });
    expect(lost.retiredCard.status).toBe('lost');

    const history = await getAs(owner, `/api/oxsteed-credit/cards/${card.id}/history`);
    expect(history.status).toBe(200);
    expect(history.body.events.map((e) => e.action)).toContain('credit.card.lost');

    const found = await recovery.markFound({ cardId: card.id, customerId: owner.id, actorUserId: owner.id });
    expect(found.foundAt).toBeTruthy();
    expect(found.status).toBe('lost');
  });

  test('664 re-check: replacement is idempotent and blocked unless lost/stolen', async () => {
    const owner = await makeUser();
    const lostCard = await issueCard(owner);
    await cardService.reportCardLostOrStolen({
      cardId: lostCard.id, customerId: owner.id, status: 'stolen', actorUserId: owner.id, issueReplacement: false,
    });
    const first = await recovery.requestReplacement({
      cardId: lostCard.id, customerId: owner.id, actorUserId: owner.id,
    });
    expect(first).toMatchObject({ replacementPending: true, replayed: false });
    const second = await recovery.requestReplacement({
      cardId: lostCard.id, customerId: owner.id, actorUserId: owner.id,
    });
    expect(second).toMatchObject({ replacementPending: true, replayed: true });

    const activeCard = await issueCard(owner);
    await expect(recovery.requestReplacement({
      cardId: activeCard.id, customerId: owner.id, actorUserId: owner.id,
    })).rejects.toMatchObject({ code: 'credit_card_replacement_blocked' });
  });

  test('665: an admin revoke notifies the customer with the action and the reason', async () => {
    const owner = await makeUser();
    const card = await issueCard(owner);

    const result = await cardService.revokeCard({
      cardId: card.id, reason: 'Suspected fraud — card reported by the network', actorUserId: admin.id,
    });
    expect(result.replayed).toBe(false);
    expect(result.card).toMatchObject({ status: 'revoked', statusReason: 'Suspected fraud — card reported by the network' });

    const notes = await notificationsFor(owner.id, 'credit_card_revoked');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBeTruthy();
    expect(notes[0].body).toContain('Suspected fraud');

    const list = await getAs(owner, '/api/oxsteed-credit/cards');
    expect(list.body.cards[0]).toMatchObject({
      id: String(card.id), status: 'revoked', statusReason: 'Suspected fraud — card reported by the network',
    });

    const history = await getAs(owner, `/api/oxsteed-credit/cards/${card.id}/history`);
    const revoked = history.body.events.find((e) => e.action === 'credit.card.revoked');
    expect(revoked).toBeDefined();
    expect(revoked.reason).toBe('Suspected fraud — card reported by the network');
  });

  test('665: an admin freeze notifies, records freeze_origin admin, and the customer cannot unfreeze it', async () => {
    const owner = await makeUser();
    const card = await issueCard(owner);

    const frozen = await cardService.adminFreezeCard({
      cardId: card.id, reason: 'Account under review', actorUserId: admin.id,
    });
    expect(frozen.card).toMatchObject({ status: 'frozen', freezeOrigin: 'admin', statusReason: 'Account under review' });

    const notes = await notificationsFor(owner.id, 'credit_card_frozen');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBeTruthy();
    expect(notes[0].body).toContain('Account under review');

    const grant = await grantUnfreeze(owner, card);
    await expect(cardService.unfreezeCard(grant)).rejects.toMatchObject({ code: 'credit_card_security_action_blocked' });

    const { rows: [row] } = await pool.query(`SELECT status FROM oxsteed_credit_cards WHERE id = $1`, [card.id]);
    expect(row.status).toBe('frozen');
  });

  test('665: a self-freeze sends no notification, and the customer can unfreeze it (reason cleared)', async () => {
    const owner = await makeUser();
    const card = await issueCard(owner);

    const frozen = await postAs(owner, `/api/oxsteed-credit/cards/${card.id}/freeze`).send({});
    expect(frozen.status).toBe(200);
    expect(frozen.body.card).toMatchObject({ status: 'frozen', freezeOrigin: 'customer' });
    expect(await notificationsFor(owner.id, 'credit_card_frozen')).toHaveLength(0);

    const grant = await grantUnfreeze(owner, card);
    const unfrozen = await cardService.unfreezeCard(grant);
    expect(unfrozen.card).toMatchObject({ status: 'active', statusReason: null });
    expect(await notificationsFor(owner.id, 'credit_card_frozen')).toHaveLength(0);
  });

  test('665: a repeated revoke replays and does not notify twice', async () => {
    const owner = await makeUser();
    const card = await issueCard(owner);

    await cardService.revokeCard({ cardId: card.id, reason: 'Fraud', actorUserId: admin.id });
    const replayed = await cardService.revokeCard({ cardId: card.id, reason: 'Fraud', actorUserId: admin.id });
    expect(replayed.replayed).toBe(true);
    expect(await notificationsFor(owner.id, 'credit_card_revoked')).toHaveLength(1);
  });

  test('665: a revoke without a reason still notifies with the localized title', async () => {
    const owner = await makeUser();
    const card = await issueCard(owner);

    const result = await cardService.revokeCard({ cardId: card.id, actorUserId: admin.id });
    expect(result.card).toMatchObject({ status: 'revoked', statusReason: null });

    const notes = await notificationsFor(owner.id, 'credit_card_revoked');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Your OxSteed Credit card was revoked');
    expect(notes[0].body).not.toContain('Reason:');
  });

  test('665: a customer cannot freeze another customer’s card', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const card = await issueCard(owner);

    await expect(cardService.freezeCard({ cardId: card.id, customerId: other.id, actorUserId: other.id }))
      .rejects.toMatchObject({ code: 'credit_card_not_found' });

    const res = await postAs(other, `/api/oxsteed-credit/cards/${card.id}/freeze`).send({});
    expect(res.status).toBe(404);
  });
});
