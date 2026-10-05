'use strict';

/**
 * Behavior tests for the settlement statement issuance/amendment/rendition
 * follow-ups (statement operations build):
 *   1. Scheduler discovery per settlement product (eligible / ineligible /
 *      zero-activity carryover), bounded and resumable.
 *   2. End-to-end issuance per product: document row in the 688 archive
 *      (never credit_statement_documents), artifact published, exactly one
 *      statement.ready outbox event.
 *   3. Settlement amendments: clerical and accounting amendments for
 *      restaurant_settlement (new immutable version, continuity), and the
 *      fail-closed accounting path for helper_earnings/business.
 *   4. Accessible renditions per product (PDF + HTML), including amended
 *      versions labeled as such.
 *
 * These tests run ONLY against the disposable localhost credit_statement_test
 * database (same guard family as the other statement suites). Without the
 * disposable DB the DB describes skip (fail closed) instead of touching a
 * real database. No source-text assertions: every test exercises behavior.
 */

jest.unmock('pg');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL;

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
    console.log('statementSettlementIssuance DB tests skipped: set STATEMENT_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  // The artifact publisher requires a configured bucket even with the
  // in-memory fake; the fake storage is injected per call.
  process.env.STATEMENT_ARTIFACT_BUCKET = 'statement-test-bucket';
}

const crypto = require('crypto');
const { Readable } = require('stream');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const jobs = require('../services/statementJobService');
const issuance = require('../services/statementIssuanceService');
const amendments = require('../services/statementAmendmentService');
const renditions = require('../routes/statementRenditions');

jest.setTimeout(180000);

const P_AUG = { from: '2026-08-01', to: '2026-08-31' }; // closed monthly period
const P_SEP = { from: '2026-09-01', to: '2026-09-30' }; // closed monthly period

// Unique per process: the disposable DB persists across runs and several
// fixture columns carry UNIQUE constraints.
const RUN_TAG = crypto.randomBytes(4).toString('hex');

// --- in-memory fake implementing the storage.js interface -------------------
function makeFakeStorage() {
  const objects = new Map();
  return {
    objects,
    async uploadFile(key, buffer) {
      objects.set(key, Buffer.from(buffer));
      return key;
    },
    async getObjectStream(key) {
      const stored = objects.get(key);
      if (!stored) return null;
      return Readable.from([stored]);
    },
    async deleteFile(key) {
      objects.delete(key);
    },
    async getSignedDownloadUrl(key, expiresIn) {
      return `https://signed.invalid/${key}?ttl=${expiresIn}`;
    },
  };
}

// --- fixtures ---------------------------------------------------------------
async function createUser(role = 'customer', { isActive = true, createdAt = '2026-01-15T12:00:00.000Z' } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, created_at, didit_status)
     VALUES ($1, $2, 'synthetic-unusable-hash', 'Settlement', 'Fixture', $3, TRUE, $4, $5, 'verified')`,
    [id, `${id}-${RUN_TAG}@example.invalid`, role, isActive, createdAt]);
  return id;
}

async function createBusiness(ownerId, name) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO businesses (user_id, business_name, created_at) VALUES ($1, $2, '2026-01-15T12:00:00.000Z') RETURNING id`,
    [ownerId, `${name}-${RUN_TAG}`]);
  return Number(row.id);
}

async function createRestaurant(businessId, ownerId, currency = 'USD', status = 'active') {
  const { rows: [row] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, currency_code, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [businessId, ownerId, `R-${RUN_TAG}-${crypto.randomBytes(2).toString('hex')}`, currency, status]);
  return Number(row.id);
}

