'use strict';

// G-8 remainder: the DELEGATED_STATEMENT_READ (statements.view) override
// wired to the credit statement archive (server/routes/statementArchive.js).
// The settlement archive already honors the override (see
// statementSelfService.db.test.js); this suite proves the credit archive's
// restaurant leg: a non-manager member holding a live, unexpired override
// for a business can list, read and download that business's restaurant
// wallet statements, read-only and scoped to the delegation, while an
// expired override, a revoked override, a revoked membership, or no
// override at all reads nothing. Manager and owner paths are unchanged.
//
// Runs ONLY against the disposable localhost credit_statement_test
// database: real tables, real rows, real JWT authentication, a fake storage
// adapter implementing the storage.js interface. No pg mocks.

jest.unmock('pg');

const DISPOSABLE_URL = (() => {
  const raw = process.env.STATEMENT_TEST_DATABASE_URL
    || 'postgresql://postgres:postgres@127.0.0.1:5432/credit_statement_test?sslmode=disable';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Requires a disposable localhost credit_statement_test database');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.pathname !== '/credit_statement_test'
      || [...url.searchParams].some(([key, value]) => key !== 'sslmode' || value !== 'disable')) {
    throw new Error('Requires a disposable localhost credit_statement_test database; connection overrides are forbidden');
  }
  return raw;
})();

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DATABASE_URL = DISPOSABLE_URL;
process.env.JWT_SECRET = 'test-jwt-secret-for-statement-archive-delegated-read';
process.env.STATEMENT_ARTIFACT_BUCKET = 'statement-test-bucket';
process.env.STATEMENT_ARTIFACT_PREFIX = 'test-statements-delegated';

jest.setTimeout(120000);

const crypto = require('crypto');
const { Readable } = require('stream');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const artifacts = require('../services/statementArtifactService');
const { hashDocument } = require('../services/creditStatementService');
const createStatementArchiveRouter = require('../routes/statementArchive');

const runId = crypto.randomUUID();

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
      const exp = Math.floor(Date.now() / 1000) + Math.max(1, Number(expiresIn) || 300);
      return `https://signed.invalid/${key}?ttl=${expiresIn}&exp=${exp}&sig=fake`;
    },
  };
}

function fakePdf(payload) {
  return Buffer.from(`%PDF-1.7\n% delegated archive fixture ${payload} ${runId}\n`, 'utf8');
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function consumeToBuffer(response) {
  if (Buffer.isBuffer(response.body) && response.body.length) return response.body;
  if (typeof response.text === 'string' && response.text.length) return Buffer.from(response.text, 'binary');
  return Buffer.alloc(0);
}

async function createUser(role = 'customer') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, didit_verified_at, didit_status)
     VALUES ($1, $2, 'synthetic-unusable-hash', 'Delegated', 'Fixture', $3, TRUE, TRUE, NOW(), 'verified')`,
    [id, `${id}@example.invalid`, role]);
  return id;
}

function bearer(userId) {
  return `Bearer ${jwt.sign({ id: userId, role: 'customer', typ: 'access', sid: 'test-session' }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;
}

async function createBusiness(ownerId) {
  const { rows: [row] } = await pool.query(
    "INSERT INTO businesses(user_id,business_name,created_at) VALUES ($1,'Delegated statement entity','2026-01-01') RETURNING id",
    [ownerId]);
  return Number(row.id);
}

async function addMember(businessId, ownerId, memberId, role) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO business_members(business_id,owner_id,member_id,role,invite_email,status,accepted_at)
     VALUES ($1,$2,$3,$4,$5,'active',now()) RETURNING id`,
    [businessId, ownerId, memberId, role, `${memberId}@example.invalid`]);
  return Number(row.id);
}

async function createRestaurant(businessId, ownerId) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO food_restaurants(business_id,owner_user_id,display_name,currency_code,status)
     VALUES ($1,$2,'Delegated statement restaurant','USD','active') RETURNING id`,
    [businessId, ownerId]);
  return Number(row.id);
}

