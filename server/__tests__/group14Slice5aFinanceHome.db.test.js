'use strict';

// Group 14 Slice 5a acceptance: finance home (701-705). All five items are
// EXISTS — this suite is VERIFY-ONLY: it proves the shipped surfaces live
// against a fresh dedicated database (credit_statement_test_g14a), with no
// build underneath it.
//   701 Scoped finance home: GET /api/statements/center is scoped server-side
//       to req.user.id; a user sees only their own accounts/documents.
//   702 Organization selector: the home's account list is per-account
//       (buildStatementAccounts) and the archive's /scopes + accountId filter
//       do the same server-side; the account is the org boundary (D-409).
//   703 Reporting period filter: archive year/month filters, with
//       statement_archive_invalid_period on bad input.
//   704 Statement archive: ready-only artifacts, short-lived signed URLs,
//       per-call re-authorization on download.
//   705 Document search: unified text + amount search across products.
// Group 14 is READ-ONLY (D-408): nothing here moves money.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const { Readable } = require('stream');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP14_SLICE5A_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g14a') {
    throw new Error('Group 14 Slice 5a DB tests require the loopback credit_statement_test_g14a database');
  }
  process.env.DATABASE_URL = dbUrl;
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'group14-slice5a-test-secret';
process.env.STATEMENT_ARTIFACT_BUCKET = 'statement-test-bucket';
process.env.STATEMENT_ARTIFACT_PREFIX = 'test-statements';

jest.setTimeout(120000);

const describeDb = dbUrl ? describe : describe.skip;

const runId = crypto.randomUUID().slice(0, 8);

// --- in-memory fake implementing the storage.js interface ------------------
function makeFakeStorage() {
  const objects = new Map();
  return {
    objects,
    async uploadFile(key, buffer, contentType) {
      objects.set(key, { buffer: Buffer.from(buffer), contentType });
      return key;
    },
    async getObjectStream(key) {
      const stored = objects.get(key);
      if (!stored) return null;
      return Readable.from([stored.buffer]);
    },
    async deleteFile(key) {
      objects.delete(key);
    },
    async getSignedDownloadUrl(key, expiresIn) {
      const exp = Math.floor(Date.now() / 1000) + Math.max(1, Number(expiresIn) || 300);
      return `https://signed.invalid/${key}?ttl=${expiresIn}&exp=${exp}&sig=fake`;
    },
  };
}

