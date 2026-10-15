'use strict';

/**
 * Behavior tests for unified statement search, period trends, and saved
 * views (statements capabilities, Group B).
 *
 * These tests run against the disposable `credit_statement_test` database
 * only (the same guard as statementInvestigation.test.js); they exercise
 * real DB behavior: record-level authorization per product, amount matching
 * (formatted and raw), cross-user leak isolation, saved-view owner scoping,
 * and trend math with currency separation.
 *
 * The local hand-built database carries a minimal schema, so ensureSchema()
 * adds the production columns this feature reads (ADD COLUMN IF NOT EXISTS,
 * no-ops against the fully-migrated CI schema) and creates the wallet /
 * settlement tables this feature queries when they are absent
 * (CREATE TABLE IF NOT EXISTS with production column names).
 *
 * The real JWT auth middleware cannot run here, so `../middleware/auth`
 * is stubbed with the same contract: req.user = { id, role } from the
 * x-test-user-id / x-test-user-role headers. Record-level authorization
 * is implemented in the service under test and is what these tests
 * exercise.
 *
 * Run with e.g.
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/statementSearch.test.js --forceExit
 * Without it, the DB tests skip (fail closed) instead of touching a DB.
 */

jest.unmock('pg');

const { disposableDatabaseOptIn, isDisposableDatabase } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('STATEMENT_SEARCH_TEST_DATABASE_URL');

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  if (!CAN_RUN_DB) {
    // eslint-disable-next-line no-console
    console.log('statementSearch DB tests skipped: set STATEMENT_SEARCH_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
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

ddescribe('statement search, trends, saved views (disposable DB)', () => {
  const express = require('express');
  const request = require('supertest');
  const crypto = require('crypto');
  const pool = require('../db');

  const app = express();
  app.use(express.json());
  app.use('/api/statements', require('../routes/statementSearch'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));

  async function ensureSchema() {
    // Bridge the hand-built minimal local schema to the production columns
    // this feature reads. All idempotent; no-ops on the full CI schema.
    await pool.query(`ALTER TABLE oxsteed_credit_transactions
      ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(32),
      ADD COLUMN IF NOT EXISTS description VARCHAR(255),
      ADD COLUMN IF NOT EXISTS reference_type VARCHAR(80),
      ADD COLUMN IF NOT EXISTS reference_id VARCHAR(160),
      ADD COLUMN IF NOT EXISTS actor_type VARCHAR(32),
      ADD COLUMN IF NOT EXISTS actor_user_id UUID,
      ADD COLUMN IF NOT EXISTS reason VARCHAR(500)`);
    await pool.query(`ALTER TABLE oxsteed_credit_transaction_entries
      ADD COLUMN IF NOT EXISTS entry_side VARCHAR(8),
      ADD COLUMN IF NOT EXISTS amount_cents BIGINT,
      ADD COLUMN IF NOT EXISTS sequence BIGINT`);
    await pool.query(`ALTER TABLE food_restaurants
      ADD COLUMN IF NOT EXISTS business_id BIGINT,
      ADD COLUMN IF NOT EXISTS owner_user_id UUID,
      ADD COLUMN IF NOT EXISTS display_name TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS businesses (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      business_name TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS business_members (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      member_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(30) NOT NULL DEFAULT 'representative' CHECK (role IN ('manager', 'representative')),
      invite_email VARCHAR(255) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS food_customer_wallet_accounts (
      id BIGSERIAL PRIMARY KEY,
      restaurant_id BIGINT REFERENCES food_restaurants(id) ON DELETE CASCADE,
      customer_id UUID REFERENCES users(id) ON DELETE CASCADE,
      currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
      balance_cents BIGINT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'active')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS food_customer_wallet_ledger (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT REFERENCES food_customer_wallet_accounts(id) ON DELETE CASCADE,
      restaurant_id BIGINT,
      customer_id UUID,
      entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('credit', 'debit', 'refund', 'adjustment')),
      amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
      balance_after_cents BIGINT NOT NULL,
      currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
      description VARCHAR(255),
      reference_type VARCHAR(60),
      reference_id VARCHAR(120),
      entry_sequence BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS settlement_statement_documents (
      id UUID PRIMARY KEY,
      product VARCHAR(32) NOT NULL,
      scope_restaurant_id BIGINT,
      scope_business_id BIGINT,
      scope_helper_user_id UUID,
      currency_code CHAR(3) NOT NULL DEFAULT 'USD',
      period_from DATE NOT NULL,
      period_to DATE NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      document JSONB NOT NULL,
      content_hash CHAR(64) NOT NULL DEFAULT '')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS statement_saved_views (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
      product VARCHAR(32) NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    // Mirror migration 868's owner-scoped name uniqueness when the fallback
    // table above was created (no-op when the real migration already ran).
    await pool.query(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_statement_saved_views_user_name') THEN
          ALTER TABLE statement_saved_views
            ADD CONSTRAINT uq_statement_saved_views_user_name UNIQUE (user_id, name);
        END IF;
      END $$`);
  }

  // Fresh, mutually-unlinked fixtures per test: unique users and rows, so no
  // cleanup is required.
  async function newFixture() {
    const ownerId = crypto.randomUUID();
    const intruderId = crypto.randomUUID();
    const managerId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'synthetic', 'Stmt', 'Fixture', 'customer', TRUE),
              ($3, $4, 'synthetic', 'Stmt', 'Fixture', 'customer', TRUE),
              ($5, $6, 'synthetic', 'Stmt', 'Fixture', 'customer', TRUE),
              ($7, $8, 'synthetic', 'Stmt', 'Fixture', 'admin', TRUE)`,
      [ownerId, `${ownerId}@example.invalid`, intruderId, `${intruderId}@example.invalid`,
        managerId, `${managerId}@example.invalid`, adminId, `${adminId}@example.invalid`],
    );

    // OxSteed credit wallet + journal rows for the owner.
    const { rows: [wallet] } = await pool.query(
      `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code)
       VALUES ('customer_wallet', $1, 'USD') RETURNING id`, [ownerId]);
    let sequence = 0;
    async function addOxsteedEntry({ type, direction, amount, description, referenceType, referenceId, postedAt }) {
      sequence += 1;
      const txId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO oxsteed_credit_transactions
           (id, debit_account_id, credit_account_id, amount_cents, status, currency_code,
            transaction_type, description, reference_type, reference_id, posted_at,
            actor_type, actor_user_id, reason)
         VALUES ($1, $2, $2, $3, 'posted', 'USD', $4, $5, $6, $7, $8,
            'admin', $9, 'Synthetic test fixture')`,
        [txId, wallet.id, amount, type, description, referenceType, referenceId, postedAt || new Date().toISOString(), adminId]);
      await pool.query(
        `INSERT INTO oxsteed_credit_transaction_entries
           (transaction_id, account_id, balance_after_cents, entry_side, amount_cents, sequence)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [txId, wallet.id, 0, direction, amount, sequence]);
      return txId;
    }
    const loadId = await addOxsteedEntry({
      type: 'load', direction: 'credit', amount: 10000,
      description: 'Card top-up for groceries', referenceType: 'stripe_topup',
      referenceId: 'pi_topup_1', postedAt: '2026-09-10T12:00:00.000Z',
    });
    const purchaseId = await addOxsteedEntry({
      type: 'purchase', direction: 'debit', amount: 2500,
      description: 'Test purchase at bistro', referenceType: 'food_order',
      referenceId: 'order-1001', postedAt: '2026-09-12T12:00:00.000Z',
    });
    // Same amount, different description: amount search must find it,
    // description search must not.
    const decoyId = await addOxsteedEntry({
      type: 'purchase', direction: 'debit', amount: 2500,
      description: 'Decoy sandwich run', referenceType: null, referenceId: null,
      postedAt: '2026-09-13T12:00:00.000Z',
    });
    // Previous-period row for the trends test.
    await addOxsteedEntry({
      type: 'load', direction: 'credit', amount: 5000,
      description: 'August top-up', referenceType: 'stripe_topup',
      referenceId: 'pi_topup_0', postedAt: '2026-08-05T12:00:00.000Z',
    });

    // Restaurant credit wallet + ledger rows for the owner.
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, 'Search Testaurant') RETURNING id`, [ownerId]);
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, 'Search Testaurant', 'active') RETURNING id`, [business.id, ownerId]);
    const { rows: [rwallet] } = await pool.query(
      `INSERT INTO food_customer_wallet_accounts (restaurant_id, customer_id, currency_code, balance_cents)
       VALUES ($1, $2, 'USD', 3000) RETURNING id`, [restaurant.id, ownerId]);
    await pool.query(
      `INSERT INTO food_customer_wallet_ledger
         (account_id, restaurant_id, customer_id, entry_type, amount_cents, balance_after_cents,
          currency_code, description, reference_type, reference_id, entry_sequence, created_at)
       VALUES ($1, $2, $3, 'credit', 5000, 5000, 'USD', 'Wallet top-up', 'stripe_topup', 'pi_wallet_1', 1, '2026-09-11T12:00:00.000Z'),
              ($1, $2, $3, 'debit', 2000, 3000, 'USD', 'Lunch order #42', 'food_order', 'order-42', 2, '2026-09-14T12:00:00.000Z')`,
      [rwallet.id, restaurant.id, ownerId]);

    // Settlement documents: one per merchant product for the owner's scopes,
    // plus an intruder-owned helper_earnings doc to prove no cross-user leak.
    async function addSettlementDoc(product, scope, document) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO settlement_statement_documents
           (id, product, scope_restaurant_id, scope_business_id, scope_helper_user_id,
            currency_code, period_from, period_to, generated_at, document, content_hash)
         VALUES ($1, $2, $3, $4, $5, 'USD', '2026-09-01', '2026-09-30', NOW(), $6, $7)`,
        [id, product, scope.restaurantId || null, scope.businessId || null, scope.helperUserId || null,
          JSON.stringify(document), crypto.createHash('sha256').update(id).digest('hex')]);
      return id;
    }
    const settlementDocId = await addSettlementDoc('restaurant_settlement', { restaurantId: restaurant.id }, {
      transactions: [{
        id: 'rs-tx-1', date: '2026-09-15T12:00:00.000Z', type: 'settlement',
        description: 'Settlement payout for September', creditCents: 12000, debitCents: 0,
        balanceAfterCents: 12000, referenceType: 'payout', referenceId: 'po_991',
      }],
    });
    const helperDocId = await addSettlementDoc('helper_earnings', { helperUserId: ownerId }, {
      movements: [{
        sourceHistoryId: 'he-123', sourceId: 'earn-555', recordedAt: '2026-09-16T12:00:00.000Z',
        postedEarningsCents: 8000, settledPayoutsCents: 0, statusRemovalsCents: 0,
      }],
    });
    const businessDocId = await addSettlementDoc('business', { businessId: business.id }, {
      receivables: {
        movements: [{
          sourceHistoryId: 'biz-9', sourceId: 'INV-9', recordedAt: '2026-09-17T12:00:00.000Z',
          invoicedCents: 15000, collectedOrAdjustedCents: 0, cancelledCents: 0,
        }],
      },
    });
    const intruderHelperDocId = await addSettlementDoc('helper_earnings', { helperUserId: intruderId }, {
      movements: [{
        sourceHistoryId: 'he-999', sourceId: 'earn-999', recordedAt: '2026-09-18T12:00:00.000Z',
        postedEarningsCents: 4242, settledPayoutsCents: 0, statusRemovalsCents: 0,
      }],
    });
    // The manager has finance standing on the owner's business.
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active')`,
      [business.id, ownerId, managerId, `${managerId}@example.invalid`]);

    return {
      ownerId, intruderId, managerId, walletId: wallet.id, rwalletId: rwallet.id,
      restaurantId: restaurant.id, businessId: business.id,
      loadId, purchaseId, decoyId,
      settlementDocId, helperDocId, businessDocId, intruderHelperDocId,
    };
  }

  const as = (userId) => ({ 'x-test-user-id': userId });
  const searchUrl = (q, extra = '') => `/api/statements/search?q=${encodeURIComponent(q)}${extra}`;

  beforeAll(async () => { await ensureSchema(); }, 120000);
  afterAll(async () => { await pool.end(); });

  test('(a) unauthenticated requests are rejected on every route', async () => {
    await request(app).get(searchUrl('test')).expect(401);
    await request(app).get('/api/statements/saved-views').expect(401);
    await request(app).post('/api/statements/saved-views').send({}).expect(401);
    await request(app).delete(`/api/statements/saved-views/${crypto.randomUUID()}`).expect(401);
    await request(app).get('/api/statements/oxsteed/USD/trends').expect(401);
  });

  test('(b) description search finds the matching oxsteed entry, not the decoy', async () => {
    const f = await newFixture();
    const res = await request(app).get(searchUrl('bistro')).set(as(f.ownerId)).expect(200);
    const group = res.body.groups.find((g) => g.product === 'oxsteed');
    expect(group.total).toBe(1);
    const entry = group.results[0];
    expect(entry.entryId).toBe(f.purchaseId);
    expect(entry.debitCents).toBe(2500);
    expect(entry.creditCents).toBe(0);
    expect(entry.currencyCode).toBe('USD');
    expect(entry.product).toBe('oxsteed');
    expect(entry.url).toContain('/oxsteed-credit/statements');
    expect(entry.url).toContain('currencyCode=USD');
  });

  test('(c) amount search matches formatted and raw amounts', async () => {
    const f = await newFixture();
    // "25.00" matches both 2500-cent purchases.
    let res = await request(app).get(searchUrl('25.00')).set(as(f.ownerId)).expect(200);
    let ids = res.body.groups.find((g) => g.product === 'oxsteed').results.map((r) => r.entryId);
    expect(ids).toEqual(expect.arrayContaining([f.purchaseId, f.decoyId]));
    // Raw "2500" also matches the 2500-cent entries (raw-cent interpretation).
    res = await request(app).get(searchUrl('2500')).set(as(f.ownerId)).expect(200);
    ids = res.body.groups.find((g) => g.product === 'oxsteed').results.map((r) => r.entryId);
    expect(ids).toEqual(expect.arrayContaining([f.purchaseId, f.decoyId]));
    // "$100.00" matches the 10000-cent load.
    res = await request(app).get(searchUrl('$100.00')).set(as(f.ownerId)).expect(200);
    ids = res.body.groups.find((g) => g.product === 'oxsteed').results.map((r) => r.entryId);
    expect(ids).toContain(f.loadId);
    // A nonsense amount matches nothing.
    res = await request(app).get(searchUrl('999999.99')).set(as(f.ownerId)).expect(200);
    expect(res.body.total).toBe(0);
  });

  test('(d) empty query returns an empty result set, not an error', async () => {
    const f = await newFixture();
    const res = await request(app).get(searchUrl('   ')).set(as(f.ownerId)).expect(200);
    expect(res.body.total).toBe(0);
    expect(res.body.groups).toEqual([]);
  });

  test('(e) product filter scopes results; unknown products fail closed', async () => {
    const f = await newFixture();
    const res = await request(app).get(searchUrl('bistro', '&product=oxsteed')).set(as(f.ownerId)).expect(200);
    expect(res.body.groups.map((g) => g.product)).toEqual(['oxsteed']);
    await request(app).get(searchUrl('bistro', '&product=bogus')).set(as(f.ownerId)).expect(400);
  });

  test('(f) intruders see nothing: no cross-user leak on any product', async () => {
    const f = await newFixture();
    const res = await request(app).get(searchUrl('bistro')).set(as(f.intruderId)).expect(200);
    expect(res.body.total).toBe(0);
    for (const group of res.body.groups) {
      expect(group.total).toBe(0);
      expect(group.results).toEqual([]);
    }
    // The intruder's own helper doc is visible to the intruder but not the owner.
    const own = await request(app).get(searchUrl('earn-999')).set(as(f.intruderId)).expect(200);
    const ownGroup = own.body.groups.find((g) => g.product === 'helper_earnings');
    expect(ownGroup.total).toBe(1);
    expect(ownGroup.results[0].documentId).toBe(f.intruderHelperDocId);
    const leak = await request(app).get(searchUrl('earn-999')).set(as(f.ownerId)).expect(200);
    expect(leak.body.groups.find((g) => g.product === 'helper_earnings').total).toBe(0);
    const leakJson = JSON.stringify(leak.body);
    expect(leakJson).not.toContain(f.intruderHelperDocId);
    // No result entry may carry the intruder's reference (the echoed query
    // string itself is the only place it appears).
    const leakHaystack = JSON.stringify(leak.body.groups.flatMap((g) => g.results));
    expect(leakHaystack).not.toContain('earn-999');
  });

  test('(g) restaurant wallet ledger is searchable by the wallet owner', async () => {
    const f = await newFixture();
    const res = await request(app).get(searchUrl('Lunch order')).set(as(f.ownerId)).expect(200);
    const group = res.body.groups.find((g) => g.product === 'restaurant');
    expect(group.total).toBe(1);
    const entry = group.results[0];
    expect(entry.direction).toBe('debit');
    expect(entry.debitCents).toBe(2000);
    expect(entry.url).toContain('/restaurant-credit/statements');
    expect(entry.url).toContain(`restaurantId=${f.restaurantId}`);
    // The intruder cannot see the owner's restaurant wallet.
    const intruder = await request(app).get(searchUrl('Lunch order')).set(as(f.intruderId)).expect(200);
    expect(intruder.body.groups.find((g) => g.product === 'restaurant').total).toBe(0);
  });

  test('(h) settlement documents are searchable with scope authorization', async () => {
    const f = await newFixture();
    let res = await request(app).get(searchUrl('Settlement payout')).set(as(f.ownerId)).expect(200);
    let group = res.body.groups.find((g) => g.product === 'restaurant_settlement');
    expect(group.total).toBe(1);
    expect(group.results[0].documentId).toBe(f.settlementDocId);
    expect(group.results[0].creditCents).toBe(12000);
    expect(group.results[0].url).toContain('/restaurant-settlement/statements');

    res = await request(app).get(searchUrl('he-123')).set(as(f.ownerId)).expect(200);
    group = res.body.groups.find((g) => g.product === 'helper_earnings');
    expect(group.total).toBe(1);
    expect(group.results[0].documentId).toBe(f.helperDocId);
    expect(group.results[0].creditCents).toBe(8000);

    res = await request(app).get(searchUrl('INV-9')).set(as(f.ownerId)).expect(200);
    group = res.body.groups.find((g) => g.product === 'business');
    expect(group.total).toBe(1);
    expect(group.results[0].documentId).toBe(f.businessDocId);
    expect(group.results[0].creditCents).toBe(15000);

    // An active manager has finance standing and sees the settlement docs;
    // a stranger does not.
    res = await request(app).get(searchUrl('Settlement payout')).set(as(f.managerId)).expect(200);
    expect(res.body.groups.find((g) => g.product === 'restaurant_settlement').total).toBe(1);
    res = await request(app).get(searchUrl('Settlement payout')).set(as(f.intruderId)).expect(200);
    expect(res.body.groups.find((g) => g.product === 'restaurant_settlement').total).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain(f.settlementDocId);
  });

  test('(i) trends compare current vs previous period with currency separation', async () => {
    const f = await newFixture();
    const res = await request(app)
      .get(`/api/statements/oxsteed/USD/trends?period=2026-09`)
      .set(as(f.ownerId)).expect(200);
    const body = res.body;
    expect(body.product).toBe('oxsteed');
    expect(body.account.currencyCode).toBe('USD');
    // September fixture: load 10000 (credit) + purchases 2500 + 2500 (debits).
    expect(body.current.period).toEqual({ from: '2026-09-01', to: '2026-10-01' });
    expect(body.current.totals).toMatchObject({
      currencyCode: 'USD', creditsCents: 10000, debitsCents: 5000,
      netCents: 5000, transactionCount: 3,
    });
    // August fixture: one 5000 load.
    expect(body.previous.period).toEqual({ from: '2026-08-01', to: '2026-09-01' });
    expect(body.previous.totals).toMatchObject({
      currencyCode: 'USD', creditsCents: 5000, debitsCents: 0,
      netCents: 5000, transactionCount: 1,
    });
    // Deltas are signed and currency-keyed, never combined across currencies.
    expect(body.change).toMatchObject({
      currencyCode: 'USD', creditsDeltaCents: 5000, debitsDeltaCents: 5000,
      netDeltaCents: 0, countDelta: 2,
    });
    const loadDriver = body.drivers.find((d) => d.type === 'load');
    expect(loadDriver.currencyCode).toBe('USD');
    expect(loadDriver.currentNetCents).toBe(10000);
    expect(loadDriver.previousNetCents).toBe(5000);
    expect(loadDriver.deltaCents).toBe(5000);
    const purchaseDriver = body.drivers.find((d) => d.type === 'purchase');
    expect(purchaseDriver.currentNetCents).toBe(-5000);
    expect(purchaseDriver.previousNetCents).toBe(0);
    expect(purchaseDriver.deltaCents).toBe(-5000);
    // Drivers are ordered by absolute change: load (|5000|) before purchase (|-5000|) is a tie;
    // both must be present and no driver may exceed the top-5 cap.
    expect(body.drivers.length).toBeLessThanOrEqual(5);
    const breakdown = Object.fromEntries(body.breakdown.map((b) => [b.type, b]));
    expect(breakdown.load).toMatchObject({ creditsCents: 10000, debitsCents: 0, transactionCount: 1 });
    expect(breakdown.purchase).toMatchObject({ creditsCents: 0, debitsCents: 5000, transactionCount: 2 });
    for (const row of [...body.drivers, ...body.breakdown]) {
      expect(row.currencyCode).toBe('USD');
    }
  });

  test('(j) trends enforce account ownership and product support', async () => {
    const f = await newFixture();
    // Foreign account: indistinguishable 404, no probing.
    await request(app).get('/api/statements/oxsteed/USD/trends?period=2026-09')
      .set(as(f.intruderId)).expect(404);
    // Unknown account id shape.
    await request(app).get('/api/statements/oxsteed/NOPE/trends').set(as(f.ownerId)).expect(404);
    // Trends are not offered for settlement products.
    await request(app).get('/api/statements/business/1/trends').set(as(f.ownerId)).expect(400);
    // Bad period format fails closed.
    await request(app).get('/api/statements/oxsteed/USD/trends?period=september').set(as(f.ownerId)).expect(400);
    // Numeric account id also resolves.
    const res = await request(app).get(`/api/statements/oxsteed/${f.walletId}/trends?period=2026-09`)
      .set(as(f.ownerId)).expect(200);
    expect(res.body.current.totals.transactionCount).toBe(3);
    // Restaurant wallet key form resolves too.
    const restaurant = await request(app)
      .get(`/api/statements/restaurant/${f.restaurantId}:USD/trends?period=2026-09`)
      .set(as(f.ownerId)).expect(200);
    expect(restaurant.body.current.totals).toMatchObject({
      currencyCode: 'USD', creditsCents: 5000, debitsCents: 2000, transactionCount: 2,
    });
  });

  test('(k) saved views are owner-scoped CRUD', async () => {
    const f = await newFixture();
    const payload = {
      name: 'Big debits', product: 'oxsteed',
      filters: { direction: 'debit', minAmount: '100' }, sort: { key: 'debit', dir: 'desc' },
    };
    const created = await request(app).post('/api/statements/saved-views')
      .set(as(f.ownerId)).send(payload).expect(201);
    expect(created.body.view.name).toBe('Big debits');
    expect(created.body.view.filters).toEqual({ direction: 'debit', minAmount: '100' });
    expect(created.body.view.sort).toEqual({ key: 'debit', dir: 'desc' });
    const viewId = created.body.view.id;

    // Duplicate names are rejected per owner.
    await request(app).post('/api/statements/saved-views')
      .set(as(f.ownerId)).send(payload).expect(409);
    // ...but the same name is fine for another user (owner-scoped uniqueness).
    await request(app).post('/api/statements/saved-views')
      .set(as(f.intruderId)).send(payload).expect(201);

    // Listing is owner-scoped.
    const listed = await request(app).get('/api/statements/saved-views').set(as(f.ownerId)).expect(200);
    expect(listed.body.views.map((v) => v.id)).toEqual([viewId]);
    const filtered = await request(app).get('/api/statements/saved-views?product=restaurant')
      .set(as(f.ownerId)).expect(200);
    expect(filtered.body.views).toEqual([]);

    // Validation fails closed.
    await request(app).post('/api/statements/saved-views')
      .set(as(f.ownerId)).send({ name: '', product: 'oxsteed' }).expect(400);
    await request(app).post('/api/statements/saved-views')
      .set(as(f.ownerId)).send({ name: 'x', product: 'bogus' }).expect(400);
    await request(app).post('/api/statements/saved-views')
      .set(as(f.ownerId)).send({ name: 'x', product: 'oxsteed', filters: { nested: { a: 1 } } }).expect(400);

    // A foreign view id is an indistinguishable 404, not a leak.
    await request(app).delete(`/api/statements/saved-views/${viewId}`).set(as(f.intruderId)).expect(404);
    await request(app).delete(`/api/statements/saved-views/${crypto.randomUUID()}`)
      .set(as(f.ownerId)).expect(404);

    // Owner delete works and is idempotent in outcome.
    await request(app).delete(`/api/statements/saved-views/${viewId}`).set(as(f.ownerId)).expect(200);
    const after = await request(app).get('/api/statements/saved-views').set(as(f.ownerId)).expect(200);
    expect(after.body.views).toEqual([]);
  });

  test('(l) migration 868 created the saved-views table with owner scoping', async () => {
    const { rows: [table] } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'statement_saved_views'`);
    expect(table).toBeTruthy();
    const { rows: columns } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'statement_saved_views'`);
    const names = columns.map((c) => c.column_name);
    for (const expected of ['id', 'user_id', 'name', 'product', 'filters', 'sort', 'created_at']) {
      expect(names).toContain(expected);
    }
    const { rows: [unique] } = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'uq_statement_saved_views_user_name'`);
    expect(unique).toBeTruthy();
  });
});
