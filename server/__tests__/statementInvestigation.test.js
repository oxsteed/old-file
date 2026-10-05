'use strict';

/**
 * Behavior tests for statement transaction investigation (workstream 4).
 *
 * These tests run against the disposable `credit_statement_test` database
 * only (the same guard as statementJobService.test.js); they exercise real
 * DB behavior: record-level authorization, explicit relationship
 * resolution, dispute creation through the EXISTING oxsteed_credit_disputes
 * case system, idempotent retries, and ledger immutability. No
 * source-text assertions.
 *
 * The real JWT auth middleware cannot run here (the disposable DB carries
 * only the columns the isolated-env seed created), so `../middleware/auth`
 * is stubbed with the same contract: req.user = { id, role } from the
 * x-test-user-id / x-test-user-role headers. Record-level authorization
 * (document.customer_id = req.user.id) is implemented in the router under
 * test and is what these tests exercise.
 *
 * Run with e.g.
 *   STATEMENT_INVESTIGATION_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/statementInvestigation.test.js
 * Without it, the DB tests skip (fail closed) instead of touching a DB.
 */

jest.unmock('pg');

const { disposableDatabaseOptIn, isDisposableDatabase, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('STATEMENT_INVESTIGATION_TEST_DATABASE_URL');


const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  if (!CAN_RUN_DB) {
    // eslint-disable-next-line no-console
    console.log('statementInvestigation DB tests skipped: set STATEMENT_INVESTIGATION_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase('postgresql://postgres@127.0.0.1:54329/credit_statement_test?sslmode=disable')).toBe(true);
  expect(isDisposableDatabase('postgresql://prod.example.com/credit_statement_test')).toBe(false);
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    const userId = req.headers['x-test-user-id'];
    const role = req.headers['x-test-user-role'] || 'customer';
    if (!userId) return res.status(401).json({ error: 'No token provided' });
    req.user = { id: userId, role };
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  },
}));

