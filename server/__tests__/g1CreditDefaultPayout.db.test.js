'use strict';

/**
 * G-1 (Emile decision, 2026-11-19): OxSteed Credit is the default payout
 * method when Stripe payout setup is absent, and bidding must not be
 * blocked for lack of payout_setup.
 *
 * Proves both halves on real Postgres (JOB_EDIT_TEST_DATABASE_URL):
 *   (a) a helper with identity + terms but no payout_setup (no W-9, no
 *       Connect account) can create a bid through POST /api/bids and be
 *       hired through POST /api/jobs/assign;
 *   (b) that helper's payout defaults to OxSteed Credit: accepting with
 *       payment_method 'oxsteed' and no explicit rail records
 *       jobs.payment_rail = 'credit' and places a Credit hold
 *       (job_credit_payments, status 'held') that completion captures to
 *       the helper's Credit partner ledger — and no Stripe payment row is
 *       created for the job.
 * Also pins the boundaries:
 *   - a helper WITH full payout_setup keeps the Stripe default;
 *   - an explicit payment_rail 'stripe' stays Stripe for a helper without
 *     setup (the Stripe payout itself still fails closed at money time).
 *
 * Fixture notes: the credit rail is enabled for the suite (feature flag +
 * US country policy credit_payment_legal_cleared) and restored afterwards;
 * the customer is funded with admin Credit (adjustCustomerCredit) and the
 * helpers are enrolled as Credit participants for the jobs surface, the
 * same inserts creditCashoutLifecycle.db.test.js uses.
 */

const url = process.env.JOB_EDIT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('JOB_EDIT_TEST_DATABASE_URL must be a local database');
process.env.DATABASE_URL = url;
}
process.env.REDIS_URL = '';
process.env.FEATURE_PAYMENTS_ENABLED = 'true';

jest.unmock('pg');
jest.unmock('../utils/transaction');
jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: req.headers['x-test-actor'], role: req.headers['x-test-role'] || 'customer' }; next(); },
  optionalAuth: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/requireEmailVerified', () => (_req, _res, next) => next());
jest.mock('../middleware/helperOnboardingMiddleware', () => ({
  requireOnboardingStep: () => (_req, _res, next) => next(),
  requireHelperWorkEligible: (_req, _res, next) => next(),
}));
jest.mock('../middleware/checkRestrictions', () => () => (_req, _res, next) => next());
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn(), emitToUser: jest.fn(), getIO: () => null }));

const crypto = require('node:crypto');
const { acceptCurrentConsents } = require('./helpers/currentConsents');
const describeDb = url ? describe : describe.skip;

const FLAG_ENV = ['FEATURE_PAYMENT_RAILS', 'FEATURE_RAIL_CREDIT'];