async function createWalletAccount(restaurantId, customerId) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO food_customer_wallet_accounts(restaurant_id,customer_id,currency_code)
     VALUES ($1,$2,'USD') RETURNING id`,
    [restaurantId, customerId]);
  return Number(row.id);
}

async function grantStatementOverride(membershipId, grantedBy) {
  await pool.query(
    `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect, granted_by_user_id, expires_at)
     SELECT $1, id, 'allow', $2, NULL FROM team_permissions WHERE code = 'statements.view'
     ON CONFLICT (membership_id, permission_id) DO UPDATE SET effect = 'allow', expires_at = NULL`,
    [membershipId, grantedBy]);
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
    [id, issuanceKey, product, accountId, currency, from, to, sha256Hex(issuanceKey)]);
  return id;
}

async function insertDocument({ customerId, product, accountId, currency = 'USD', from = '2026-07-01', to = '2026-07-31' }) {
  const id = crypto.randomUUID();
  const generatedAt = new Date(`${to}T00:00:00.000Z`).toISOString();
  const document = {
    id, version: 1, kind: 'monthly', product, currencyCode: currency,
    period: { from, to }, generatedAt,
    openingBalanceCents: 1000, totalCreditsCents: 500, totalDebitsCents: 200,
    closingBalanceCents: 1300, transactionCount: 2,
  };
  const contentHash = hashDocument(document);
  document.contentHash = contentHash;
  await pool.query(
    `INSERT INTO credit_statement_documents
       (id, customer_id, product, account_id, currency_code, period_from, period_to,
        generated_at, document, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, customerId, product, accountId, currency, from, to, generatedAt,
      JSON.stringify(document), contentHash]);
  return id;
}

// A published amendment version of a credit original, with a ready artifact.
async function insertVersion({ originalId, snapshotId, proposerId, approverId, storage }) {
  const proposalId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const { rows: [original] } = await pool.query(
    'SELECT account_id FROM credit_statement_documents WHERE id = $1', [originalId]);
  await pool.query(
    `INSERT INTO statement_amendment_proposals(id,issuance_key,product,account_id,currency_code,period_from,period_to,
        document_id,reason,status,proposed_by,decided_by,decided_at)
     VALUES ($1,$2,'restaurant',$3,'USD','2026-07-01','2026-07-31',$4,'Delegated fixture correction','approved',$5,$6,now())`,
    [proposalId, `delegated:${proposalId}`, original.account_id, originalId, proposerId, approverId]);
  const document = {
    id: versionId, version: 2, kind: 'monthly', product: 'restaurant', currencyCode: 'USD',
    period: { from: '2026-07-01', to: '2026-07-31' }, generatedAt: '2026-08-01T00:00:00.000Z',
    openingBalanceCents: 1000, totalCreditsCents: 500, totalDebitsCents: 200,
    closingBalanceCents: 1300, transactionCount: 2,
    amendment: { reason: 'Delegated fixture correction', decidedBy: approverId },
  };
  document.contentHash = hashDocument(document);
  const artifact = await artifacts.publishRendition({
    snapshotId, language: 'en', label: 'amended-v1',
    pdfBytes: fakePdf(`amended-${versionId}`), storage,
  });
  expect(artifact.state).toBe('ready');
  await pool.query(
    `INSERT INTO statement_amendment_versions(id,original_document_id,proposal_id,revision_number,amendment_type,presentation,
        document,content_hash,artifact_id,supersedes_version_id,prior_version_closing_minor,revised_closing_minor,continuity_status)
     VALUES ($1,$2,$3,1,'clerical','restated',$4,$5,$6,NULL,1300,1300,'continuous')`,
    [versionId, originalId, proposalId, JSON.stringify(document), document.contentHash, artifact.id]);
  return versionId;
}

let app;
let storage;
let owner;
let walletCustomer;
let accountant;
let accountantMembershipId;
let staff;
let manager;
let stranger;
let otherOwner;
let otherWalletCustomer;
let businessId;
let restaurantId;
let walletAccountId;
let restaurantDocId;
let oxsteedDocId;
let otherRestaurantDocId;
let versionId;
let restaurantPdf;