ddescribe('statement investigation (disposable DB)', () => {
  const express = require('express');
  const request = require('supertest');
  const crypto = require('crypto');
  const pool = require('../db');
  const { hashDocument } = require('../services/creditStatementService');

  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/statementInvestigation'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));

  const PERIOD = { from: '2026-09-01', to: '2026-09-30' };

  async function ensureSchema() {
    await assertMigratedSchema(pool);
  }

  // Fresh, mutually-unlinked fixtures per test: unique users, accounts,
  // transactions and statement document, so no cleanup is required.
  async function newFixture() {
    const ownerId = crypto.randomUUID();
    const intruderId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'synthetic', 'Stmt', 'Fixture', 'customer', TRUE, TRUE),
              ($3, $4, 'synthetic', 'Intr', 'Uder', 'customer', TRUE, TRUE)`,
      [ownerId, `${ownerId}@example.invalid`, intruderId, `${intruderId}@example.invalid`]
    );
    await pool.query(
      `INSERT INTO users (id,email,password_hash,first_name,last_name,role,email_verified,is_active)
       VALUES ($1,$2,'synthetic','Fixture','Admin','admin',TRUE,TRUE)`, [adminId, `${adminId}@example.invalid`]);
    const credit = require('../services/oxsteedCreditService');
    const treasury = await credit.ensureAccount(pool, { accountType: 'platform_treasury', currencyCode: 'USD' });
    const { rows: [account] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code)
       VALUES ('customer_wallet', $1, 'USD') RETURNING id`, [ownerId]);
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, 'Synthetic Testaurant') RETURNING id`, [ownerId]);
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, 'Testaurant', 'active') RETURNING id`, [business.id, ownerId]);
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, status, created_by)
       VALUES ($1, 'active', $2) RETURNING id`, [restaurant.id, adminId]);
    const payable = await credit.ensureAccount(pool, { accountType: 'partner_payable', partnerId: partner.id, currencyCode: 'USD' });
    const { rows: [agreement] } = await pool.query(
      `INSERT INTO oxsteed_credit_partner_agreements (partner_id,version,status,starts_at,created_by,approved_by)
       VALUES ($1,1,'active',NOW()-interval '1 day',$2,$2) RETURNING id`, [partner.id, adminId]);
    const { rows: [order] } = await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, customer_id, queue_number, status, payment_status, total_cents, currency_code)
       VALUES ($1, $2, $3, 1, 'completed', 'paid', 2500, 'USD') RETURNING id`, [restaurant.id, business.id, ownerId]);

    async function addTransaction({ type, amount, referenceType, referenceId, description, balanceAfter }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { transaction } = await require('../services/oxsteedCreditService').postJournalTransaction(client, {
          transactionType: type, amountCents: amount, currencyCode: 'USD',
          debitAccountId: type === 'load' ? treasury.id : account.id,
          creditAccountId: type === 'load' ? account.id : payable.id,
          partnerId: type === 'load' ? null : partner.id,
          agreementId: type === 'load' ? null : agreement.id,
          idempotencyKey: `investigation-fixture-${crypto.randomUUID()}`,
          referenceType, referenceId, description,
          actorType: type === 'load' ? 'admin' : 'customer', actorUserId: type === 'load' ? adminId : ownerId,
          reason: 'Synthetic disposable investigation fixture',
        });
        await client.query('COMMIT');
        if (balanceAfter !== undefined) {
          const { rows: [balance] } = await pool.query('SELECT balance_cents FROM oxsteed_credit_accounts WHERE id=$1', [account.id]);
          expect(Number(balance.balance_cents)).toBe(balanceAfter);
        }
        return transaction.id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }

    await addTransaction({ type: 'load', amount: 10000, referenceType: 'synthetic_opening',
      referenceId: crypto.randomUUID(), description: 'Synthetic opening', balanceAfter: 10000 });

    const txId = await addTransaction({
      type: 'purchase', amount: 2500, referenceType: 'food_order', referenceId: String(order.id),
      description: 'Test purchase', balanceAfter: 7500,
    });
    // Decoy: same amount, no explicit reference. The drilldown must NOT link it.
    const decoyId = await addTransaction({
      type: 'purchase', amount: 2500, referenceType: null, referenceId: crypto.randomUUID(),
      description: 'Decoy purchase', balanceAfter: 5000,
    });
    // External payment reference: must be masked in every response.
    const topupId = await addTransaction({
      type: 'load', amount: 10000, referenceType: 'stripe_topup', referenceId: 'pi_SECRET1234',
      description: 'Card top-up', balanceAfter: 15000,
    });

    const docId = crypto.randomUUID();
    const entryFor = (id, type, description, debitCents, creditCents, balanceAfterCents) => ({
      id: String(id), date: '2026-09-15T12:00:00.000Z', type, description,
      debitCents, creditCents, balanceAfterCents,
    });
    const document = {
      id: docId, version: 1, kind: 'monthly', product: 'oxsteed',
      ownerName: 'Statement Fixture', accountLabel: 'OxSteed Credit',
      accountReference: `OC-••••${String(account.id).slice(-4).padStart(4, '0')}`,
      currencyCode: 'USD', period: { from: PERIOD.from, to: PERIOD.to },
      generatedAt: '2026-10-01T00:00:00.000Z', openingBalanceCents: 10000,
      transactions: [
        entryFor(txId, 'purchase', 'Test purchase', 2500, 0, 7500),
        entryFor(decoyId, 'purchase', 'Decoy purchase', 2500, 0, 5000),
        entryFor(topupId, 'load', 'Card top-up', 0, 10000, 15000),
      ],
      closingBalanceCents: 15000, totalCreditsCents: 10000, totalDebitsCents: 5000,
      transactionCount: 3, holds: [], holdsAsOf: null, totalHeldCents: 0,
    };
    document.contentHash = hashDocument(document);
    await pool.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to, generated_at, document, content_hash)
       VALUES ($1, $2, 'oxsteed', $3, 'USD', $4, $5, NOW(), $6, $7)`,
      [docId, ownerId, account.id, PERIOD.from, PERIOD.to, JSON.stringify(document), document.contentHash]);
    return { ownerId, intruderId, adminId, accountId: account.id, docId, txId, decoyId, topupId, orderId: order.id };
  }

  const as = (userId) => ({ 'x-test-user-id': userId });
  const entriesUrl = (f) => `/api/statements/${f.docId}/entries`;
  const entryUrl = (f, entryId) => `/api/statements/${f.docId}/entries/${entryId}`;

  beforeAll(async () => { await ensureSchema(); }, 60000);
  afterAll(async () => { await pool.end(); });

  test('(a) unauthorized users cannot read entries or drilldowns', async () => {
    const f = await newFixture();
    await request(app).get(entriesUrl(f)).expect(401);
    await request(app).get(entryUrl(f, f.txId)).expect(401);
    await request(app).get(entriesUrl(f)).set(as(f.intruderId)).expect(404);
    await request(app).get(entryUrl(f, f.txId)).set(as(f.intruderId)).expect(404);
    await request(app).post(`${entryUrl(f, f.txId)}/cases`).set(as(f.intruderId)).send({ reason: 'unrecognized' }).expect(404);
    // The owner can read their own entries.
    await request(app).get(entriesUrl(f)).set(as(f.ownerId)).expect(200);
  });

  test('(b) drilldown links only explicit relationships; the same-amount decoy is not linked', async () => {
    const f = await newFixture();
    const linked = await request(app).get(entryUrl(f, f.txId)).set(as(f.ownerId)).expect(200);
    expect(linked.body.statement.entryId).toBe(f.txId);
    expect(linked.body.related.status).toBe('linked');
    expect(linked.body.related.kind).toBe('order');
    expect(linked.body.related.id).toBe(String(f.orderId));
    expect(linked.body.related.statusLive).toBe('completed');

    const decoy = await request(app).get(entryUrl(f, f.decoyId)).set(as(f.ownerId)).expect(200);
    expect(decoy.body.related.status).toBe('unsupported');
    // Nothing in the decoy drilldown may point at the order: no inference
    // from the matching amount.
    const decoyJson = JSON.stringify(decoy.body);
    expect(decoyJson).not.toContain(`"id":"${f.orderId}"`);
    expect(decoyJson).not.toContain(`/food/orders/${f.orderId}`);
  });

  test('(c) deleted related record reports unavailable without crashing', async () => {
    const f = await newFixture();
    await pool.query('DELETE FROM food_orders WHERE id = $1', [f.orderId]);
    const res = await request(app).get(entryUrl(f, f.txId)).set(as(f.ownerId)).expect(200);
    expect(res.body.related).toEqual({ status: 'unavailable' });
    // The historical statement facts are still intact.
    expect(res.body.statement.entryId).toBe(f.txId);
    expect(res.body.statement.debitCents).toBe(2500);
  });

  test('(d) double POST opens exactly one case (idempotent retry)', async () => {
    const f = await newFixture();
    const first = await request(app).post(`${entryUrl(f, f.txId)}/cases`)
      .set(as(f.ownerId)).send({ reason: 'unrecognized', description: 'Not mine' }).expect(201);
    expect(first.body.caseId).toBeTruthy();
    expect(first.body.replayed).toBe(false);
    expect(first.body.status).toBe('open');

    const second = await request(app).post(`${entryUrl(f, f.txId)}/cases`)
      .set(as(f.ownerId)).send({ reason: 'unrecognized', description: 'Not mine' }).expect(200);
    expect(second.body.caseId).toBe(first.body.caseId);
    expect(second.body.replayed).toBe(true);

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM oxsteed_credit_disputes WHERE transaction_id = $1', [f.txId]);
    expect(rows[0].n).toBe(1);
    const { rows: [dispute] } = await pool.query(
      'SELECT statement_document_id, statement_entry_id, statement_revision FROM oxsteed_credit_disputes WHERE id = $1',
      [first.body.caseId]);
    expect(String(dispute.statement_document_id)).toBe(f.docId);
    expect(dispute.statement_entry_id).toBe(f.txId);
    expect(dispute.statement_revision).toBe(1);
  });

  test('(e) filing a case moves no money: ledger, balances and journals untouched', async () => {
    const f = await newFixture();
    const snapshot = async () => ({
      transactions: (await pool.query('SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_cents),0)::text AS s FROM oxsteed_credit_transactions')).rows[0],
      entries: (await pool.query('SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_cents),0)::text AS s FROM oxsteed_credit_transaction_entries')).rows[0],
      balance: (await pool.query('SELECT balance_cents::text AS b FROM oxsteed_credit_accounts WHERE id = $1', [f.accountId])).rows[0].b,
      disputes: (await pool.query('SELECT COUNT(*)::int AS n FROM oxsteed_credit_disputes')).rows[0].n,
    });
    const before = await snapshot();
    await request(app).post(`${entryUrl(f, f.txId)}/cases`)
      .set(as(f.ownerId)).send({ reason: 'duplicate' }).expect(201);
    const after = await snapshot();
    expect(after.transactions).toEqual(before.transactions);
    expect(after.entries).toEqual(before.entries);
    expect(after.balance).toBe(before.balance);
    // Exactly one dispute row was added and nothing else.
    expect(after.disputes).toBe(before.disputes + 1);
  });

  test('(f) statement document bytes are unchanged while a linked live case status changes', async () => {
    const f = await newFixture();
    const created = await request(app).post(`${entryUrl(f, f.txId)}/cases`)
      .set(as(f.ownerId)).send({ reason: 'incorrect_amount' }).expect(201);
    const before = (await pool.query(
      'SELECT document::text AS doc_text, content_hash FROM credit_statement_documents WHERE id = $1', [f.docId])).rows[0];
    // Simulate the review workflow moving the case forward.
    await pool.query(`UPDATE oxsteed_credit_disputes SET status = 'in_review', resolution='Synthetic review started' WHERE id = $1`, [created.body.caseId]);
    const { rows: [dispute] } = await pool.query('SELECT status FROM oxsteed_credit_disputes WHERE id = $1', [created.body.caseId]);
    expect(dispute.status).toBe('in_review');
    const after = (await pool.query(
      'SELECT document::text AS doc_text, content_hash FROM credit_statement_documents WHERE id = $1', [f.docId])).rows[0];
    expect(after.doc_text).toBe(before.doc_text);
    expect(after.content_hash).toBe(before.content_hash);
    // And the drilldown still serves the same historical facts with the
    // current live status labeled separately.
    const drill = await request(app).get(entryUrl(f, f.txId)).set(as(f.ownerId)).expect(200);
    expect(drill.body.statement.debitCents).toBe(2500);
    expect(drill.body.cases).toHaveLength(1);
    expect(drill.body.cases[0].status).toBe('in_review');
  });

  test('(g) responses carry masked references only, never raw reference values', async () => {
    const f = await newFixture();
    const raw = 'pi_SECRET1234';
    const list = await request(app).get(entriesUrl(f)).set(as(f.ownerId)).expect(200);
    const topupEntry = list.body.entries.find((e) => e.entryId === f.topupId);
    expect(topupEntry.maskedReference).toBe('••••1234');
    const drill = await request(app).get(entryUrl(f, f.topupId)).set(as(f.ownerId)).expect(200);
    expect(drill.body.related.status).toBe('external');
    expect(drill.body.related.maskedReference).toBe('••••1234');
    expect(JSON.stringify(list.body)).not.toContain(raw);
    expect(JSON.stringify(drill.body)).not.toContain(raw);
    // The stored case evidence summary is masked too.
    await request(app).post(`${entryUrl(f, f.topupId)}/cases`)
      .set(as(f.ownerId)).send({ reason: 'unrecognized' }).expect(201);
    const { rows: [dispute] } = await pool.query(
      'SELECT description FROM oxsteed_credit_disputes WHERE transaction_id = $1', [f.topupId]);
    expect(dispute.description).toContain('••••1234');
    expect(dispute.description).not.toContain(raw);
  });

  test('restaurant statement cases use linked support tickets with idempotency and no money movement', async () => {
    const f = await newFixture();
    const restaurant = (await pool.query('SELECT id FROM food_restaurants WHERE owner_user_id=$1',[f.ownerId])).rows[0];
    const walletService = require('../services/foodWalletService');
    const client = await pool.connect();
    let movement;
    try {
      await client.query('BEGIN');
      const args = { restaurantId:restaurant.id,customerId:f.ownerId,currencyCode:'USD',
        createdByUserId:f.adminId,actorType:'admin',referenceType:'merchant_load',referenceId:crypto.randomUUID() };
      await walletService.creditFoodWallet(client,{ ...args,amountCents:10000,idempotencyKey:crypto.randomUUID() });
      movement=await walletService.debitFoodWallet(client,{ ...args,amountCents:1200,idempotencyKey:crypto.randomUUID(),
        referenceType:'food_order',referenceId:String(f.orderId),description:'Lunch' });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    const docId=crypto.randomUUID();
    const entryId=String(movement.entry.id);
    const document={ id:docId,version:1,kind:'monthly',product:'restaurant',ownerName:'Fixture',
      accountLabel:'Testaurant',accountReference:'RC-••••0000',currencyCode:'USD',
      period:{...PERIOD},generatedAt:new Date().toISOString(),openingBalanceCents:10000,
      transactions:[{ id:entryId,date:new Date(movement.entry.created_at).toISOString(),type:'purchase',description:'Lunch',
        debitCents:1200,creditCents:0,balanceAfterCents:8800 }],closingBalanceCents:8800,
      totalCreditsCents:0,totalDebitsCents:1200,transactionCount:1,holds:[],holdsAsOf:null,totalHeldCents:0 };
    document.contentHash=hashDocument(document);
    await pool.query(
      "INSERT INTO credit_statement_documents (id,customer_id,product,account_id,currency_code,period_from,period_to,generated_at,document,content_hash) VALUES ($1,$2,'restaurant',$3,'USD',$4,$5,NOW(),$6,$7)",
      [docId,f.ownerId,movement.account.id,PERIOD.from,PERIOD.to,JSON.stringify(document),document.contentHash]);
    const path='/api/statements/'+docId+'/entries/'+entryId;
    const before=(await pool.query('SELECT balance_cents,ledger_version FROM food_customer_wallet_accounts WHERE id=$1',[movement.account.id])).rows[0];
    await request(app).post(path+'/cases').set(as(f.intruderId)).send({ reason:'unrecognized' }).expect(404);
    const drill=await request(app).get(path).set(as(f.ownerId)).expect(200);
    expect(drill.body.statement.caseSupport).toBe('support_tickets');
    const first=await request(app).post(path+'/cases').set(as(f.ownerId)).send({ reason:'unrecognized' }).expect(201);
    const second=await request(app).post(path+'/cases').set(as(f.ownerId)).send({ reason:'unrecognized' }).expect(200);
    expect(second.body.caseId).toBe(first.body.caseId);
    const cases=await request(app).get(path+'/cases').set(as(f.ownerId)).expect(200);
    expect(cases.body.cases).toHaveLength(1);
    const ticket=(await pool.query('SELECT metadata FROM support_tickets WHERE id=$1',[first.body.caseId])).rows[0];
    expect(ticket.metadata.statement.documentId).toBe(docId);
    expect(ticket.metadata.statement.entryId).toBe(entryId);
    expect(ticket.metadata.statement.accountId).toBe(String(movement.account.id));
    const after=(await pool.query('SELECT balance_cents,ledger_version FROM food_customer_wallet_accounts WHERE id=$1',[movement.account.id])).rows[0];
    expect(after).toEqual(before);
    expect((await pool.query('SELECT content_hash FROM credit_statement_documents WHERE id=$1',[docId])).rows[0].content_hash).toBe(document.contentHash);
  });
});
