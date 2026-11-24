'use strict';

// Group 13 Slice 4j acceptance: track accountability (696-700).
// 696/698 are EXISTS re-checks (evidence in docs/persona-roadmap/group13.md);
// this suite proves them live: a posted wallet transaction enqueues a
// `transaction_posted` outbox row, and a card's audit events read back
// through the per-card history endpoint, owner-only.
// 697 builds the user-facing consent history on the existing records
// (`user_consents` + `credit_disclosure_acceptances`, no second store).
// 699 builds the unified top-up approval record: the recipient's top-up
// read carries the same funder/business/reason/approval info as the
// funder-side record, joined from the same row.
// 700 stays PARTIAL and HELD (no suspend/revoke transition exists in the
// participant service — pinned here, not built). The display-only piece
// built is the wallet-account removal reason + date, from the status-change
// audit event that already records them.
// Runs against a dedicated fresh database (credit_statement_test_g13j) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// Stripe is stubbed at the module level (same shape as the 4f suite): the
// fake PaymentIntent factory mints a distinct intent per creation, so the
// business-funded top-up can be created through the real endpoint.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const mockStripeState = { count: 0, created: [], runId: crypto.randomUUID().slice(0, 8) };
const mockPaymentIntentsCreate = jest.fn(async () => {
  mockStripeState.count += 1;
  // The run id keeps intent ids unique across reruns against the same
  // database: stripe_payment_intent_id is UNIQUE on oxsteed_credit_topups
  // (migration 633), so a bare per-process counter collides on rerun.
  const intent = { id: `pi_test_${mockStripeState.runId}_${mockStripeState.count}`, client_secret: `cs_test_${mockStripeState.runId}_${mockStripeState.count}` };
  mockStripeState.created.push(intent);
  return intent;
});
const mockPaymentIntentsRetrieve = jest.fn(async (id) => {
  const found = mockStripeState.created.find((intent) => intent.id === id);
  return found || { id, client_secret: 'cs_test_missing' };
});
const mockPaymentIntentsCancel = jest.fn(async (id) => ({ id, status: 'canceled' }));
const mockStripeClient = {
  paymentIntents: {
    create: mockPaymentIntentsCreate,
    retrieve: mockPaymentIntentsRetrieve,
    cancel: mockPaymentIntentsCancel,
  },
};
jest.mock('stripe', () => jest.fn(() => mockStripeClient));