async function createSubBank(restaurantId, currency = 'USD') {
  const { rows: [row] } = await pool.query(
    `INSERT INTO oxsteed_credit_accounts (account_type, restaurant_id, currency_code, created_at)
     VALUES ('restaurant_sub_bank', $1, $2, '2026-01-15T12:00:00.000Z') RETURNING id`,
    [restaurantId, currency]);
  return Number(row.id);
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

// Double-entry journal posting with balance_after chains (same guards as the
// other statement suites: balanced pair, direction checks).
async function postJournal({ debit, credit, amount, type, date, currency = 'USD', actorId }) {
  const client = await pool.connect();
  const id = crypto.randomUUID();
  try {
    await client.query('BEGIN');
    const { rows: balances } = await client.query(
      'SELECT * FROM oxsteed_credit_accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
      [[debit, credit]]);
    const debitAccount = balances.find((v) => String(v.id) === String(debit));
    const creditAccount = balances.find((v) => String(v.id) === String(credit));
    await client.query(
      `INSERT INTO oxsteed_credit_transactions
        (id, transaction_type, status, debit_account_id, credit_account_id, amount_cents, currency_code,
         idempotency_key, description, reason, actor_type, actor_user_id, posted_at, created_at)
       VALUES ($1,$2,'posted',$3,$4,$5,$6,$7,'Synthetic settlement fixture','Settlement test fixture','admin',$8,$9,$9)`,
      [id, type, debit, credit, amount, currency, `settle-${id}`, actorId, date]);
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
  return id;
}

async function createJob({ helperId, clientId, payoutCents = 5000, completedAt = '2026-08-15T12:00:00.000Z', currency = 'USD' }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO jobs (client_id, assigned_helper_id, title, description, status, payout_status,
                       completed_at, helper_payout_cents, platform_fee_cents, currency_code)
     VALUES ($1,$2,'Fixture job','Synthetic settlement fixture','completed','earned',$3,$4,500,$5) RETURNING id`,
    [clientId, helperId, completedAt, payoutCents, currency]);
  return row.id;
}

async function createInvoice({ businessId, userId, issueDate, totalDollars, currency = 'USD' }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO business_invoices (user_id, business_id, invoice_number, client_name, status,
                                    issue_date, total, amount_paid, currency_code)
     VALUES ($1,$2,$3,'Client Co','sent',$4,$5,'0.00',$6) RETURNING id`,
    [userId, businessId, `INV-${RUN_TAG}-${crypto.randomBytes(2).toString('hex')}`, issueDate, totalDollars, currency]);
  return row.id;
}

async function issueSettlement({ product, spec, from, to, storage }) {
  const run = await jobs.createRun({ product, periodFrom: from, periodTo: to });
  await jobs.discoverAccountJobs(run.id, [{ ...spec, product }]);
  const job = await jobs.claimNextAccountJob(`settle-test-${RUN_TAG}`);
  if (!job) throw new Error(`no claimable issuance job for ${product}`);
  return issuance.issueAccountStatement({ job, workerId: `settle-test-${RUN_TAG}`, storage });
}

async function settlementDocumentRow({ product, scopeColumn, scopeValue, from, to }) {
  const { rows: [row] } = await pool.query(
    `SELECT * FROM settlement_statement_documents
     WHERE product = $1 AND ${scopeColumn} = $2 AND currency_code = 'USD'
       AND period_from = $3 AND period_to = $4`,
    [product, scopeValue, from, to]);
  return row;
}

// Mirrors decideAmendment's decision update (minus audit) for service-level tests.
async function decideProposal(proposalId, approverId, decision, reason = 'verified against records') {
  const { rows: [row] } = await pool.query(
    `UPDATE statement_amendment_proposals
     SET status = $2, decided_by = $3, decision_reason = $4
     WHERE id = $1 RETURNING *`,
    [proposalId, decision, approverId, reason]);
  return row;
}

// Claims are global across runs: drain claimable leftovers before each test
// so one test never picks up another's unfinished jobs.
async function drainClaimableJobs() {
  for (let i = 0; i < 300; i += 1) {
    const job = await jobs.claimNextAccountJob('test-drain');
    if (!job) return;
    if (job.state === 'leased') {
      await jobs.failJob(job.id, 'test-drain', job.fencing_token, 'test drain', false);
    }
  }
  throw new Error('test drain did not converge');
}

function bearer(userId, role = 'customer') {
  return `Bearer ${jwt.sign({ id: userId, role }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;
}

function buildRenditionsApp() {
  const app = express();
  app.use(express.json());
  // Minimal auth shim: the router uses the repo's authenticate middleware;
  // here we decode the same JWT shape instead of standing up sessions.
  app.use('/api/statements', (req, res, next) => {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ code: 'statement_unauthorized' });
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ code: 'statement_unauthorized' });
    }
    return next();
  }, renditions);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ code: err.code || 'internal_error', message: err.message });
  });
  return app;
}

// --- discovery ----------------------------------------------------------------
ddescribe('settlement issuance discovery', () => {
  beforeEach(drainClaimableJobs);

  test('restaurant_settlement: active sub-bank account is eligible', async () => {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Discover Eats');
    const restaurantId = await createRestaurant(businessId, owner, 'USD', 'active');
    await createSubBank(restaurantId, 'USD');

    const { eligible, skipped } = await issuance.discoverEligibleAccounts({
      product: 'restaurant_settlement', periodFrom: P_AUG.from, periodTo: P_AUG.to,
    });
    const mine = eligible.find((e) => e.accountId === String(restaurantId));
    expect(mine).toBeDefined();
    expect(mine.customerId).toBe(owner);
    expect(mine.currencyCode).toBe('USD');
    expect(skipped.find((s) => s.accountId === String(restaurantId))).toBeUndefined();
  });

  test('restaurant_settlement: suspended restaurant is skipped, never silently', async () => {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Suspended Eats');
    const restaurantId = await createRestaurant(businessId, owner, 'USD', 'suspended');
    await createSubBank(restaurantId, 'USD');

    const { eligible, skipped } = await issuance.discoverEligibleAccounts({
      product: 'restaurant_settlement', periodFrom: P_AUG.from, periodTo: P_AUG.to,
    });
    expect(eligible.find((e) => e.accountId === String(restaurantId))).toBeUndefined();
    const skip = skipped.find((s) => s.accountId === String(restaurantId));
    expect(skip).toBeDefined();
    expect(skip.reason).toMatch(/suspended/);
  });

  test('restaurant_settlement: zero-activity sub-bank is eligible (carryover)', async () => {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Quiet Eats');
    const restaurantId = await createRestaurant(businessId, owner, 'USD', 'active');
    await createSubBank(restaurantId, 'USD');
    // No journal postings at all: discovery is status-based, not activity-based.

    const { eligible } = await issuance.discoverEligibleAccounts({
      product: 'restaurant_settlement', periodFrom: P_AUG.from, periodTo: P_AUG.to,
    });
    expect(eligible.find((e) => e.accountId === String(restaurantId))).toBeDefined();
  });

  test('helper_earnings: helper with earnings activity is eligible (UUID scope)', async () => {
    const helper = await createUser('helper');
    const client = await createUser('customer');
    await createJob({ helperId: helper, clientId: client, payoutCents: 5000 });

    const { eligible } = await issuance.discoverEligibleAccounts({
      product: 'helper_earnings', periodFrom: P_AUG.from, periodTo: P_AUG.to,
    });
    const mine = eligible.find((e) => e.accountUuid === helper.toLowerCase());
    expect(mine).toBeDefined();
    expect(mine.accountId).toBeUndefined();
    expect(mine.customerId).toBe(helper.toLowerCase());
  });

  test('helper_earnings: suspended helper is skipped', async () => {
    const helper = await createUser('helper', { isActive: false });
    const client = await createUser('customer');
    await createJob({ helperId: helper, clientId: client, payoutCents: 5000 });

    const { eligible, skipped } = await issuance.discoverEligibleAccounts({
      product: 'helper_earnings', periodFrom: P_AUG.from, periodTo: P_AUG.to,
    });
    expect(eligible.find((e) => e.accountUuid === helper.toLowerCase())).toBeUndefined();
    const skip = skipped.find((s) => s.accountUuid === helper.toLowerCase());
    expect(skip).toBeDefined();
    expect(skip.reason).toBe('account-suspended');
  });

  test('helper_earnings: helper with a job but no priced payout is eligible (zero-activity carryover)', async () => {
    const helper = await createUser('helper');
    const client = await createUser('customer');
    await createJob({ helperId: helper, clientId: client, payoutCents: null });

    const { eligible } = await issuance.discoverEligibleAccounts({
      product: 'helper_earnings', periodFrom: P_AUG.from, periodTo: P_AUG.to,
    });
    expect(eligible.find((e) => e.accountUuid === helper.toLowerCase())).toBeDefined();
  });

  test('business: business with invoice activity is eligible', async () => {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Invoice Co');
    await createInvoice({ businessId, userId: owner, issueDate: '2026-08-10', totalDollars: '250.00' });

    const { eligible } = await issuance.discoverEligibleAccounts({
      product: 'business', periodFrom: P_AUG.from, periodTo: P_AUG.to,
    });
    const mine = eligible.find((e) => e.accountId === String(businessId) && e.currencyCode === 'USD');
    expect(mine).toBeDefined();
    expect(mine.customerId).toBe(owner);
  });

  test('business: deleted business is skipped as closed', async () => {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Closed Co');
    await createInvoice({ businessId, userId: owner, issueDate: '2026-08-10', totalDollars: '100.00' });
    await pool.query('UPDATE businesses SET deleted_at = NOW() WHERE id = $1', [businessId]);

    const { eligible, skipped } = await issuance.discoverEligibleAccounts({
      product: 'business', periodFrom: P_AUG.from, periodTo: P_AUG.to,
    });
    expect(eligible.find((e) => e.accountId === String(businessId))).toBeUndefined();
    const skip = skipped.find((s) => s.accountId === String(businessId));
    expect(skip).toBeDefined();
    expect(skip.reason).toBe('account-closed');
  });

  test('business: business with a currency source but no invoices is eligible (zero-activity carryover)', async () => {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'No Invoice Co');
    // The restaurant supplies the currency scope; no invoices exist.
    await createRestaurant(businessId, owner, 'USD', 'active');

    const { eligible } = await issuance.discoverEligibleAccounts({
      product: 'business', periodFrom: P_AUG.from, periodTo: P_AUG.to,
    });
    expect(eligible.find((e) => e.accountId === String(businessId) && e.currencyCode === 'USD')).toBeDefined();
  });

  test('discovery is bounded and resumable via cursors', async () => {
    const owner = await createUser('customer');
    // One restaurant per business (unique business constraint): two businesses.
    const b1 = await createBusiness(owner, 'Cursor Eats One');
    const b2 = await createBusiness(owner, 'Cursor Eats Two');
    const r1 = await createRestaurant(b1, owner, 'USD', 'active');
    const r2 = await createRestaurant(b2, owner, 'USD', 'active');
    await createSubBank(r1, 'USD');
    await createSubBank(r2, 'USD');

    // Page through the whole discovery set two rows at a time: every page
    // is bounded, cursors resume, and nothing repeats or goes missing.
    const seen = new Map();
    let cursor = null;
    for (let page = 0; page < 200; page += 1) {
      const { eligible, skipped, nextCursor } = await issuance.discoverEligibleAccounts({
        product: 'restaurant_settlement', periodFrom: P_AUG.from, periodTo: P_AUG.to,
        batchSize: 2, cursor,
      });
      expect(eligible.length + skipped.length).toBeLessThanOrEqual(2);
      for (const e of [...eligible, ...skipped]) {
        const key = jobs.issuanceKeyFor({
          product: 'restaurant_settlement', accountId: e.accountId, currencyCode: e.currencyCode,
          periodFrom: P_AUG.from, periodTo: P_AUG.to, customerId: e.customerId,
        });
        expect(seen.has(key)).toBe(false);
        seen.set(key, e);
      }
      cursor = nextCursor;
      if (!nextCursor) break;
    }
    expect(cursor).toBeNull();
    const mine = [...seen.values()].filter((e) => e.accountId === String(r1) || e.accountId === String(r2));
    // Both new accounts appear exactly once, eligible, with deterministic keys.
    expect(mine).toHaveLength(2);
    expect(mine.every((e) => seen.has(jobs.issuanceKeyFor({
      product: 'restaurant_settlement', accountId: e.accountId, currencyCode: e.currencyCode,
      periodFrom: P_AUG.from, periodTo: P_AUG.to, customerId: e.customerId,
    })))).toBe(true);
  });
});

// --- end-to-end issuance ------------------------------------------------------
ddescribe('settlement issuance end-to-end', () => {
  beforeEach(drainClaimableJobs);

  test('restaurant_settlement: issues into the 688 archive with one ready event', async () => {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Issued Eats');
    const restaurantId = await createRestaurant(businessId, owner, 'USD', 'active');
    const subBank = await createSubBank(restaurantId, 'USD');
    const treasury = await getOrCreateTreasury('USD');
    const poster = await createUser('admin');
    await postJournal({
      debit: treasury, credit: subBank, amount: 12000, type: 'sub_bank_load',
      date: '2026-08-15T12:00:00.000Z', actorId: poster,
    });
    const storage = makeFakeStorage();

    const result = await issueSettlement({
      product: 'restaurant_settlement',
      spec: { customerId: owner, accountId: String(restaurantId), currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });

    const row = await settlementDocumentRow({
      product: 'restaurant_settlement', scopeColumn: 'scope_restaurant_id',
      scopeValue: restaurantId, from: P_AUG.from, to: P_AUG.to,
    });
    expect(row).toBeDefined();
    expect(row.id).toBe(result.documentId);
    expect(row.document.product).toBe('restaurant_settlement');
    expect(row.document.closingBalanceCents).toBe(12000);
    // Scopes never mix: nothing lands in the credit archive.
    const { rows: credit } = await pool.query(
      `SELECT id FROM credit_statement_documents
       WHERE product = 'restaurant_settlement' AND period_from = $1 AND period_to = $2`,
      [P_AUG.from, P_AUG.to]);
    expect(credit).toHaveLength(0);
    // Artifact published to the fake bucket.
    const { rows: artifacts } = await pool.query(
      `SELECT * FROM statement_artifacts WHERE settlement_document_id = $1 AND kind = 'original'`,
      [row.id]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].state).toBe('ready');
    expect(artifacts[0].id).toBe(result.artifactId);
    expect(storage.objects.has(artifacts[0].object_key)).toBe(true);
    // Exactly one statement.ready event for the job.
    const { rows: events } = await pool.query(
      `SELECT * FROM statement_outbox WHERE event_type = 'statement.ready' AND aggregate_id = $1`,
      [result.jobId]);
    expect(events).toHaveLength(1);
    expect(events[0].payload.documentId).toBe(row.id);
  });

  test('helper_earnings: issues with UUID scope and one ready event', async () => {
    const helper = await createUser('helper');
    const client = await createUser('customer');
    await createJob({ helperId: helper, clientId: client, payoutCents: 7500 });
    const storage = makeFakeStorage();

    await issueSettlement({
      product: 'helper_earnings',
      spec: { customerId: helper, accountUuid: helper, currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });

    const row = await settlementDocumentRow({
      product: 'helper_earnings', scopeColumn: 'scope_helper_user_id',
      scopeValue: helper, from: P_AUG.from, to: P_AUG.to,
    });
    expect(row).toBeDefined();
    expect(row.document.product).toBe('helper_earnings');
    // Inserted today: a past completed_at is an effective date, not proof that
    // the immutable source observation was posted in August.
    expect(row.document.postedEarningsCents).toBe(0);
    const { rows: events } = await pool.query(
      `SELECT * FROM statement_outbox WHERE event_type = 'statement.ready'
       AND payload->>'documentId' = $1`,
      [row.id]);
    expect(events).toHaveLength(1);
    expect(events[0].payload.accountId).toBe(helper.toLowerCase());
  });

  test('business: issues with invoice activity and one ready event', async () => {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Issued Co');
    await createInvoice({ businessId, userId: owner, issueDate: '2026-08-10', totalDollars: '250.00' });
    const storage = makeFakeStorage();

    await issueSettlement({
      product: 'business',
      spec: { customerId: owner, accountId: String(businessId), currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });

    const row = await settlementDocumentRow({
      product: 'business', scopeColumn: 'scope_business_id',
      scopeValue: businessId, from: P_AUG.from, to: P_AUG.to,
    });
    expect(row).toBeDefined();
    expect(row.document.product).toBe('business');
    expect(row.document.receivables.invoicedCents).toBe(0);
    const { rows: events } = await pool.query(
      `SELECT * FROM statement_outbox WHERE event_type = 'statement.ready'
       AND payload->>'documentId' = $1`,
      [row.id]);
    expect(events).toHaveLength(1);
  });

  test('re-issuance of the same period converges on one document and one event', async () => {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Converge Eats');
    const restaurantId = await createRestaurant(businessId, owner, 'USD', 'active');
    await createSubBank(restaurantId, 'USD');
    const storage = makeFakeStorage();
    const spec = { customerId: owner, accountId: String(restaurantId), currencyCode: 'USD' };

    await issueSettlement({ product: 'restaurant_settlement', spec, from: P_SEP.from, to: P_SEP.to, storage });

    // A second run over the same period discovers the same issuance key; the
    // job insert is a no-op (ON CONFLICT DO NOTHING) and there is nothing to
    // claim: the pipeline converges instead of re-issuing.
    const run2 = await jobs.createRun({ product: 'restaurant_settlement', periodFrom: P_SEP.from, periodTo: P_SEP.to });
    await jobs.discoverAccountJobs(run2.id, [{ ...spec, product: 'restaurant_settlement' }]);
    const again = await jobs.claimNextAccountJob(`settle-test-${RUN_TAG}`);
    expect(again).toBeNull();

    const { rows: docs } = await pool.query(
      `SELECT id FROM settlement_statement_documents
       WHERE product = 'restaurant_settlement' AND scope_restaurant_id = $1
         AND period_from = $2 AND period_to = $3`,
      [restaurantId, P_SEP.from, P_SEP.to]);
    expect(docs).toHaveLength(1);
    const { rows: events } = await pool.query(
      `SELECT * FROM statement_outbox WHERE event_type = 'statement.ready'
       AND payload->>'documentId' = $1`,
      [docs[0].id]);
    expect(events).toHaveLength(1);
  });
});

// --- amendments ---------------------------------------------------------------
ddescribe('settlement amendments', () => {
  beforeEach(drainClaimableJobs);

  async function issueRestaurantSettlement() {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Amend Eats');
    const restaurantId = await createRestaurant(businessId, owner, 'USD', 'active');
    const subBank = await createSubBank(restaurantId, 'USD');
    const treasury = await getOrCreateTreasury('USD');
    const poster = await createUser('admin');
    await postJournal({
      debit: treasury, credit: subBank, amount: 12000, type: 'sub_bank_load',
      date: '2026-08-15T12:00:00.000Z', actorId: poster,
    });
    const storage = makeFakeStorage();
    await issueSettlement({
      product: 'restaurant_settlement',
      spec: { customerId: owner, accountId: String(restaurantId), currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });
    const row = await settlementDocumentRow({
      product: 'restaurant_settlement', scopeColumn: 'scope_restaurant_id',
      scopeValue: restaurantId, from: P_AUG.from, to: P_AUG.to,
    });
    return { owner, restaurantId, subBank, treasury, documentId: row.id, storage };
  }

  test('clerical amendment publishes an immutable version with continuity', async () => {
    const admin = await createUser('admin');
    const { documentId, storage } = await issueRestaurantSettlement();

    const proposal = await amendments.proposeAmendment({
      adminId: admin,
      documentId,
      amendmentType: 'clerical',
      reason: 'Correct a misspelled merchant name on the statement header',
    });
    expect(proposal.product).toBe('restaurant_settlement');
    expect(proposal.documentId).toBe(documentId);
    expect(proposal.baseRevisionNumber).toBe(0);

    await decideProposal(proposal.proposalId, admin, 'approved');
    const result = await amendments.finalizeApprovedProposal(proposal.proposalId, { storage });
    expect(result.status).toBe('published');
    expect(result.version.revisionNumber).toBe(1);
    expect(result.version.originalDocumentId).toBe(documentId);
    expect(result.version.continuityStatus).toBe('continuous');

    // The version links to the settlement original, never the credit archive.
    const { rows: [version] } = await pool.query(
      'SELECT * FROM statement_amendment_versions WHERE id = $1', [result.version.versionId]);
    expect(version.settlement_original_document_id).toBe(documentId);
    expect(version.original_document_id).toBeNull();
    expect(version.settlement_next_period_document_id).toBeNull();
    // The issued original row is untouched: immutability holds.
    const { rows: [original] } = await pool.query(
      'SELECT content_hash, document FROM settlement_statement_documents WHERE id = $1', [documentId]);
    expect(original.content_hash).toBe(original.document.contentHash);
    // Amended artifact links back to the settlement original.
    const { rows: [artifact] } = await pool.query(
      'SELECT * FROM statement_artifacts WHERE id = $1', [version.artifact_id]);
    expect(artifact.settlement_document_id).toBe(documentId);
    expect(artifact.document_id).toBeNull();
  });

  test('accounting amendment for restaurant_settlement restates from a posted compensating transaction', async () => {
    const admin = await createUser('admin');
    const { documentId, subBank, treasury, owner, storage } = await issueRestaurantSettlement();

    // A posted correction that credits the sub-bank account in-period.
    const txId = await postJournal({
      debit: treasury, credit: subBank, amount: 3000, type: 'adjustment',
      date: '2026-08-20T12:00:00.000Z', actorId: admin,
    });

    const proposal = await amendments.proposeAmendment({
      adminId: admin,
      documentId,
      amendmentType: 'accounting',
      presentation: 'restated',
      reason: 'Late-posted settlement funding belongs in August',
      compensatingTransactionRefs: [txId],
    });
    await decideProposal(proposal.proposalId, admin, 'approved');
    const result = await amendments.finalizeApprovedProposal(proposal.proposalId, { storage });
    expect(result.status).toBe('published');
    const revised = result.version;
    expect(revised.revisedClosingMinor).toBe(15000);
    expect(revised.priorClosingMinor).toBe(12000);
    expect(revised.continuityStatus).toBe('continuous');

    // The envelope totals carry the product-specific journal groups.
    const { rows: [version] } = await pool.query(
      'SELECT document FROM statement_amendment_versions WHERE id = $1', [revised.versionId]);
    expect(version.document.totals.revised.closingMinor).toBe(15000);
    expect(version.document.totals.adjustment.creditsMinor).toBe(3000);
    expect(version.document.totals.adjustment.compensatingTransactions).toHaveLength(1);
    expect(version.document.totals.adjustment.compensatingTransactions[0].id).toBe(txId);
  });

  test('accounting amendment for helper_earnings fails closed', async () => {
    const admin = await createUser('admin');
    const helper = await createUser('helper');
    const client = await createUser('customer');
    await createJob({ helperId: helper, clientId: client, payoutCents: 5000 });
    const storage = makeFakeStorage();
    await issueSettlement({
      product: 'helper_earnings',
      spec: { customerId: helper, accountUuid: helper, currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });
    const doc = await settlementDocumentRow({
      product: 'helper_earnings', scopeColumn: 'scope_helper_user_id',
      scopeValue: helper, from: P_AUG.from, to: P_AUG.to,
    });

    await expect(amendments.proposeAmendment({
      adminId: admin,
      documentId: doc.id,
      amendmentType: 'accounting',
      reason: 'attempted accounting amendment on a snapshot product',
      compensatingTransactionRefs: [crypto.randomUUID()],
    })).rejects.toMatchObject({ code: 'statement_amendment_accounting_unsupported', statusCode: 409 });
  });

  test('accounting amendment for business fails closed', async () => {
    const admin = await createUser('admin');
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'No Ledger Co');
    await createInvoice({ businessId, userId: owner, issueDate: '2026-08-10', totalDollars: '100.00' });
    const storage = makeFakeStorage();
    await issueSettlement({
      product: 'business',
      spec: { customerId: owner, accountId: String(businessId), currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });
    const doc = await settlementDocumentRow({
      product: 'business', scopeColumn: 'scope_business_id',
      scopeValue: businessId, from: P_AUG.from, to: P_AUG.to,
    });

    await expect(amendments.proposeAmendment({
      adminId: admin,
      documentId: doc.id,
      amendmentType: 'accounting',
      reason: 'attempted accounting amendment on a snapshot product',
      compensatingTransactionRefs: ['123'],
    })).rejects.toMatchObject({ code: 'statement_amendment_accounting_unsupported', statusCode: 409 });
  });

  test('clerical amendment is supported for helper_earnings', async () => {
    const admin = await createUser('admin');
    const helper = await createUser('helper');
    const client = await createUser('customer');
    await createJob({ helperId: helper, clientId: client, payoutCents: 5000 });
    const storage = makeFakeStorage();
    await issueSettlement({
      product: 'helper_earnings',
      spec: { customerId: helper, accountUuid: helper, currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });
    const doc = await settlementDocumentRow({
      product: 'helper_earnings', scopeColumn: 'scope_helper_user_id',
      scopeValue: helper, from: P_AUG.from, to: P_AUG.to,
    });

    const proposal = await amendments.proposeAmendment({
      adminId: admin,
      documentId: doc.id,
      amendmentType: 'clerical',
      reason: 'Fix a display-name typo in the earnings statement header',
    });
    expect(proposal.product).toBe('helper_earnings');
    expect(proposal.accountId).toBe(helper.toLowerCase());
    await decideProposal(proposal.proposalId, admin, 'approved');
    const result = await amendments.finalizeApprovedProposal(proposal.proposalId, { storage });
    expect(result.status).toBe('published');
    const { rows: [version] } = await pool.query(
      'SELECT document FROM statement_amendment_versions WHERE id = $1', [result.version.versionId]);
    expect(version.document.totals.revised.closingMinor).toBe(5000);
    expect(version.document.totals.revised.postedMinor).toBe(5000);
  });
});

// --- renditions ---------------------------------------------------------------
ddescribe('settlement accessible renditions', () => {
  beforeEach(drainClaimableJobs);

  async function issueRestaurantSettlementWithVersion() {
    const admin = await createUser('admin');
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Rendition Eats');
    const restaurantId = await createRestaurant(businessId, owner, 'USD', 'active');
    const subBank = await createSubBank(restaurantId, 'USD');
    const treasury = await getOrCreateTreasury('USD');
    await postJournal({
      debit: treasury, credit: subBank, amount: 9000, type: 'sub_bank_load',
      date: '2026-08-15T12:00:00.000Z', actorId: admin,
    });
    const storage = makeFakeStorage();
    await issueSettlement({
      product: 'restaurant_settlement',
      spec: { customerId: owner, accountId: String(restaurantId), currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });
    const doc = await settlementDocumentRow({
      product: 'restaurant_settlement', scopeColumn: 'scope_restaurant_id',
      scopeValue: restaurantId, from: P_AUG.from, to: P_AUG.to,
    });
    const proposal = await amendments.proposeAmendment({
      adminId: admin, documentId: doc.id, amendmentType: 'clerical',
      reason: 'Header typo for the rendition labeling test',
    });
    await decideProposal(proposal.proposalId, admin, 'approved');
    const finalized = await amendments.finalizeApprovedProposal(proposal.proposalId, { storage });
    return { owner, documentId: doc.id, versionId: finalized.version.versionId, storage };
  }

  test('restaurant_settlement original: PDF and HTML renditions serve with tagging', async () => {
    const { owner, documentId } = await issueRestaurantSettlementWithVersion();
    const app = buildRenditionsApp();
    const auth = bearer(owner);

    const pdf = await request(app)
      .get(`/api/statements/documents/${documentId}/renditions/en/pdf`)
      .set('Authorization', auth);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.headers['content-disposition']).toContain('restaurant_settlement');

    const html = await request(app)
      .get(`/api/statements/documents/${documentId}/renditions/en/html`)
      .set('Authorization', auth);
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    // Localized product label in the body; the product key rides in the
    // download filename (no PII).
    expect(html.text).toContain('Restaurant settlement');
    expect(html.text).not.toContain('Amended statement');

    // Rendition recorded as a staged audit row linked to the settlement original.
    const { rows } = await pool.query(
      `SELECT * FROM statement_artifacts
       WHERE settlement_document_id = $1 AND kind = 'rendition' AND state = 'staged'`,
      [documentId]);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.document_id === null)).toBe(true);
  });

  test('amended version: HTML rendition is labeled as amended', async () => {
    const { owner, versionId } = await issueRestaurantSettlementWithVersion();
    const app = buildRenditionsApp();

    const html = await request(app)
      .get(`/api/statements/documents/${versionId}/renditions/en/html`)
      .set('Authorization', bearer(owner));
    expect(html.status).toBe(200);
    expect(html.text).toContain('Amended statement');
  });

  test('helper_earnings: HTML rendition serves for the UUID-scoped product', async () => {
    const helper = await createUser('helper');
    const client = await createUser('customer');
    await createJob({ helperId: helper, clientId: client, payoutCents: 4200 });
    const storage = makeFakeStorage();
    await issueSettlement({
      product: 'helper_earnings',
      spec: { customerId: helper, accountUuid: helper, currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });
    const doc = await settlementDocumentRow({
      product: 'helper_earnings', scopeColumn: 'scope_helper_user_id',
      scopeValue: helper, from: P_AUG.from, to: P_AUG.to,
    });
    const app = buildRenditionsApp();

    const html = await request(app)
      .get(`/api/statements/documents/${doc.id}/renditions/es/html`)
      .set('Authorization', bearer(helper, 'helper'));
    expect(html.status).toBe(200);
    expect(html.headers['content-language']).toBe('es');
    // The product name is localized, so assert on the localized label.
    // (Period dates render in the locale's date format, not ISO.)
    expect(html.text).toContain('Ingresos del ayudante');
  });

  test('business: PDF rendition serves for the business product', async () => {
    const owner = await createUser('customer');
    const businessId = await createBusiness(owner, 'Rendition Co');
    await createInvoice({ businessId, userId: owner, issueDate: '2026-08-10', totalDollars: '310.00' });
    const storage = makeFakeStorage();
    await issueSettlement({
      product: 'business',
      spec: { customerId: owner, accountId: String(businessId), currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });
    const doc = await settlementDocumentRow({
      product: 'business', scopeColumn: 'scope_business_id',
      scopeValue: businessId, from: P_AUG.from, to: P_AUG.to,
    });
    const app = buildRenditionsApp();

    const pdf = await request(app)
      .get(`/api/statements/documents/${doc.id}/renditions/fr/pdf`)
      .set('Authorization', bearer(owner));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('foreign settlement documents 404 (ownership not probeable)', async () => {
    const { documentId } = await issueRestaurantSettlementWithVersion();
    const stranger = await createUser('customer');
    const app = buildRenditionsApp();

    const res = await request(app)
      .get(`/api/statements/documents/${documentId}/renditions/en/pdf`)
      .set('Authorization', bearer(stranger));
    expect(res.status).toBe(404);
  });

  test('helper cannot read another helper earnings rendition', async () => {
    const helper = await createUser('helper');
    const other = await createUser('helper');
    const client = await createUser('customer');
    await createJob({ helperId: helper, clientId: client, payoutCents: 4200 });
    const storage = makeFakeStorage();
    await issueSettlement({
      product: 'helper_earnings',
      spec: { customerId: helper, accountUuid: helper, currencyCode: 'USD' },
      from: P_AUG.from, to: P_AUG.to, storage,
    });
    const doc = await settlementDocumentRow({
      product: 'helper_earnings', scopeColumn: 'scope_helper_user_id',
      scopeValue: helper, from: P_AUG.from, to: P_AUG.to,
    });
    const app = buildRenditionsApp();

    const res = await request(app)
      .get(`/api/statements/documents/${doc.id}/renditions/en/html`)
      .set('Authorization', bearer(other, 'helper'));
    expect(res.status).toBe(404);
  });
});