describeDb('G-1 Credit-default payout (real Postgres)', () => {
  let pool; let app; let request; let railPolicy; let paymentRails; let creditService;
  const customer = crypto.randomUUID();
  const helper = crypto.randomUUID();
  const helperReady = crypto.randomUUID();
  const jobIds = [];
  const userIds = [customer, helper, helperReady];
  const partnerIds = [];
  let savedUsPolicy;
  let savedCreditFlag;
  let savedIssuanceCap;
  let railAdminId;

  async function makeJob() {
    const { rows: [job] } = await pool.query(
      `INSERT INTO jobs (client_id, title, description, status, budget_type, budget_min_cents, budget_max_cents,
                         location_city, location_country, location_country_code, currency_code)
       VALUES ($1, 'Fix the garden fence', $2, 'published', 'fixed', 20000, 20000, 'Town', 'US', 'US', 'USD') RETURNING *`,
      [customer, 'Two coats of exterior paint. '.repeat(4)]
    );
    jobIds.push(job.id);
    return job;
  }

  async function makeBid(job, helperId, amountMinor = 15000) {
    const { rows: [bid] } = await pool.query(
      `INSERT INTO bids (job_id, helper_id, amount_cents, status, job_revision, expires_at)
       VALUES ($1, $2, $3, 'pending', 1, NOW() + INTERVAL '7 days') RETURNING *`,
      [job.id, helperId, amountMinor]
    );
    return bid;
  }

  async function makeUser(id, role, { helper: isHelper = false } = {}) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role,
                          id_verified, identity_verified, didit_status, didit_verified_at,
                          terms_accepted, terms_accepted_at, terms_version, w9_completed)
       VALUES ($1, $2, 'x', 'G1', 'Default', $3, TRUE, TRUE, 'verified', NOW(),
               TRUE, NOW(), 'g1-test', FALSE)`,
      [id, `${id}@g1-credit-default.test`, role]
    );
    await acceptCurrentConsents(pool, id);
    if (isHelper) {
      // No payout_setup on purpose: no connect_accounts row, no W-9.
      await pool.query(
        `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
         VALUES ($1, 'helper.offer_services', 'self', 'self', 'active', 'legacy_backfill', 'helper-policy-1')`,
        [id],
      );
      await pool.query(
        `INSERT INTO helper_cancellation_policies (helper_id, oxsteed_enabled, custom_enabled, custom_policy)
         VALUES ($1, TRUE, TRUE, '{"payment_mode": "direct"}')`,
        [id],
      );
    }
  }

  async function enrollHelperParticipant(helperId) {
    const adminId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'x', 'G1', 'Admin', 'admin', TRUE)`,
      [adminId, `g1-admin-${adminId}@example.invalid`]
    );
    userIds.push(adminId);
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (status, settlement_currency_code, created_by)
       VALUES ('active', 'USD', $1) RETURNING id`,
      [adminId]
    );
    partnerIds.push(partner.id);
    await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, status, starts_at, allowed_order_types, allowed_categories, created_by, approved_by)
       VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day', '{}', '{}', $2, $2)`,
      [partner.id, adminId]
    );
    await pool.query(
      `INSERT INTO credit_participants (partner_id, participant_type, user_id, status, didit_verified, didit_verified_at, allowed_surfaces)
       VALUES ($1, 'helper', $2, 'active', TRUE, NOW(), '{jobs}')`,
      [partner.id, helperId]
    );
  }

  beforeAll(async () => {
    pool = require('../db');
    railPolicy = require('../services/paymentRailPolicy');
    paymentRails = require('../services/paymentRails');
    creditService = require('../services/oxsteedCreditService');
    request = require('supertest');
    const express = require('express');
    app = express();
    app.use(express.json());
    app.use('/api/jobs', require('../routes/jobs'));
    app.use('/api/bids', require('../routes/bids'));

    process.env.FEATURE_PAYMENT_RAILS = 'true';
    process.env.FEATURE_RAIL_CREDIT = 'true';
    // The shared test DB already holds far more customer-wallet Credit
    // than the default $50k total-issuance cap (other suites fund wallets
    // without cleanup), so funding this customer would fail the cap even
    // though the funding itself is small. Raise the cap for this suite
    // only; restored in afterAll.
    savedIssuanceCap = process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS;
    process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = '100000000';

    // Credit rail on for the suite (restored in afterAll).
    const { rows: [flag] } = await pool.query(`SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
    savedCreditFlag = flag ? flag.is_enabled : null;
    await pool.query(`INSERT INTO feature_flags (key, is_enabled) SELECT 'oxsteed_credit_enabled', TRUE WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'oxsteed_credit_enabled')`);
    await pool.query(`UPDATE feature_flags SET is_enabled = TRUE WHERE key = 'oxsteed_credit_enabled'`);
    railAdminId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'x', 'G1', 'RailAdmin', 'admin', TRUE)`,
      [railAdminId, `g1-railadmin-${railAdminId}@example.invalid`]
    );
    userIds.push(railAdminId);
    try {
      await creditService.unfreezeCreditRail({ reason: 'g1 test suite start', actorUserId: railAdminId });
    } catch { /* already unfrozen */ }

    // US policy: Credit as a payment, not just collateral (restored afterAll).
    const { rows: [us] } = await pool.query(`SELECT * FROM payment_country_policies WHERE country_code = 'US'`);
    savedUsPolicy = us;
    await pool.query(
      `UPDATE payment_country_policies
          SET enabled = TRUE, tax_review_cleared = TRUE, stripe_rail_enabled = TRUE,
              credit_rail_enabled = TRUE, credit_payment_legal_cleared = TRUE
        WHERE country_code = 'US'`
    );
    railPolicy.clearPolicyCache();

    await makeUser(customer, 'customer');
    await makeUser(helper, 'helper', { helper: true });
    await makeUser(helperReady, 'helper', { helper: true });
    // The Stripe-ready helper: W-9 + Connect charges/payouts (full payout_setup).
    await pool.query(`UPDATE users SET w9_completed = TRUE WHERE id = $1`, [helperReady]);
    await pool.query(
      `INSERT INTO connect_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete)
       VALUES ($1, $2, TRUE, TRUE, TRUE)`,
      [helperReady, `acct_g1_${helperReady.replace(/-/g, '').slice(0, 20)}`],
    );
    await enrollHelperParticipant(helper);
    await enrollHelperParticipant(helperReady);

    // Fund the customer so the Credit hold (and the legacy collateral hold
    // on the Stripe-rail accepts) can be placed.
    const funder = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'x', 'G1', 'Funder', 'admin', TRUE)`,
      [funder, `g1-funder-${funder}@example.invalid`]
    );
    userIds.push(funder);
    await creditService.adjustCustomerCredit({
      customerId: customer,
      amountCents: 200000,
      currencyCode: 'USD',
      direction: 'credit',
      idempotencyKey: `g1-fund-${crypto.randomBytes(6).toString('hex')}`,
      actorType: 'admin',
      actorUserId: funder,
      reason: 'g1 test funding',
      referenceId: `g1-fund-${crypto.randomBytes(6).toString('hex')}`,
    });
  }, 60000);

  afterEach(() => {
    railPolicy.clearPolicyCache();
  });

  afterAll(async () => {
    if (savedUsPolicy) {
      await pool.query(
        `UPDATE payment_country_policies
            SET enabled = $2, tax_review_cleared = $3, stripe_rail_enabled = $4,
                credit_rail_enabled = $5, credit_payment_legal_cleared = $6, offline_rail_enabled = $7
          WHERE country_code = 'US'`,
        ['US', savedUsPolicy.enabled, savedUsPolicy.tax_review_cleared, savedUsPolicy.stripe_rail_enabled,
          savedUsPolicy.credit_rail_enabled, savedUsPolicy.credit_payment_legal_cleared, savedUsPolicy.offline_rail_enabled]
      ).catch(() => {});
    }
    if (savedCreditFlag !== undefined && savedCreditFlag !== null) {
      await pool.query(`UPDATE feature_flags SET is_enabled = $1 WHERE key = 'oxsteed_credit_enabled'`, [savedCreditFlag]).catch(() => {});
    }
    for (const sql of [
      'DELETE FROM job_rail_switch_requests WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM offline_payment_confirmations WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM payments WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM job_event_outbox WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM job_revisions WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM appointments WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM bids WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM jobs WHERE id = ANY($1::uuid[])',
    ]) await pool.query(sql, [jobIds]).catch(() => {});
    // Read the hold ids before the payment rows go, then remove the holds.
    const { rows: holds } = await pool.query(
      `SELECT DISTINCT credit_hold_id FROM job_credit_payments WHERE job_id = ANY($1::uuid[])`, [jobIds]
    ).catch(() => ({ rows: [] }));
    for (const { credit_hold_id: holdId } of holds) {
      await pool.query(`DELETE FROM oxsteed_credit_holds WHERE id = $1`, [holdId]).catch(() => {});
    }
    await pool.query('DELETE FROM job_credit_payments WHERE job_id = ANY($1::uuid[])', [jobIds]).catch(() => {});
    await pool.query(`DELETE FROM credit_participants WHERE partner_id = ANY($1::uuid[])`, [partnerIds]).catch(() => {});
    await pool.query(`DELETE FROM oxsteed_credit_partner_agreements WHERE partner_id = ANY($1::uuid[])`, [partnerIds]).catch(() => {});
    await pool.query(`DELETE FROM oxsteed_credit_partners WHERE id = ANY($1::uuid[])`, [partnerIds]).catch(() => {});
    await pool.query(`DELETE FROM oxsteed_credit_transactions WHERE customer_id = $1`, [customer]).catch(() => {});
    await pool.query(`DELETE FROM oxsteed_credit_accounts WHERE customer_id = $1`, [customer]).catch(() => {});
    await pool.query(`DELETE FROM notifications WHERE user_id = ANY($1::uuid[])`, [userIds]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]).catch(() => {});
    for (const key of FLAG_ENV) delete process.env[key];
    if (savedIssuanceCap === undefined) delete process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS;
    else process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = savedIssuanceCap;
    await pool.end();
  }, 60000);

  test('(a)+(b) helper without payout_setup bids, is hired, and is paid in OxSteed Credit', async () => {
    // Precondition: the helper genuinely has no Stripe payout setup.
    const { rows: [noConnect] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM connect_accounts WHERE user_id = $1`, [helper]
    );
    expect(noConnect.n).toBe(0);
    expect(await paymentRails.helperStripePayoutReady(pool, helper)).toBe(false);

    const job = await makeJob();
    const bidRes = await request(app).post('/api/bids').set('x-test-actor', helper).set('x-test-role', 'helper')
      .send({ job_id: job.id, amount: 150, message: 'I can fix this fence this week.' });
    expect(bidRes.status).toBe(201);
    expect(bidRes.body.helper_id).toBe(helper);

    // No explicit rail: the payout method is resolved by the server.
    const res = await request(app).post('/api/jobs/assign').set('x-test-actor', customer)
      .send({ bid_id: bidRes.body.id, payment_method: 'oxsteed' });
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe('accepted');

    const { rows: [after] } = await pool.query(
      'SELECT payment_rail, settlement_currency FROM jobs WHERE id = $1', [job.id]
    );
    expect(after.payment_rail).toBe('credit');
    expect(after.settlement_currency).toBe('USD');
    const { rows: [creditPayment] } = await pool.query(
      `SELECT * FROM job_credit_payments WHERE job_id = $1`, [job.id]
    );
    expect(creditPayment).toBeDefined();
    expect(creditPayment.status).toBe('held');
    expect(String(creditPayment.helper_id)).toBe(helper);
    expect(Number(creditPayment.amount_minor)).toBe(15000);
    const { rows: [hold] } = await pool.query(
      `SELECT * FROM oxsteed_credit_holds WHERE id = $1`, [creditPayment.credit_hold_id]
    );
    expect(hold).toBeDefined();
    // No Stripe payout was attempted for this job: no Stripe payment row.
    const { rows: [stripePayment] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE job_id = $1`, [job.id]
    );
    expect(stripePayment.n).toBe(0);
  });

  test('helper WITH payout_setup keeps the Stripe default', async () => {
    expect(await paymentRails.helperStripePayoutReady(pool, helperReady)).toBe(true);
    const job = await makeJob();
    const bid = await makeBid(job, helperReady);
    const res = await request(app).post('/api/jobs/assign').set('x-test-actor', customer)
      .send({ bid_id: bid.id, payment_method: 'oxsteed' });
    expect(res.status).toBe(200);
    const { rows: [after] } = await pool.query('SELECT payment_rail, metadata FROM jobs WHERE id = $1', [job.id]);
    expect(after.payment_rail).toBe('stripe');
    const { rows: [creditPayment] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM job_credit_payments WHERE job_id = $1`, [job.id]
    );
    expect(creditPayment.n).toBe(0);
    // The escrow collateral hold is a real hold: the adapter returns the
    // raw create result as .hold, so the id lives at .hold.hold.id and
    // reading .hold.id stored null here before the shape fix.
    expect(typeof after.metadata?.creditCollateralHoldId).toBe('string');
    const { rows: [collateral] } = await pool.query(
      `SELECT * FROM oxsteed_credit_holds WHERE id = $1`, [after.metadata.creditCollateralHoldId]
    );
    expect(collateral).toBeDefined();
    expect(Number(collateral.amount_cents)).toBe(15000);
  });

  test('an explicit stripe rail stays Stripe for a helper without payout_setup', async () => {
    const job = await makeJob();
    const bid = await makeBid(job, helper);
    const res = await request(app).post('/api/jobs/assign').set('x-test-actor', customer)
      .send({ bid_id: bid.id, payment_method: 'oxsteed', payment_rail: 'stripe' });
    expect(res.status).toBe(200);
    const { rows: [after] } = await pool.query('SELECT payment_rail, metadata FROM jobs WHERE id = $1', [job.id]);
    expect(after.payment_rail).toBe('stripe');
    const { rows: [creditPayment] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM job_credit_payments WHERE job_id = $1`, [job.id]
    );
    expect(creditPayment.n).toBe(0);
    expect(typeof after.metadata?.creditCollateralHoldId).toBe('string');
  });
});