const dbUrl = process.env.GROUP13_SLICE4J_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13j') {
    throw new Error('Group 13 Slice 4j DB tests require the loopback credit_statement_test_g13j database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 13 Slice 4j: track accountability (696-700)', () => {
  let pool;
  let creditCtrl;
  let creditService;
  let topupCtrl;
  let cardController;
  let app;
  let admin;
  let checker;
  let treasuryId;
  let partnerId;
  let agreementId;
  let payableId;

  beforeAll(async () => {
    pool = require('../db');
    creditService = require('../services/oxsteedCreditService');
    creditCtrl = require('../controllers/oxsteedCreditController');
    topupCtrl = require('../controllers/oxsteedCreditTopupController');
    cardController = require('../controllers/oxsteedCreditCardController');
    const { authenticate } = require('../middleware/auth');
    app = express();
    app.use(express.json());
    app.use('/api/consent', require('../routes/consent'));
    app.get('/api/oxsteed-credit/account', authenticate, creditCtrl.getMyAccount);
    app.get('/api/oxsteed-credit/topups', authenticate, topupCtrl.listMyTopups);
    app.get('/api/oxsteed-credit/topups/:id', authenticate, topupCtrl.getTopup);
    app.get('/api/oxsteed-credit/cards/:cardId/history', authenticate, cardController.myCardHistory);
    app.post('/api/oxsteed-credit/topups', authenticate, topupCtrl.createTopup);
    app.post('/api/businesses/:businessId/credit-topups', authenticate, topupCtrl.createBusinessTopup);
    app.get('/api/businesses/:businessId/credit-topups/:topupId', authenticate, topupCtrl.getBusinessTopup);
    app.use(require('../middleware/errorHandler').errorHandler);

    admin = await makeUser('super_admin');
    checker = await makeUser('super_admin');
    process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID = admin.id;
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'Group 13 Slice 4j test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`,
    );
    treasuryId = await ensureCreditAccount({ accountType: 'platform_treasury' });
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, notes, created_by, status)
       VALUES (NULL, NULL, 'USD', NULL, $1, 'active') RETURNING id`,
      [admin.id],
    );
    partnerId = String(partner.id);
    const { rows: [agreement] } = await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, status, starts_at, allowed_order_types, allowed_categories, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day', '{}', '{}', $2, $3) RETURNING id`,
      [partnerId, admin.id, checker.id],
    );
    agreementId = agreement.id;
    payableId = await ensureCreditAccount({ accountType: 'partner_payable', partnerId: partner.id });
  });

  afterAll(async () => {
    delete process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID;
    if (pool) {
      await pool.query(`DELETE FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
      await pool.end();
    }
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

  async function makeWallet(user) {
    return ensureCreditAccount({ accountType: 'customer_wallet', customerId: user.id });
  }

  // Compliance-gated money paths require a verified identity tier and a
  // fresh 'clear' sanctions screening (same fixture as the 4f suite).
  async function verifyCustomer(user) {
    await pool.query(
      `INSERT INTO oxsteed_credit_identity_verifications (customer_id, requested_tier, tier, status, expires_at)
       SELECT $1, 1, 1, 'verified', NOW() + INTERVAL '1 year'
        WHERE NOT EXISTS (
          SELECT 1 FROM oxsteed_credit_identity_verifications
           WHERE customer_id = $1 AND status = 'verified'
        )`,
      [user.id],
    );
    await pool.query(
      `INSERT INTO oxsteed_credit_sanctions_screenings (subject_type, subject_id, provider, result, payload_hash)
       VALUES ('customer', $1, 'manual_review', 'clear', $2) ON CONFLICT DO NOTHING`,
      [user.id, `g13j-sanctions-${user.id}`],
    );
  }

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const getAs = (user, path) => request(app).get(path).set('Authorization', `Bearer ${tokenFor(user)}`);
  const postAs = (user, path) => request(app).post(path).set('Authorization', `Bearer ${tokenFor(user)}`);

  async function makeBusiness({ owner, member }) {
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Fixture Business', FALSE, TRUE) RETURNING id`,
      [owner.id],
    );
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'representative', $4, 'active', NOW())`,
      [business.id, owner.id, member.id, member.email],
    );
    return business;
  }

  async function postLoad(user, walletId, amountCents, key) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { transaction } = await creditService.postJournalTransaction(client, {
        currencyCode: 'USD',
        transactionType: 'load',
        debitAccountId: treasuryId,
        creditAccountId: walletId,
        amountCents,
        actorType: 'admin',
        actorUserId: admin.id,
        reason: 'Fixture load',
        referenceType: 'admin_load',
        referenceId: 'fixture-load',
        description: 'Fixture load',
        idempotencyKey: key,
      });
      await client.query('COMMIT');
      return transaction;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // 696 re-check: every posted customer-wallet transaction enqueues a
  // `transaction_posted` notification for the wallet owner.
  test('696 re-check: a posted wallet load enqueues a transaction_posted outbox row', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transaction = await postLoad(user, walletId, 5000, `g13j-696-load-${user.id}`);
    const { rows } = await pool.query(
      `SELECT user_id, event_type FROM oxsteed_credit_notification_outbox
        WHERE transaction_id = $1 AND user_id = $2 AND event_type = 'transaction_posted'`,
      [transaction.id, user.id],
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0].user_id)).toBe(user.id);
  });

  // 697: the consent history is a derived read over the existing records.
  test('697: consent history shows the acceptances with type, version, and date — own rows only', async () => {
    const user = await makeUser();
    const stranger = await makeUser();
    const accepted = await postAs(user, '/api/consent/accept')
      .send({ consent_types: ['terms_of_service', 'privacy_policy'] });
    expect(accepted.status).toBe(200);
    // A per-item disclosure acceptance, recorded the way the disclosures
    // panel records one (placeholder text: no published version yet).
    await pool.query(
      `INSERT INTO credit_disclosure_acceptances
         (user_id, disclosure_kind, language, disclosure_version_id, content_sha256, context)
       VALUES ($1, 'short_form', 'en', NULL, $2, 'pre_acquisition')`,
      [user.id, crypto.createHash('sha256').update('g13j-disclosure').digest('hex')],
    );
    const res = await getAs(user, '/api/consent/history');
    expect(res.status).toBe(200);
    expect(res.body.consents).toEqual(expect.arrayContaining([
      expect.objectContaining({ consentType: 'terms_of_service', version: expect.any(String) }),
      expect.objectContaining({ consentType: 'privacy_policy', version: expect.any(String) }),
    ]));
    for (const row of res.body.consents) {
      expect(row.acceptedAt).toBeTruthy();
    }
    expect(res.body.disclosures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        disclosureKind: 'short_form', language: 'en', context: 'pre_acquisition',
        version: null, acceptedAt: expect.any(String),
      }),
    ]));
    // Isolation: another customer sees none of this customer's history.
    const strangerRes = await getAs(stranger, '/api/consent/history');
    expect(strangerRes.status).toBe(200);
    expect(strangerRes.body.consents).toEqual([]);
    expect(strangerRes.body.disclosures).toEqual([]);
    expect(JSON.stringify(strangerRes.body)).not.toContain(user.id);
  });

  // 698 re-check: per-card event history, owner-only.
  test('698 re-check: card audit events read back through the per-card history endpoint', async () => {
    const user = await makeUser();
    const stranger = await makeUser();
    const walletId = await makeWallet(user);
    const { rows: [card] } = await pool.query(
      `INSERT INTO oxsteed_credit_cards (customer_id, account_id, card_type, status, credential_hash, credential_last4)
       VALUES ($1, $2, 'virtual', 'active', $3, '4242') RETURNING id`,
      [user.id, walletId, crypto.createHash('sha256').update(`g13j-card-${user.id}`).digest('hex')],
    );
    await pool.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, resource_type, resource_id, reason)
       VALUES ('credit.card.frozen', $1, $1, 'credit_card', $2, 'Fixture freeze')`,
      [user.id, String(card.id)],
    );
    const res = await getAs(user, `/api/oxsteed-credit/cards/${card.id}/history`);
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'credit.card.frozen', reason: 'Fixture freeze' }),
    ]));
    const strangerRes = await getAs(stranger, `/api/oxsteed-credit/cards/${card.id}/history`);
    expect(strangerRes.status).toBe(404);
  });

  // 699: the recipient's top-up read carries the same approval record as
  // the funder-side read — one record, joined, not duplicated.
  test('699: recipient and funder see the same top-up approval record', async () => {
    const funder = await makeUser();
    const member = await makeUser();
    const outsider = await makeUser();
    await verifyCustomer(member);
    const business = await makeBusiness({ owner: funder, member });
    const created = await postAs(funder, `/api/businesses/${business.id}/credit-topups`)
      .set('Idempotency-Key', `g13j-699-biz-${business.id}-${member.id}`)
      .send({ amountCents: 5000, currencyCode: 'USD', memberId: member.id, reason: 'Fixture shift bonus' });
    expect(created.status).toBe(201);
    const topupId = created.body.topup.id;

    const recipientRead = await getAs(member, `/api/oxsteed-credit/topups/${topupId}`);
    expect(recipientRead.status).toBe(200);
    expect(recipientRead.body.topup).toMatchObject({
      id: String(topupId),
      amountCents: 5000,
      status: 'pending',
      fundedByUserId: funder.id,
      fundedByBusinessId: String(business.id),
      fundingReason: 'Fixture shift bonus',
      fundedByBusinessName: 'Fixture Business',
      fundingApprovalState: 'approved',
    });
    expect(recipientRead.body.topup.fundedByName).toBe('Test Fixture');
    expect(recipientRead.body.topup.fundingApprovedAt).toBeTruthy();

    const funderRead = await getAs(funder, `/api/businesses/${business.id}/credit-topups/${topupId}`);
    expect(funderRead.status).toBe(200);
    for (const field of ['fundedByUserId', 'fundedByBusinessId', 'fundingReason', 'fundedByName', 'fundedByBusinessName', 'fundingApprovalState', 'fundingApprovedAt']) {
      expect(funderRead.body.topup[field]).toEqual(recipientRead.body.topup[field]);
    }

    // The recipient's list carries the same approval info.
    const list = await getAs(member, '/api/oxsteed-credit/topups');
    expect(list.status).toBe(200);
    const listed = list.body.topups.find((row) => String(row.id) === String(topupId));
    expect(listed).toMatchObject({
      fundedByBusinessId: String(business.id),
      fundingReason: 'Fixture shift bonus',
      fundingApprovalState: 'approved',
    });

    // Isolation: another customer cannot read the recipient's record.
    const outsiderRead = await getAs(outsider, `/api/oxsteed-credit/topups/${topupId}`);
    expect(outsiderRead.status).toBe(404);
  });

  test('699: a self-service top-up carries no funder approval', async () => {
    const user = await makeUser();
    await verifyCustomer(user);
    const created = await postAs(user, '/api/oxsteed-credit/topups')
      .set('Idempotency-Key', `g13j-699-self-${user.id}`)
      .send({ amountCents: 2500, currencyCode: 'USD' });
    expect(created.status).toBe(201);
    const res = await getAs(user, `/api/oxsteed-credit/topups/${created.body.topup.id}`);
    expect(res.status).toBe(200);
    expect(res.body.topup).toMatchObject({
      fundedByUserId: null,
      fundedByBusinessId: null,
      fundingReason: null,
      fundedByName: null,
      fundedByBusinessName: null,
      fundingApprovalState: 'not_applicable',
      fundingApprovedAt: null,
    });
  });

});