function fakePdf(payload) {
  return Buffer.from(`%PDF-1.7\n% g14a archive fixture ${payload} ${runId}\n`, 'utf8');
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function consumeToBuffer(response) {
  if (Buffer.isBuffer(response.body) && response.body.length) return response.body;
  if (typeof response.text === 'string' && response.text.length) return Buffer.from(response.text, 'binary');
  return Buffer.alloc(0);
}

describeDb('Group 14 Slice 5a: finance home (701-705)', () => {
  let pool;
  let creditService;
  let app;
  let storage;
  let admin;
  let userA;
  let userB;
  let userC;
  let treasuryId;
  let walletA;
  let walletB;
  let walletC;
  let docAJuly;
  let docBJuly;
  let docCJuly;
  let helperDocA;
  let helperDocB;
  let originalPdfA;

  beforeAll(async () => {
    pool = require('../db');
    creditService = require('../services/oxsteedCreditService');
    const { authenticate } = require('../middleware/auth');
    const artifacts = require('../services/statementArtifactService');
    const createStatementArchiveRouter = require('../routes/statementArchive');

    storage = makeFakeStorage();
    app = express();
    app.use(express.json());
    app.use('/api', require('../routes/statementCenter'));
    app.use('/api/statements', require('../routes/statementSearch'));
    app.use('/api/statement-archive', createStatementArchiveRouter({ storage }));
    app.use(require('../middleware/errorHandler').errorHandler);

    admin = await makeUser('super_admin');
    userA = await makeUser();
    userB = await makeUser();
    userC = await makeUser();
    process.env.OXSTEED_CREDIT_SERVICE_ADMIN_ID = admin.id;
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'Group 14 Slice 5a test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`,
    );
    treasuryId = await ensureCreditAccount({ accountType: 'platform_treasury' });
    walletA = await ensureCreditAccount({ accountType: 'customer_wallet', customerId: userA.id });
    walletB = await ensureCreditAccount({ accountType: 'customer_wallet', customerId: userB.id });
    walletC = await ensureCreditAccount({ accountType: 'customer_wallet', customerId: userC.id });

    // Posted loads with distinct descriptions/amounts so search can tell the
    // owners apart: A loads $50.00, B loads $70.00.
    await postLoad(userA, walletA, 5000, `g14a-load-a-${userA.id}`, 'G14A slice verification load');
    await postLoad(userB, walletB, 7000, `g14a-load-b-${userB.id}`, 'Other user load g14a');

    docAJuly = await insertCreditDocument({
      customerId: userA.id, product: 'oxsteed', accountId: walletA, currency: 'USD',
      from: '2026-07-01', to: '2026-07-31',
    });
    docBJuly = await insertCreditDocument({
      customerId: userB.id, product: 'oxsteed', accountId: walletB, currency: 'USD',
      from: '2026-07-01', to: '2026-07-31',
    });
    docCJuly = await insertCreditDocument({
      customerId: userC.id, product: 'oxsteed', accountId: walletC, currency: 'USD',
      from: '2026-07-01', to: '2026-07-31',
    });
    helperDocA = await insertSettlementDocument({
      product: 'helper_earnings', scopeHelperUserId: userA.id,
      from: '2026-07-01', to: '2026-07-31',
    });
    helperDocB = await insertSettlementDocument({
      product: 'helper_earnings', scopeHelperUserId: userB.id,
      from: '2026-07-01', to: '2026-07-31',
    });

    // Publish the real way so document linkage, verify-before-ready and
    // byte/hash records are exercised through the artifact service.
    originalPdfA = fakePdf('original-a-july');
    const snapshotA = await insertSnapshot({
      product: 'oxsteed', accountId: walletA, currency: 'USD',
      from: '2026-07-01', to: '2026-07-31', customerId: userA.id,
    });
    const originalA = await artifacts.publishOriginal({
      snapshotId: snapshotA, language: 'en', pdfBytes: originalPdfA, storage,
    });
    expect(originalA.state).toBe('ready');
    const snapshotC = await insertSnapshot({
      product: 'oxsteed', accountId: walletC, currency: 'USD',
      from: '2026-07-01', to: '2026-07-31', customerId: userC.id,
    });
    const originalC = await artifacts.publishOriginal({
      snapshotId: snapshotC, language: 'en', pdfBytes: fakePdf('original-c-july'), storage,
    });
    expect(originalC.state).toBe('ready');
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

  async function ensureCreditAccount({ accountType, customerId = null, partnerId = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await creditService.ensureAccount(client, {
        accountType, customerId, partnerId, currencyCode: 'USD',
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

  async function postLoad(user, walletId, amountCents, key, description) {
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
        description,
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

  async function insertCreditDocument({ customerId, product, accountId, currency, from, to }) {
    const id = crypto.randomUUID();
    const generatedAt = new Date(`${to}T00:00:00.000Z`).toISOString();
    const document = {
      id, version: 1, kind: 'monthly', product, currencyCode: currency,
      period: { from, to }, generatedAt,
      openingBalanceCents: 1000, totalCreditsCents: 500, totalDebitsCents: 200,
      closingBalanceCents: 1300, transactionCount: 2,
    };
    const contentHash = require('../services/creditStatementService').hashDocument(document);
    document.contentHash = contentHash;
    await pool.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to,
          generated_at, document, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, customerId, product, accountId, currency, from, to, generatedAt,
        JSON.stringify(document), contentHash],
    );
    return id;
  }

  async function insertSettlementDocument({ product, scopeHelperUserId, from, to }) {
    const id = crypto.randomUUID();
    const document = {
      id, version: 1, kind: 'monthly', product,
      helperId: scopeHelperUserId, ownerName: 'Stmt Fixture', accountLabel: 'Helper earnings',
      currencyCode: 'USD', period: { from, to }, generatedAt: '2026-10-01T00:00:00.000Z',
      openingPayableCents: 0, postedEarningsCents: 1000, settledPayoutsCents: 0,
      statusRemovalsCents: 0, closingPayableCents: 1000, movements: [],
    };
    document.contentHash = require('../services/creditStatementService').hashDocument(document);
    await pool.query(
      `INSERT INTO settlement_statement_documents
         (id, product, scope_helper_user_id, currency_code, period_from, period_to, generated_at, document, content_hash)
       VALUES ($1, 'helper_earnings', $2, 'USD', $3, $4, NOW(), $5, $6)`,
      [id, scopeHelperUserId, from, to, JSON.stringify(document), document.contentHash],
    );
    return id;
  }

  async function insertSnapshot({ product, accountId, currency, from, to, customerId }) {
    const id = crypto.randomUUID();
    const issuanceKey = `stmt:v1:${product}:${accountId}:${currency}:${from}:${to}:${customerId}`;
    await pool.query(
      `INSERT INTO statement_snapshots
         (id, issuance_key, product, account_id, currency_code, period_from, period_to,
          cutoff_at, row_count, total_credits_minor, total_debits_minor,
          opening_minor, closing_minor, source_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, transaction_timestamp(), 0, 0, 0, 0, 0, $8, transaction_timestamp())`,
      [id, issuanceKey, product, accountId, currency, from, to, sha256Hex(issuanceKey)],
    );
    return id;
  }

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const getAs = (user, path) => request(app).get(path).set('Authorization', `Bearer ${tokenFor(user)}`);

  // 701: the finance home is scoped server-side to the caller.
  test('701: center shows only the caller’s own accounts and latest period', async () => {
    const resA = await getAs(userA, '/api/statements/center').expect(200);
    const oxA = resA.body.products.oxsteedCredit;
    expect(oxA.hasAccount).toBe(true);
    expect(oxA.setupState).toBe('ready');
    expect(oxA.latestPeriod).toBe('2026-07');
    const scopeAccountIds = oxA.scopes.map((scope) => String(scope.accountId));
    expect(scopeAccountIds).toContain(String(walletA));
    expect(scopeAccountIds).not.toContain(String(walletB));
    expect(oxA.scopes[0].latestDocumentId).toBe(docAJuly);

    const resB = await getAs(userB, '/api/statements/center').expect(200);
    const oxB = resB.body.products.oxsteedCredit;
    const scopeAccountIdsB = oxB.scopes.map((scope) => String(scope.accountId));
    expect(scopeAccountIdsB).toContain(String(walletB));
    expect(scopeAccountIdsB).not.toContain(String(walletA));

    await request(app).get('/api/statements/center').expect(401);
  });

  // 702: the account is the org boundary — archive scopes + accountId filter.
  test('702: archive scopes list only the caller’s account; accountId filter cannot reach another user', async () => {
    const scopesA = await getAs(userA, '/api/statement-archive/scopes?product=helper_earnings').expect(200);
    expect(scopesA.body.accounts).toHaveLength(1);
    expect(String(scopesA.body.accounts[0].accountId)).toBe(userA.id);

    const listA = await getAs(userA, '/api/statement-archive/archive?product=helper_earnings').expect(200);
    const idsA = listA.body.items.map((item) => item.id);
    expect(idsA).toContain(helperDocA);
    expect(idsA).not.toContain(helperDocB);

    const filtered = await getAs(userA, `/api/statement-archive/archive?product=helper_earnings&accountId=${userB.id}`).expect(200);
    expect(filtered.body.total).toBe(0);
    expect(filtered.body.items).toHaveLength(0);

    const listB = await getAs(userB, '/api/statement-archive/archive?product=helper_earnings').expect(200);
    expect(listB.body.items.map((item) => item.id)).toEqual([helperDocB]);
  });

  // 703: period filters on the archive, with bad input rejected.
  test('703: archive year/month filter narrows to the period; bad periods are rejected', async () => {
    const july = await getAs(userA, '/api/statement-archive/archive?product=helper_earnings&year=2026&month=7').expect(200);
    expect(july.body.items.map((item) => item.id)).toEqual([helperDocA]);

    const june = await getAs(userA, '/api/statement-archive/archive?product=helper_earnings&year=2026&month=6').expect(200);
    expect(june.body.total).toBe(0);

    for (const bad of ['year=1999&month=7', 'year=2026&month=13', 'year=abcd&month=7', 'year=2026&month=0']) {
      const res = await getAs(userA, `/api/statement-archive/archive?product=helper_earnings&${bad}`).expect(400);
      expect(res.body.code).toBe('statement_archive_invalid_period');
    }
  });

  // 704: the archive serves ready artifacts; download re-authorizes per call.
  test('704: archive lists own originals; owner downloads the ready bytes, a stranger gets 404', async () => {
    const list = await getAs(userA, '/api/statement-archive/archive').expect(200);
    const ids = list.body.items.map((item) => item.id);
    expect(ids).toContain(docAJuly);
    expect(ids).not.toContain(docBJuly);
    expect(ids).not.toContain(docCJuly);

    const download = await getAs(userA, `/api/statement-archive/archive/${docAJuly}/download`).expect(200);
    expect(download.headers['content-disposition']).toMatch(/attachment;/);
    expect(await consumeToBuffer(download)).toEqual(originalPdfA);

    await getAs(userB, `/api/statement-archive/archive/${docAJuly}/download`).expect(404);
    await request(app).get(`/api/statement-archive/archive/${docAJuly}/download`).expect(401);
  });

  test('704: signed link is short-lived, carries an expiry, and is owner-only', async () => {
    const link = await getAs(userC, `/api/statement-archive/archive/${docCJuly}/link`).expect(200);
    expect(typeof link.body.url).toBe('string');
    expect(link.body.url).toContain('exp=');
    expect(link.body.ttlSeconds).toBeGreaterThanOrEqual(60);
    expect(link.body.ttlSeconds).toBeLessThanOrEqual(3600);
    expect(new Date(link.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(link.body.note).toMatch(/must not be stored or shared/);

    await getAs(userB, `/api/statement-archive/archive/${docCJuly}/link`).expect(404);
  });

  // 705: unified search — text query and amount query, owner-scoped.
  test('705: text search finds the caller’s load and not the other user’s', async () => {
    const resA = await getAs(userA, '/api/statements/search?q=G14A%20slice%20verification%20load').expect(200);
    expect(resA.body.total).toBeGreaterThanOrEqual(1);
    const ox = resA.body.groups.find((group) => group.product === 'oxsteed');
    expect(ox.results.length).toBeGreaterThanOrEqual(1);
    expect(ox.results[0].description).toMatch(/G14A slice verification load/);
    expect(ox.results[0].creditCents).toBe(5000);

    const resB = await getAs(userB, '/api/statements/search?q=G14A%20slice%20verification%20load').expect(200);
    expect(resB.body.total).toBe(0);
  });

  test('705: amount search matches the $50.00 load by formatted amount, owner-scoped', async () => {
    const resA = await getAs(userA, '/api/statements/search?q=%2450.00').expect(200);
    const ox = resA.body.groups.find((group) => group.product === 'oxsteed');
    expect(ox.results.some((row) => row.creditCents === 5000)).toBe(true);

    const resB = await getAs(userB, '/api/statements/search?q=%2450.00').expect(200);
    expect(resB.body.total).toBe(0);
  });
});