beforeAll(async () => {
  storage = makeFakeStorage();
  app = express();
  app.use('/api/statement-archive', createStatementArchiveRouter({ storage }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || err.statusCode || 500)
    .json({ error: err.message, code: err.code || 'internal_error' }));

  owner = await createUser();
  walletCustomer = await createUser();
  accountant = await createUser();
  staff = await createUser();
  manager = await createUser();
  stranger = await createUser();
  otherOwner = await createUser();
  otherWalletCustomer = await createUser();

  businessId = await createBusiness(owner);
  restaurantId = await createRestaurant(businessId, owner);
  walletAccountId = await createWalletAccount(restaurantId, walletCustomer);
  accountantMembershipId = await addMember(businessId, owner, accountant, 'employee');
  await addMember(businessId, owner, staff, 'employee');
  await addMember(businessId, owner, manager, 'manager');
  await grantStatementOverride(accountantMembershipId, owner);

  restaurantDocId = await insertDocument({
    customerId: walletCustomer, product: 'restaurant', accountId: walletAccountId,
  });
  // The override is business-scoped: the same customer's personal OxSteed
  // Credit statement must stay closed to the auditor.
  const oxsteedAccount = (await pool.query(
    `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, created_at)
     VALUES ('customer_wallet', $1, 'USD', transaction_timestamp()) RETURNING id`,
    [walletCustomer])).rows[0].id;
  oxsteedDocId = await insertDocument({
    customerId: walletCustomer, product: 'oxsteed', accountId: Number(oxsteedAccount),
  });

  const otherBusinessId = await createBusiness(otherOwner);
  const otherRestaurantId = await createRestaurant(otherBusinessId, otherOwner);
  const otherWalletAccountId = await createWalletAccount(otherRestaurantId, otherWalletCustomer);
  otherRestaurantDocId = await insertDocument({
    customerId: otherWalletCustomer, product: 'restaurant', accountId: otherWalletAccountId,
  });

  // For restaurant products the snapshot issuance key carries the restaurant
  // id (resolveDocumentId maps it back to the wallet account); the document
  // itself keys on the wallet account id.
  const snapshotId = await insertSnapshot({
    product: 'restaurant', accountId: restaurantId, currency: 'USD',
    from: '2026-07-01', to: '2026-07-31', customerId: walletCustomer,
  });
  restaurantPdf = fakePdf('original-restaurant-july');
  const original = await artifacts.publishOriginal({
    snapshotId, language: 'en', pdfBytes: restaurantPdf, storage,
  });
  expect(original.state).toBe('ready');

  versionId = await insertVersion({
    originalId: restaurantDocId, snapshotId, proposerId: owner, approverId: owner, storage,
  });
}, 120000);

afterAll(async () => {
  // No fixture cleanup: issued documents are immutable by design and every
  // fixture uses a fresh UUID per run.
  await pool.end();
});

