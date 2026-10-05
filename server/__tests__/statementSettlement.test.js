'use strict';

/**
 * Behavior tests for the settlement statement adapters (workstream 8):
 * restaurant_settlement, helper_earnings, and business products in
 * server/services/settlementStatementService.js, the append-only archive
 * (migration 688), and the self-service archive router's access control.
 *
 * These tests run ONLY against the disposable localhost credit_statement_test
 * database (same guard family as the Phase 2/3 statement suites). Without the
 * disposable DB the DB describes skip (fail closed) instead of touching a
 * real database. No source-text assertions: every test exercises behavior.
 */

jest.unmock('pg');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL
  || 'postgresql://postgres:postgres@127.0.0.1:5432/credit_statement_test?sslmode=disable';

function isDisposableDatabase(urlText) {
  let url;
  try {
    url = new URL(urlText);
  } catch {
    return false;
  }
  const localhost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  return ['postgres:', 'postgresql:'].includes(url.protocol) && localhost
    && url.pathname === '/credit_statement_test';
}

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  if (!CAN_RUN_DB) {
    // eslint-disable-next-line no-console
    console.log('statementSettlement DB tests skipped: set STATEMENT_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const statements = require('../services/settlementStatementService');
const settlementRouter = require('../routes/settlementStatementArchive');

jest.setTimeout(120000);

const P_AUG = { from: '2026-08-01', to: '2026-08-31' }; // monthly (archived)
const P_JUL = { from: '2026-07-01', to: '2026-07-31' }; // monthly (archived)
const P_AUG_HALF = { from: '2026-08-01', to: '2026-08-15' }; // interim (never archived)

// Unique per process: the disposable DB persists across runs and several
// fixture columns carry UNIQUE constraints.
const RUN_TAG = crypto.randomBytes(4).toString('hex');

// --- fixtures ---------------------------------------------------------------
async function createUser(role = 'customer', createdAt = '2026-01-15T12:00:00.000Z') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, created_at, didit_status)
     VALUES ($1, $2, 'synthetic-unusable-hash', 'Settlement', 'Fixture', $3, TRUE, TRUE, $4, 'verified')`,
    [id, `${id}@example.invalid`, role, createdAt]);
  return id;
}

async function createBusiness(ownerId, name, createdAt = '2026-01-15T12:00:00.000Z') {
  const { rows: [row] } = await pool.query(
    `INSERT INTO businesses (user_id, business_name, created_at) VALUES ($1, $2, $3) RETURNING id`,
    [ownerId, name, createdAt]);
  return Number(row.id);
}

async function addBusinessMember(businessId, ownerId, memberId, role, status = 'active') {
  await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [businessId, ownerId, memberId, role, `${memberId}@example.invalid`, status,
      status === 'active' ? new Date().toISOString() : null]);
}

async function createRestaurant(businessId, ownerId, name, currency = 'USD') {
  const { rows: [row] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, currency_code, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [businessId, ownerId, name, currency]);
  return Number(row.id);
}

async function createPartner(restaurantId, businessId, createdBy) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, status, created_by)
     VALUES ($1, $2, 'active', $3) RETURNING id`,
    [restaurantId, businessId, createdBy]);
  return Number(row.id);
}