describe('G-8 delegated statement archive read', () => {
  test('a live override lists, reads and downloads the restaurant statement, read-only', async () => {
    const auth = { Authorization: bearer(accountant) };
    const list = await request(app).get('/api/statement-archive/archive?product=restaurant').set(auth).expect(200);
    const item = list.body.items.find((entry) => entry.id === restaurantDocId);
    expect(item).toBeDefined();
    expect(item.readOnly).toBe(true);
    expect(list.body.items.map((entry) => entry.id)).not.toContain(otherRestaurantDocId);
    expect(list.body.items.map((entry) => entry.id)).not.toContain(oxsteedDocId);

    const detail = await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`).set(auth).expect(200);
    expect(detail.body.document.id).toBe(restaurantDocId);
    expect(detail.body.document.readOnly).toBe(true);
    expect(detail.body.document.totals.closingMinor).toBe(1300);

    const download = await request(app).get(`/api/statement-archive/archive/${restaurantDocId}/download`).set(auth).expect(200);
    expect(sha256Hex(await consumeToBuffer(download))).toBe(sha256Hex(restaurantPdf));

    // A delegated reader may read but never mint a saved link: the link
    // would outlive the grant.
    await request(app).get(`/api/statement-archive/archive/${restaurantDocId}/link`).set(auth).expect(404);

    // Amendment versions inherit the same delegated read.
    const version = await request(app).get(`/api/statement-archive/archive/${versionId}`).set(auth).expect(200);
    expect(version.body.document.kind).toBe('amendment');
    expect(version.body.document.readOnly).toBe(true);
  });

  test('the override opens nothing outside its business, and no personal statements', async () => {
    const auth = { Authorization: bearer(accountant) };
    await request(app).get(`/api/statement-archive/archive/${otherRestaurantDocId}`).set(auth).expect(404);
    await request(app).get(`/api/statement-archive/archive/${otherRestaurantDocId}/download`).set(auth).expect(404);
    await request(app).get(`/api/statement-archive/archive/${oxsteedDocId}`).set(auth).expect(404);
    await request(app).get(`/api/statement-archive/archive/${oxsteedDocId}/download`).set(auth).expect(404);
    const list = await request(app).get('/api/statement-archive/archive').set(auth).expect(200);
    expect(list.body.items.map((entry) => entry.id)).not.toContain(oxsteedDocId);
    expect(list.body.items.map((entry) => entry.id)).not.toContain(otherRestaurantDocId);
  });

  test('staff without an override and strangers read nothing', async () => {
    for (const actor of [staff, stranger]) {
      const auth = { Authorization: bearer(actor) };
      await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`).set(auth).expect(404);
      await request(app).get(`/api/statement-archive/archive/${restaurantDocId}/download`).set(auth).expect(404);
      const list = await request(app).get('/api/statement-archive/archive?product=restaurant').set(auth).expect(200);
      expect(list.body.items.map((entry) => entry.id)).not.toContain(restaurantDocId);
    }
  });

  test('manager and owner paths are unchanged', async () => {
    // The finance manager reads the restaurant statement by id (existing
    // manager path) and is not flagged read-only.
    const managerDetail = await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`)
      .set('Authorization', bearer(manager)).expect(200);
    expect(managerDetail.body.document.readOnly).toBe(false);
    // The wallet customer still owns their own archive rows.
    const ownerList = await request(app).get('/api/statement-archive/archive?product=restaurant')
      .set('Authorization', bearer(walletCustomer)).expect(200);
    const owned = ownerList.body.items.find((entry) => entry.id === restaurantDocId);
    expect(owned).toBeDefined();
    expect(owned.readOnly).toBe(false);
    const ownerDetail = await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`)
      .set('Authorization', bearer(walletCustomer)).expect(200);
    expect(ownerDetail.body.document.readOnly).toBe(false);
    // The business owner reads it by id through restaurant standing.
    const businessOwnerDetail = await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`)
      .set('Authorization', bearer(owner)).expect(200);
    expect(businessOwnerDetail.body.document.readOnly).toBe(false);
  });

  test('an expired override closes the archive, and a fresh grant reopens it', async () => {
    const auth = { Authorization: bearer(accountant) };
    await pool.query(
      "UPDATE membership_permission_overrides SET expires_at = NOW() - INTERVAL '1 minute' WHERE membership_id = $1",
      [accountantMembershipId]);
    await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`).set(auth).expect(404);
    await request(app).get(`/api/statement-archive/archive/${restaurantDocId}/download`).set(auth).expect(404);
    await request(app).get(`/api/statement-archive/archive/${versionId}`).set(auth).expect(404);
    const list = await request(app).get('/api/statement-archive/archive?product=restaurant').set(auth).expect(200);
    expect(list.body.items.map((entry) => entry.id)).not.toContain(restaurantDocId);

    await pool.query(
      'UPDATE membership_permission_overrides SET expires_at = NULL WHERE membership_id = $1',
      [accountantMembershipId]);
    await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`).set(auth).expect(200);
  });

  test('a revoked override and a revoked membership both close the archive', async () => {
    const auth = { Authorization: bearer(accountant) };
    await pool.query('DELETE FROM membership_permission_overrides WHERE membership_id = $1',
      [accountantMembershipId]);
    await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`).set(auth).expect(404);
    await request(app).get(`/api/statement-archive/archive/${restaurantDocId}/download`).set(auth).expect(404);

    await grantStatementOverride(accountantMembershipId, owner);
    await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`).set(auth).expect(200);

    await pool.query("UPDATE business_members SET status = 'revoked' WHERE id = $1",
      [accountantMembershipId]);
    await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`).set(auth).expect(404);
    await request(app).get(`/api/statement-archive/archive/${versionId}`).set(auth).expect(404);
    await pool.query("UPDATE business_members SET status = 'active' WHERE id = $1",
      [accountantMembershipId]);
    await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`).set(auth).expect(200);
  });

  test('a location-scoped member with an override reads no restaurant-wide statement (G-19)', async () => {
    // Creating the restaurant already provisioned its primary location
    // (restaurant_default_store_created trigger); reuse it.
    const { rows: [location] } = await pool.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY is_primary DESC, id ASC LIMIT 1`,
      [restaurantId]);
    expect(location).toBeDefined();
    await pool.query(
      `INSERT INTO restaurant_location_memberships(restaurant_id,location_id,membership_id,status)
       VALUES ($1,$2,$3,'active')`,
      [restaurantId, location.id, accountantMembershipId]);
    try {
      const auth = { Authorization: bearer(accountant) };
      await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`).set(auth).expect(404);
      await request(app).get(`/api/statement-archive/archive/${restaurantDocId}/download`).set(auth).expect(404);
      const list = await request(app).get('/api/statement-archive/archive?product=restaurant').set(auth).expect(200);
      expect(list.body.items.map((entry) => entry.id)).not.toContain(restaurantDocId);
    } finally {
      await pool.query('DELETE FROM restaurant_location_memberships WHERE membership_id = $1',
        [accountantMembershipId]);
    }
    await request(app).get(`/api/statement-archive/archive/${restaurantDocId}`)
      .set('Authorization', bearer(accountant)).expect(200);
  });
});