async function createPartnerAgreement(partnerId, createdBy) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO oxsteed_credit_partner_agreements (partner_id, version, status, starts_at, created_by, approved_by)
     VALUES ($1, 1, 'active', '2026-01-01T00:00:00.000Z', $2, $2) RETURNING id`,
    [partnerId, createdBy]);
  return row.id;
}

async function getOrCreateTreasury(currency = 'USD') {
  const { rows } = await pool.query(
    `INSERT INTO oxsteed_credit_accounts (account_type, currency_code, created_at)
     VALUES ('platform_treasury', $1, '2026-01-15T12:00:00.000Z')
     ON CONFLICT DO NOTHING RETURNING id`,
    [currency]);
  if (rows[0]) return Number(rows[0].id);
  const { rows: [existing] } = await pool.query(
    `SELECT id FROM oxsteed_credit_accounts
      WHERE account_type = 'platform_treasury' AND currency_code = $1 LIMIT 1`,
    [currency]);
  return Number(existing.id);
}

async function createCreditAccount({ accountType, restaurantId = null, partnerId = null, currency = 'USD', createdAt = '2026-01-15T12:00:00.000Z' }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO oxsteed_credit_accounts (account_type, restaurant_id, partner_id, currency_code, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [accountType, restaurantId, partnerId, currency, createdAt]);
  return Number(row.id);
}

// Double-entry journal posting with balance_after chains, modeled on the
// issuance suite's postMovement (same guards apply: balanced pair, direction
// checks, ledger-write binding).
async function postJournal({ debit, credit, amount, type, date, partnerId = null, referenceType = null, referenceId = null, currency = 'USD', actorId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: balances } = await client.query(
      'SELECT * FROM oxsteed_credit_accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
      [[debit, credit]]);
    const debitAccount = balances.find((v) => String(v.id) === String(debit));
    const creditAccount = balances.find((v) => String(v.id) === String(credit));
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO oxsteed_credit_transactions
        (id, transaction_type, status, debit_account_id, credit_account_id, amount_cents, currency_code,
         partner_id, reference_type, reference_id, idempotency_key, description, reason,
         actor_type, actor_user_id, posted_at, created_at)
       VALUES ($1,$2,'posted',$3,$4,$5,$6,$7,$8,$9,$10,'Synthetic settlement fixture','Settlement test fixture','admin',$11,$12,$12)`,
      [id, type, debit, credit, amount, currency, partnerId, referenceType, referenceId, `settle-${id}`, actorId, date]);
    await client.query("SELECT set_config('oxsteed.credit_ledger_transaction_id', $1, TRUE)", [id]);
    for (const [source, side, sign] of [[debitAccount, 'debit', -1n], [creditAccount, 'credit', 1n]]) {
      const balance = BigInt(source.balance_cents) + sign * BigInt(amount);
      const sequence = BigInt(source.ledger_version) + 1n;
      const entryHash = crypto.createHash('sha256').update(`${id}:${source.id}`).digest('hex');
      await client.query(
        `INSERT INTO oxsteed_credit_transaction_entries
          (transaction_id, account_id, entry_side, amount_cents, balance_after_cents, sequence,
           previous_entry_hash, entry_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, source.id, side, amount, String(balance), String(sequence), source.last_entry_hash, entryHash, date]);
      await client.query(
        `UPDATE oxsteed_credit_accounts SET balance_cents=$2, ledger_version=$3, last_entry_hash=$4, last_posted_at=$5
         WHERE id=$1`,
        [source.id, String(balance), String(sequence), entryHash, date]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createJob({ helperId, clientId, title = 'Test job', payoutStatus = 'earned', completedAt = null, paidAt = null, helperPayoutCents = null, platformFeeCents = 0, customerTotalCents = null, currency = 'USD', status = 'completed' }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO jobs (client_id, assigned_helper_id, title, description, status, payout_status,
                       completed_at, paid_at, helper_payout_cents, platform_fee_cents, customer_total_cents, currency_code)
     VALUES ($1,$2,$3,'Synthetic settlement fixture',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [clientId, helperId, title, status, payoutStatus, completedAt, paidAt,
      helperPayoutCents, platformFeeCents, customerTotalCents, currency]);
  return row.id;
}

async function createPayment({ jobId, payerId, payeeId, amountDollars, status = 'captured', escrowStatus = 'released', refundDollars = null, refundedAt = null }) {
  await pool.query(
    `INSERT INTO payments (job_id, payer_id, payee_id, amount, platform_fee, helper_payout, currency,
                           status, escrow_status, refund_amount, refunded_at, captured_at, released_at)
     VALUES ($1,$2,$3,$4,0,$4,'usd',$5,$6,$7,$8,NOW(),NOW())`,
    [jobId, payerId, payeeId, amountDollars, status, escrowStatus, refundDollars, refundedAt]);
}

async function createInvoice({ businessId, userId, number, clientName = 'Client Co', status = 'sent', issueDate, totalDollars, paidDollars = '0.00', paidAt = null, currency = 'USD' }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO business_invoices (user_id, business_id, invoice_number, client_name, status,
                                    issue_date, total, amount_paid, paid_at, currency_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [userId, businessId, number, clientName, status, issueDate, totalDollars, paidDollars, paidAt, currency]);
  return row.id;
}

async function createExpense({ businessId, category = 'materials', description = 'Supplies', cents, date }) {
  await pool.query(
    `INSERT INTO business_expenses (business_id, category, description, amount_cents, expense_date)
     VALUES ($1,$2,$3,$4,$5)`,
    [businessId, category, description, cents, date]);
}

async function createSettlement({ partnerId, agreementId, createdBy, currency = 'USD', periodStart, periodEnd, gross, refund, fee, status = 'approved', payoutStatus = 'none', approvedBy = null, paymentReference = null, stripeTransferId = null, paidAt = null }) {
  const net = Math.max(0, gross - refund - fee);
  const creationHash = crypto.createHash('sha256').update(`settle-fixture:${partnerId}:${periodStart}:${periodEnd}`).digest('hex');
  const { rows: [row] } = await pool.query(
    `INSERT INTO oxsteed_credit_settlements
       (partner_id, agreement_id, currency_code, period_start, period_end,
        gross_cents, refund_cents, fee_cents, net_cents, status, payout_status,
        idempotency_key, approved_by, payment_reference, stripe_transfer_id, created_by,
        creation_reason, creation_request_hash, paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [partnerId, agreementId, currency, periodStart, periodEnd, gross, refund, fee, net,
      status, payoutStatus, `settle-${crypto.randomUUID()}`, approvedBy, paymentReference, stripeTransferId, createdBy,
      'Synthetic settlement fixture', creationHash, paidAt]);
  return row.id;
}

async function createRestaurantPayout({ restaurantId, currency = 'USD', cents, status, requestedBy, stripeTransferId = null, ledgerTransactionId = null, failureReason = null, createdAt = '2026-08-20T12:00:00.000Z' }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO restaurant_payouts
       (restaurant_id, currency_code, amount_cents, status, stripe_account_id,
        idempotency_key, requested_by, stripe_transfer_id, ledger_transaction_id,
        failure_reason, created_at)
     VALUES ($1,$2,$3,$4,'acct_test_123',$5,$6,$7,$8,$9,$10) RETURNING id`,
    [restaurantId, currency, cents, status, `payout-${crypto.randomUUID()}`,
      requestedBy, stripeTransferId, ledgerTransactionId, failureReason, createdAt]);
  return row.id;
}

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/settlement-statements', settlementRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

ddescribe('settlement statement adapters (workstream 8)', () => {
  let owner; let helper; let manager; let representative; let removed; let stranger; let client; let admin;
  let business; let businessB; let restaurant1; let restaurantB; let partner1; let agreement1;
  let treasury; let subBank1; let payable1; let reserve1;

  beforeAll(async () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '688_settlement_statement_documents.sql'), 'utf8');
    await pool.query(sql);

    owner = await createUser();
    helper = await createUser();
    manager = await createUser();
    representative = await createUser();
    removed = await createUser();
    stranger = await createUser();
    client = await createUser();
    admin = await createUser('super_admin');

    business = await createBusiness(owner, 'Fixture Foods LLC');
    await addBusinessMember(business, owner, manager, 'manager', 'active');
    await addBusinessMember(business, owner, representative, 'representative', 'active');
    await addBusinessMember(business, owner, removed, 'manager', 'revoked');

    restaurant1 = await createRestaurant(business, owner, 'Fixture Diner');
    businessB = await createBusiness(owner, 'Fixture Foods B LLC');
    restaurantB = await createRestaurant(businessB, owner, 'Fixture Diner B');
    partner1 = await createPartner(restaurant1, business, admin);
    agreement1 = await createPartnerAgreement(partner1, admin);

    treasury = await getOrCreateTreasury('USD');

    subBank1 = await createCreditAccount({ accountType: 'restaurant_sub_bank', restaurantId: restaurant1, currency: 'USD' });
    payable1 = await createCreditAccount({ accountType: 'partner_payable', partnerId: partner1, currency: 'USD' });
    reserve1 = await createCreditAccount({ accountType: 'partner_reserve', partnerId: partner1, currency: 'USD' });

    // Sub-bank journal fixtures (opening carryover + in-period activity).
    await postJournal({ debit: treasury, credit: subBank1, amount: 10000, type: 'sub_bank_load', date: '2026-07-10T12:00:00.000Z', partnerId: partner1, actorId: admin });
    await postJournal({ debit: treasury, credit: subBank1, amount: 5000, type: 'sub_bank_load', date: '2026-08-05T12:00:00.000Z', partnerId: partner1, actorId: admin });
    await postJournal({ debit: subBank1, credit: payable1, amount: 3000, type: 'sub_bank_redemption', date: '2026-08-10T12:00:00.000Z', partnerId: partner1, actorId: admin });
    await postJournal({ debit: payable1, credit: subBank1, amount: 1000, type: 'sub_bank_refund', date: '2026-08-12T12:00:00.000Z', partnerId: partner1, actorId: admin });
  }, 120000);

  afterAll(async () => { await pool.end(); });

  describe('restaurant_settlement', () => {
    test('reconciles the sub-bank journal exactly and archives the monthly original', async () => {
      const doc = await statements.getStatement(owner, {
        product: 'restaurant_settlement', restaurantId: restaurant1, currencyCode: 'USD', ...P_AUG,
      });
      expect(doc.product).toBe('restaurant_settlement');
      expect(doc.currencyCode).toBe('USD');
      expect(doc.openingBalanceCents).toBe(10000);
      expect(doc.totalCreditsCents).toBe(6000);
      expect(doc.totalDebitsCents).toBe(3000);
      expect(doc.closingBalanceCents).toBe(13000);
      expect(doc.openingBalanceCents + doc.totalCreditsCents - doc.totalDebitsCents)
        .toBe(doc.closingBalanceCents);
      expect(doc.transactionCount).toBe(3);
      expect(doc.transactions.map((t) => t.type).sort())
        .toEqual(['sub_bank_load', 'sub_bank_redemption', 'sub_bank_refund']);

      // Monthly originals converge on the archived row: same id, verified hash.
      const again = await statements.getStatement(owner, {
        product: 'restaurant_settlement', restaurantId: restaurant1, currencyCode: 'USD', ...P_AUG,
      });
      expect(again.id).toBe(doc.id);
      expect(statements.hashDocument(again)).toBe(again.contentHash);
      const { rows } = await pool.query(
        `SELECT generated_by, content_hash FROM settlement_statement_documents WHERE id = $1`, [doc.id]);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].generated_by)).toBe(String(owner));
      expect(rows[0].content_hash).toBe(doc.contentHash);
    });

    test('customer-wallet money never enters the settlement journal', async () => {
      // Customer stored value at the same restaurant: must stay invisible to
      // the merchant settlement statement.
      const { rows: [wallet] } = await pool.query(
        `INSERT INTO food_customer_wallet_accounts (restaurant_id, customer_id, currency_code, balance_cents)
         VALUES ($1, $2, 'USD', 20000) RETURNING id`,
        [restaurant1, client]);
      await pool.query(
        `INSERT INTO food_customer_wallet_ledger
           (account_id, restaurant_id, customer_id, entry_type, amount_cents, balance_after_cents, description, created_at)
         VALUES ($1, $2, $3, 'credit', 20000, 20000, 'Synthetic customer load', '2026-08-06T12:00:00.000Z')`,
        [wallet.id, restaurant1, client]);

      const doc = await statements.getStatement(owner, {
        product: 'restaurant_settlement', restaurantId: restaurant1, currencyCode: 'USD', ...P_AUG_HALF,
      });
      const types = doc.transactions.map((t) => t.type);
      expect(types).not.toContain('credit');
      // The three August sub-bank postings fall in the interim half-month;
      // the customer 'credit' ledger entry is not among them.
      expect(doc.transactionCount).toBe(3);
      expect(types.sort()).toEqual(['sub_bank_load', 'sub_bank_redemption', 'sub_bank_refund']);
    });

    test('payout outcomes are labeled honestly: verified vs in transit vs failed', async () => {
      const when = '2026-08-10T12:00:00.000Z';
      await createRestaurantPayout({ restaurantId: restaurant1, cents: 2000, status: 'requested', requestedBy: owner, createdAt: when });
      await createRestaurantPayout({ restaurantId: restaurant1, cents: 2500, status: 'processing', requestedBy: owner, createdAt: when });
      await createRestaurantPayout({ restaurantId: restaurant1, cents: 3000, status: 'completed', requestedBy: owner, stripeTransferId: `tr_test_completed_${RUN_TAG}`, createdAt: when });
      await createRestaurantPayout({ restaurantId: restaurant1, cents: 1500, status: 'failed', requestedBy: owner, failureReason: 'insufficient funds at processor', createdAt: when });
      await createRestaurantPayout({ restaurantId: restaurant1, cents: 1200, status: 'cancelled', requestedBy: owner, createdAt: when });

      const doc = await statements.getStatement(owner, {
        product: 'restaurant_settlement', restaurantId: restaurant1, currencyCode: 'USD', ...P_AUG_HALF,
      });
      const byStatus = Object.fromEntries(doc.payouts.map((p) => [p.status, p]));
      expect(byStatus.requested.outcome).toBe('in_transit');
      expect(byStatus.processing.outcome).toBe('in_transit');
      expect(byStatus.completed.outcome).toBe('verified');
      expect(byStatus.failed.outcome).toBe('failed');
      expect(byStatus.failed.failureReason).toMatch(/insufficient funds/);
      expect(byStatus.cancelled.outcome).toBe('never_executed');
      // No journal leg was posted for the completed payout in this fixture:
      // the statement says so instead of implying settlement.
      expect(byStatus.completed.journalLegPosted).toBe(false);
      expect(byStatus.completed.stripeTransferRef).toMatch(/^••••[0-9a-f]{4}$/);
    });

    test('keeps restaurants and currencies separate', async () => {
      const subBankB = await createCreditAccount({ accountType: 'restaurant_sub_bank', restaurantId: restaurantB, currency: 'USD' });
      const subBank1Eur = await createCreditAccount({ accountType: 'restaurant_sub_bank', restaurantId: restaurant1, currency: 'EUR' });
      const treasuryEur = await getOrCreateTreasury('EUR');
      // partner_id NULL: the load is not attributed to restaurant1's partner.
      await postJournal({ debit: treasury, credit: subBankB, amount: 77700, type: 'sub_bank_load', date: '2026-08-07T12:00:00.000Z', actorId: admin });
      await postJournal({ debit: treasuryEur, credit: subBank1Eur, amount: 4242, type: 'sub_bank_load', date: '2026-08-07T12:00:00.000Z', currency: 'EUR', actorId: admin });

      const usd = await statements.getStatement(owner, {
        product: 'restaurant_settlement', restaurantId: restaurant1, currencyCode: 'USD', ...P_AUG_HALF,
      });
      expect(usd.transactions.every((t) => t.creditCents + t.debitCents !== 77700)).toBe(true);
      const eur = await statements.getStatement(owner, {
        product: 'restaurant_settlement', restaurantId: restaurant1, currencyCode: 'EUR', ...P_AUG_HALF,
      });
      expect(eur.openingBalanceCents).toBe(0);
      expect(eur.closingBalanceCents).toBe(4242);
      const rB = await statements.getStatement(owner, {
        product: 'restaurant_settlement', restaurantId: restaurantB, currencyCode: 'USD', ...P_AUG_HALF,
      });
      expect(rB.closingBalanceCents).toBe(77700);
    });

    test('partner settlements, reserves, and funding requirements stay out of the equation', async () => {
      await postJournal({ debit: treasury, credit: reserve1, amount: 50000, type: 'funding', date: '2026-07-15T12:00:00.000Z', partnerId: partner1, actorId: admin });
      await pool.query(
        `INSERT INTO oxsteed_credit_reserve_policies (partner_id, currency_code, ratio_bps, floor_cents, is_default)
         VALUES ($1, 'USD', 1000, 50000, false) ON CONFLICT DO NOTHING`,
        [partner1]);
      await pool.query(
        `INSERT INTO oxsteed_credit_reserve_funding_requirements (partner_id, currency_code, required_cents, reason, status)
         VALUES ($1, 'USD', 12000, 'Synthetic test requirement', 'open')`,
        [partner1]);
      // Overlapping the statement period (Jul 28 - Aug 4): included.
      await createSettlement({
        partnerId: partner1, agreementId: agreement1, createdBy: admin,
        periodStart: '2026-07-28T00:00:00.000Z',
        periodEnd: '2026-08-04T00:00:00.000Z', gross: 20000, refund: 2000, fee: 1000,
        status: 'approved', payoutStatus: 'initiated', approvedBy: admin, stripeTransferId: `tr_test_init_${RUN_TAG}`,
      });
      // Fully inside the period, webhook-confirmed: verified.
      await createSettlement({
        partnerId: partner1, agreementId: agreement1, createdBy: admin,
        periodStart: '2026-08-05T00:00:00.000Z',
        periodEnd: '2026-08-06T00:00:00.000Z', gross: 10000, refund: 0, fee: 500,
        status: 'approved', payoutStatus: 'paid', approvedBy: admin, paymentReference: 'MANUAL-1', paidAt: '2026-08-06T12:00:00.000Z',
        stripeTransferId: `tr_test_paid_${RUN_TAG}`,
      });

      const doc = await statements.getStatement(owner, {
        product: 'restaurant_settlement', restaurantId: restaurant1, currencyCode: 'USD', ...P_AUG_HALF,
      });
      expect(doc.partnerSettlements).toHaveLength(2);
      const initiated = doc.partnerSettlements.find((s) => s.payoutStatus === 'initiated');
      const paid = doc.partnerSettlements.find((s) => s.payoutStatus === 'paid');
      expect(initiated.payoutVerified).toBe(false);
      expect(initiated.netCents).toBe(17000);
      expect(paid.payoutVerified).toBe(true);
      expect(paid.feeCents).toBe(500);
      expect(doc.reserves).toHaveLength(1);
      expect(doc.reserves[0].balanceCents).toBe(50000);
      expect(doc.reserves[0].policyFloorCents).toBe(50000);
      expect(doc.reserveFundingRequirements).toHaveLength(1);
      expect(doc.reserveFundingRequirements[0].requiredCents).toBe(12000);
      // The equation still only covers the sub-bank journal.
      expect(doc.openingBalanceCents + doc.totalCreditsCents - doc.totalDebitsCents)
        .toBe(doc.closingBalanceCents);
    });

    test('zero-activity carryover still issues with opening = closing', async () => {
      const quietBusiness = await createBusiness(owner, 'Quiet Foods LLC');
      const quietRestaurant = await createRestaurant(quietBusiness, owner, 'Quiet Diner');
      await createCreditAccount({ accountType: 'restaurant_sub_bank', restaurantId: quietRestaurant, currency: 'USD' });
      const doc = await statements.getStatement(owner, {
        product: 'restaurant_settlement', restaurantId: quietRestaurant, currencyCode: 'USD', ...P_JUL,
      });
      expect(doc.openingBalanceCents).toBe(0);
      expect(doc.closingBalanceCents).toBe(0);
      expect(doc.transactionCount).toBe(0);
      expect(doc.kind).toBe('monthly');
    });
  });

  describe('helper_earnings', () => {
    // Timing layout (all USD, helper scope):
    //  jobA: completed Jul 05, earned        -> opening 8000
    //  jobB: completed Jul 20, paid Aug 10   -> opening 5000, settled in period 5000
    //  jobC: completed Aug 03, earned        -> posted 7000, closing
    //  jobD: completed Aug 08, paid Aug 20   -> posted 6000, settled in period 6000
    //  jobE: completed Aug 12, failed        -> posted 4000, removed 4000
    //  jobF: completed Aug 15, pending        -> posted 9000, in transit, closing
    // Equation: 13000 + 26000 - 11000 - 4000 = 24000.
    let jobA; let jobB; let jobC; let jobD;
    beforeAll(async () => {
      jobA = await createJob({ helperId: helper, clientId: client, title: 'July job A', payoutStatus: 'earned', completedAt: '2026-07-05T12:00:00.000Z', helperPayoutCents: 8000, platformFeeCents: 1200, customerTotalCents: 9200 });
      jobB = await createJob({ helperId: helper, clientId: client, title: 'July job B', payoutStatus: 'paid', completedAt: '2026-07-20T12:00:00.000Z', paidAt: '2026-08-10T12:00:00.000Z', helperPayoutCents: 5000, platformFeeCents: 800, customerTotalCents: 5800 });
      jobC = await createJob({ helperId: helper, clientId: client, title: 'Aug job C', payoutStatus: 'earned', completedAt: '2026-08-03T12:00:00.000Z', helperPayoutCents: 7000, platformFeeCents: 1000, customerTotalCents: 8000 });
      jobD = await createJob({ helperId: helper, clientId: client, title: 'Aug job D', payoutStatus: 'paid', completedAt: '2026-08-08T12:00:00.000Z', paidAt: '2026-08-20T12:00:00.000Z', helperPayoutCents: 6000, platformFeeCents: 900, customerTotalCents: 6900 });
      await createJob({ helperId: helper, clientId: client, title: 'Aug job E', payoutStatus: 'failed', completedAt: '2026-08-12T12:00:00.000Z', helperPayoutCents: 4000, platformFeeCents: 600, customerTotalCents: 4600 });
      await createJob({ helperId: helper, clientId: client, title: 'Aug job F', payoutStatus: 'pending', completedAt: '2026-08-15T12:00:00.000Z', helperPayoutCents: 9000, platformFeeCents: 1300, customerTotalCents: 10300 });
      // Other helper + other currency: must stay out of helper's USD statement.
      const otherHelper = await createUser();
      await createJob({ helperId: otherHelper, clientId: client, title: 'Other helper job', payoutStatus: 'earned', completedAt: '2026-08-09T12:00:00.000Z', helperPayoutCents: 99999, currency: 'USD' });
      await createJob({ helperId: helper, clientId: client, title: 'EUR job', payoutStatus: 'earned', completedAt: '2026-08-09T12:00:00.000Z', helperPayoutCents: 55555, currency: 'EUR' });
      // Payment events: captured for a settled job, refunded for another.
      await createPayment({ jobId: jobB, payerId: client, payeeId: helper, amountDollars: '58.00', status: 'captured', escrowStatus: 'released' });
      await createPayment({ jobId: jobC, payerId: client, payeeId: helper, amountDollars: '80.00', status: 'refunded', escrowStatus: 'refunded', refundDollars: '80.00', refundedAt: '2026-08-11T12:00:00.000Z' });
    }, 120000);

    test('reconciles payable exactly across earned/settled/removed timing', async () => {
      const doc = await statements.getStatement(helper, {
        product: 'helper_earnings', helperId: helper, currencyCode: 'USD', ...P_AUG,
      });
      expect(doc.product).toBe('helper_earnings');
      expect(doc.openingPayableCents).toBe(13000);
      expect(doc.postedEarningsCents).toBe(26000);
      expect(doc.settledPayoutsCents).toBe(11000);
      expect(doc.statusRemovalsCents).toBe(4000);
      expect(doc.closingPayableCents).toBe(24000);
      expect(doc.openingPayableCents + doc.postedEarningsCents - doc.settledPayoutsCents - doc.statusRemovalsCents)
        .toBe(doc.closingPayableCents);
      expect(doc.buckets.accruedCents).toBe(15000); // A + C
      expect(doc.buckets.inTransitCents).toBe(9000); // F
      expect(doc.buckets.settledAllTimeCents).toBe(11000); // B + D
      expect(doc.buckets.notOwedCents).toBe(4000); // E
      expect(doc.buckets.totalEarnedCents).toBe(39000);
      expect(doc.platformFeesOnPostedCents).toBe(1000 + 900 + 600 + 1300);
      expect(doc.taxNote).toMatch(/not a tax form/i);
      // No leakage from the other helper or the EUR job.
      expect(doc.earnings.every((e) => e.helperPayoutCents !== 99999 && e.helperPayoutCents !== 55555)).toBe(true);
    });

    test('links payment events without describing unpaid earnings as received', async () => {
      const doc = await statements.getStatement(helper, {
        product: 'helper_earnings', helperId: helper, currencyCode: 'USD', ...P_AUG_HALF,
      });
      const settled = doc.settled.find((s) => s.jobId === String(jobB));
      expect(settled.payment.status).toBe('captured');
      const earned = doc.earnings.find((e) => e.jobId === String(jobC));
      expect(earned.payment.status).toBe('refunded');
      expect(earned.payment.refundAmountCents).toBe(8000);
      // Accrued rows carry no "received" language; only settled rows do.
      const accruedRow = doc.earnings.find((e) => e.payoutStatus === 'earned');
      expect(accruedRow.bucket).toBe('accrued');
      expect(JSON.stringify(doc)).not.toMatch(/received into bank|paid out to bank/i);
    });

    test('rederive rebuilds after a status change while the archived original is untouched', async () => {
      const before = await statements.getStatement(helper, {
        product: 'helper_earnings', helperId: helper, currencyCode: 'USD', ...P_JUL,
      });
      expect(before.kind).toBe('monthly');
      // A July-earned job settles: the snapshot moves buckets.
      await pool.query(`UPDATE jobs SET payout_status = 'paid', paid_at = '2026-07-28T12:00:00.000Z' WHERE id = $1`, [jobA]);
      const rebuilt = await statements.getStatement(helper, {
        product: 'helper_earnings', helperId: helper, currencyCode: 'USD', ...P_JUL, rederive: true,
      });
      expect(rebuilt.settledPayoutsCents).toBe(8000);
      expect(rebuilt.id).not.toBe(before.id);
      // The archived original is immutable: a plain re-request returns it.
      const archived = await statements.getStatement(helper, {
        product: 'helper_earnings', helperId: helper, currencyCode: 'USD', ...P_JUL,
      });
      expect(archived.id).toBe(before.id);
      expect(archived.settledPayoutsCents).toBe(0);
    });
  });

  describe('business', () => {
    let business2;
    beforeAll(async () => {
      // Receivables (USD): inv1 issued Jul, sent, partially paid; inv2 issued
      // Aug, sent; inv3 issued Aug, paid in full; inv4 issued Aug, cancelled;
      // inv5 EUR issued Aug (excluded from the USD statement).
      await createInvoice({ businessId: business, userId: owner, number: 'INV-001', status: 'sent', issueDate: '2026-07-10', totalDollars: '1000.00', paidDollars: '400.00' });
      await createInvoice({ businessId: business, userId: owner, number: 'INV-002', status: 'sent', issueDate: '2026-08-05', totalDollars: '2000.00' });
      await createInvoice({ businessId: business, userId: owner, number: 'INV-003', status: 'paid', issueDate: '2026-08-08', totalDollars: '500.00', paidDollars: '500.00', paidAt: '2026-08-09T12:00:00.000Z' });
      await createInvoice({ businessId: business, userId: owner, number: 'INV-004', status: 'cancelled', issueDate: '2026-08-11', totalDollars: '300.00' });
      await createInvoice({ businessId: business, userId: owner, number: 'INV-005', status: 'sent', issueDate: '2026-08-12', totalDollars: '700.00', currency: 'EUR' });
      // Payables.
      await createExpense({ businessId: business, category: 'materials', description: 'Flour', cents: 12000, date: '2026-08-06' });
      await createExpense({ businessId: business, category: 'labor', description: 'Prep cook', cents: 45000, date: '2026-08-07' });
      await createExpense({ businessId: business, category: 'materials', description: 'Sugar', cents: 8000, date: '2026-07-20' });
      // A second business whose records must stay out.
      business2 = await createBusiness(owner, 'Other Business LLC');
      await createInvoice({ businessId: business2, userId: owner, number: 'INV-X1', status: 'sent', issueDate: '2026-08-05', totalDollars: '99999.00' });
      // A restaurant payout for the business's restaurant (verified outcome).
      await createRestaurantPayout({ restaurantId: restaurant1, cents: 22000, status: 'completed', requestedBy: owner, stripeTransferId: `tr_biz_test_${RUN_TAG}`, createdAt: '2026-08-18T12:00:00.000Z' });
    }, 120000);

    test('reconciles receivables exactly and never merges entities', async () => {
      const doc = await statements.getStatement(owner, {
        product: 'business', businessId: business, currencyCode: 'USD', ...P_AUG,
      });
      expect(doc.product).toBe('business');
      const r = doc.receivables;
      // opening: INV-001 outstanding 60000; invoiced: 200000 + 50000;
      // cancelled: 30000; closing: 60000 + 200000 = 260000.
      expect(r.openingOutstandingCents).toBe(60000);
      expect(r.invoicedCents).toBe(250000);
      expect(r.cancelledCents).toBe(30000);
      expect(r.closingOutstandingCents).toBe(260000);
      expect(r.collectedOrAdjustedCents).toBe(60000 + 250000 - 30000 - 260000);
      expect(r.openingOutstandingCents + r.invoicedCents - r.collectedOrAdjustedCents - r.cancelledCents)
        .toBe(r.closingOutstandingCents);
      // No leakage: business2's invoice and the EUR invoice are absent.
      expect(r.invoices.every((inv) => inv.totalCents !== 9999900 && inv.invoiceNumber !== 'INV-005')).toBe(true);
      expect(doc.taxNote).toMatch(/not a tax form/i);
    });

    test('lists payables by category for the period only', async () => {
      const doc = await statements.getStatement(owner, {
        product: 'business', businessId: business, currencyCode: 'USD', ...P_AUG_HALF,
      });
      expect(doc.payables.totalExpensesCents).toBe(57000);
      expect(doc.payables.byCategoryCents).toEqual({ materials: 12000, labor: 45000 });
      expect(doc.payables.expenseCount).toBe(2);
    });

    test('shows partner settlements and per-restaurant payouts without merging', async () => {
      const doc = await statements.getStatement(owner, {
        product: 'business', businessId: business, currencyCode: 'USD', ...P_AUG_HALF,
      });
      // The Jul 28 - Aug 4 settlement overlaps the half-month period.
      expect(doc.partnerSettlements.length).toBeGreaterThanOrEqual(1);
      expect(doc.partnerSettlements[0].scopeNote).toBe('partner_payable');
      // Per-restaurant sections are not merged: Fixture Diner (same business)
      // shows its 5 August payouts; no other business's restaurants appear.
      const sections = doc.restaurantPayouts;
      const r1 = sections.find((s) => s.restaurantId === String(restaurant1));
      expect(r1.payouts).toHaveLength(5);
      expect(sections.every((s) => typeof s.restaurantId === 'string')).toBe(true);
      // July statement for the same business: August payouts do not leak in.
      const jul = await statements.getStatement(owner, {
        product: 'business', businessId: business, currencyCode: 'USD', ...P_JUL,
      });
      const r1jul = jul.restaurantPayouts.find((s) => s.restaurantId === String(restaurant1));
      expect(r1jul.payouts).toHaveLength(0);
      // business2 has no restaurants: nothing leaks in.
      const doc2 = await statements.getStatement(owner, {
        product: 'business', businessId: business2, currencyCode: 'USD', ...P_AUG_HALF,
      });
      expect(doc2.restaurantPayouts).toHaveLength(0);
    });
  });

  describe('access control', () => {
    const hooks = settlementRouter.testHooks;

    test('owner and active manager pass; representative, revoked, stranger denied', async () => {
      await expect(hooks.assertScopeStanding(owner, 'restaurant_settlement', restaurant1)).resolves.toMatchObject({ role: 'owner' });
      await expect(hooks.assertScopeStanding(manager, 'restaurant_settlement', restaurant1)).resolves.toMatchObject({ role: 'manager' });
      await expect(hooks.assertScopeStanding(representative, 'restaurant_settlement', restaurant1)).rejects.toMatchObject({ status: 404 });
      await expect(hooks.assertScopeStanding(removed, 'restaurant_settlement', restaurant1)).rejects.toMatchObject({ status: 404 });
      await expect(hooks.assertScopeStanding(stranger, 'restaurant_settlement', restaurant1)).rejects.toMatchObject({ status: 404 });
      await expect(hooks.assertScopeStanding(manager, 'business', business)).resolves.toMatchObject({ role: 'manager' });
      await expect(hooks.assertScopeStanding(representative, 'business', business)).rejects.toMatchObject({ status: 404 });
    });

    test('helper earnings are self-service only', async () => {
      await expect(hooks.assertScopeStanding(helper, 'helper_earnings', helper)).resolves.toMatchObject({ role: 'self' });
      await expect(hooks.assertScopeStanding(manager, 'helper_earnings', helper)).rejects.toMatchObject({ status: 404 });
      await expect(hooks.assertScopeStanding(owner, 'helper_earnings', helper)).rejects.toMatchObject({ status: 404 });
    });

    test('no cross-entity visibility: other-business members see nothing here', async () => {
      const otherOwner = await createUser();
      const otherBusiness = await createBusiness(otherOwner, 'Unrelated LLC');
      const otherManager = await createUser();
      await addBusinessMember(otherBusiness, otherOwner, otherManager, 'manager', 'active');
      await expect(hooks.assertScopeStanding(otherManager, 'restaurant_settlement', restaurant1)).rejects.toMatchObject({ status: 404 });
      await expect(hooks.assertScopeStanding(otherManager, 'business', business)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('archive router (HTTP)', () => {
    const app = buildApp();

    test('helper self-service issue -> archive -> verify -> csv', async () => {
      const token = signToken(helper);
      const issue = await request(app)
        .get('/api/settlement-statements/issue')
        .query({ product: 'helper_earnings', currency: 'USD', from: '2026-08-01', to: '2026-08-31' })
        .set('Authorization', `Bearer ${token}`);
      expect(issue.status).toBe(200);
      expect(issue.body.document.product).toBe('helper_earnings');
      const documentId = issue.body.document.id;

      const list = await request(app)
        .get('/api/settlement-statements/archive')
        .query({ product: 'helper_earnings' })
        .set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(list.body.statements.some((s) => s.id === documentId)).toBe(true);
      // Lists carry metadata only, never document bodies.
      expect(list.body.statements[0].document).toBeUndefined();

      const verify = await request(app)
        .get(`/api/settlement-statements/archive/${documentId}/verify`)
        .set('Authorization', `Bearer ${token}`);
      expect(verify.status).toBe(200);
      expect(verify.body.valid).toBe(true);

      const csv = await request(app)
        .get(`/api/settlement-statements/archive/${documentId}.csv`)
        .set('Authorization', `Bearer ${token}`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text).toMatch(/Helper earnings/);
      expect(csv.text).toMatch(/not a tax form/i);
    });

    test('representative cannot issue a restaurant settlement statement', async () => {
      const token = signToken(representative);
      const res = await request(app)
        .get('/api/settlement-statements/issue')
        .query({ product: 'restaurant_settlement', restaurantId: String(restaurant1), currency: 'USD', from: '2026-08-01', to: '2026-08-15' })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    test('manager can issue a restaurant settlement statement; tampered ids 404', async () => {
      const token = signToken(manager);
      const res = await request(app)
        .get('/api/settlement-statements/issue')
        .query({ product: 'restaurant_settlement', restaurantId: String(restaurant1), currency: 'USD', from: '2026-08-01', to: '2026-08-15' })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.document.product).toBe('restaurant_settlement');

      const bad = await request(app)
        .get('/api/settlement-statements/archive/not-a-uuid')
        .set('Authorization', `Bearer ${token}`);
      expect(bad.status).toBe(404);
    });

    test('unauthenticated requests are rejected', async () => {
      const res = await request(app)
        .get('/api/settlement-statements/archive')
        .query({ product: 'helper_earnings' });
      expect(res.status).toBe(401);
    });
  });

  describe('archive safeguards', () => {
    test('issued originals are immutable in the database', async () => {
      const doc = await statements.getStatement(owner, {
        product: 'business', businessId: business, currencyCode: 'USD', ...P_JUL,
      });
      await expect(pool.query(`UPDATE settlement_statement_documents SET currency_code = 'EUR' WHERE id = $1`, [doc.id]))
        .rejects.toThrow(/immutable/i);
      await expect(pool.query(`DELETE FROM settlement_statement_documents WHERE id = $1`, [doc.id]))
        .rejects.toThrow(/immutable/i);
    });

    test('concurrent monthly issuance converges on one archived original', async () => {
      const opts = { product: 'business', businessId: business, currencyCode: 'USD', from: '2026-06-01', to: '2026-06-30' };
      const [a, b] = await Promise.all([
        statements.getStatement(owner, opts),
        statements.getStatement(owner, opts),
      ]);
      expect(a.id).toBe(b.id);
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM settlement_statement_documents
          WHERE product = 'business' AND scope_business_id = $1 AND currency_code = 'USD'
            AND period_from = '2026-06-01' AND period_to = '2026-06-30'`,
        [business]);
      expect(rows[0].n).toBe(1);
    });
  });
});
