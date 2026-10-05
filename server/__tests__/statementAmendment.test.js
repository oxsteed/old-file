'use strict';

/**
 * Behavior tests for statement amendments (Phase 4, workstream 3):
 * proposal creation, maker-checker approval, immutable version publication,
 * continuity enforcement, safe retries, and archive visibility.
 *
 * These tests run ONLY against the disposable localhost credit_statement_test
 * database (same guard family as statementIssuance.test.js). They exercise
 * real DB behavior — immutability triggers, unique constraints, the ledger
 * re-derivation, artifact publication — with no source-text assertions.
 * Without the disposable DB the DB describes skip (fail closed) instead of
 * touching a real database.
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
    console.log('statementAmendment DB tests skipped: set STATEMENT_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'amendment-test-secret';
  process.env.STATEMENT_ARTIFACT_BUCKET = 'statement-test-bucket';
  process.env.STATEMENT_ARTIFACT_PREFIX = 'test-statements';
  process.env.LOCAL_UPLOAD_DIR = '/tmp/amend-test-uploads';
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const jobs = require('../services/statementJobService');
const issuance = require('../services/statementIssuanceService');
const amendments = require('../services/statementAmendmentService');
const statements = require('../services/creditStatementService');
const tokenRevocationService = require('../services/tokenRevocationService');
const statementAdmin = require('../routes/statementAdmin');
const createStatementArchiveRouter = require('../routes/statementArchive');

jest.setTimeout(180000);

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

function makeFailingStorage() {
  const good = makeFakeStorage();
  return {
    ...good,
    async uploadFile() {
      throw new Error('simulated storage outage');
    },
  };
}

// --- fixtures ---------------------------------------------------------------
async function createUser(role = 'customer') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled, didit_status)
     VALUES ($1, $2, 'synthetic-unusable-hash', 'Amend', 'Fixture', $3, TRUE, TRUE, TRUE, 'verified')`,
    [id, `${id}@example.invalid`, role]);
  return id;
}

async function createWallet(customerId, createdAt = '2025-01-01T00:00:00.000Z') {
  const { rows: [row] } = await pool.query(
    `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, status, created_at)
     VALUES ('customer_wallet', $1, 'USD', 'active', $2)
     RETURNING id`,
    [customerId, createdAt]);
  return Number(row.id);
}

async function newCustomerWithWallet() {
  const customerId = await createUser('customer');
  const walletId = await createWallet(customerId);
  return { customerId, walletId };
}

async function treasuryId() {
  const { rows: [row] } = await pool.query(
    `INSERT INTO oxsteed_credit_accounts (account_type, currency_code, created_at)
     VALUES ('platform_treasury', 'USD', '2025-01-01T00:00:00.000Z')
     ON CONFLICT DO NOTHING RETURNING id`);
  if (row) return Number(row.id);
  const { rows: [existing] } = await pool.query(
    `SELECT id FROM oxsteed_credit_accounts WHERE account_type = 'platform_treasury' AND currency_code = 'USD' LIMIT 1`);
  return Number(existing.id);
}

// Posts one ledger transaction. effectiveDate drives the statement period
// inclusion (COALESCE(posted_at, created_at)); entries are appended in
// chronological effective order so the balance_after chain stays valid.
async function postTx({ debit, credit, amount, type, effectiveDate, actorId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: balances } = await client.query(
      'SELECT * FROM oxsteed_credit_accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [[debit, credit]]);
    const debitAccount = balances.find((value) => String(value.id) === String(debit));
    const creditAccount = balances.find((value) => String(value.id) === String(credit));
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO oxsteed_credit_transactions
        (id, transaction_type, status, debit_account_id, credit_account_id, amount_cents, currency_code,
         idempotency_key, reference_id, description, reason, actor_type, actor_user_id, posted_at, created_at)
       VALUES ($1,$2,'posted',$3,$4,$5,'USD',$6,$9,'Synthetic amendment fixture',
         'Local synthetic fixture only','admin',$7,$8,$8)`,
      [id, type, debit, credit, amount, `${id}-amend`, actorId, effectiveDate, id]);
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
        [id, source.id, side, amount, String(balance), String(sequence), source.last_entry_hash, entryHash, effectiveDate]);
      await client.query(
        `UPDATE oxsteed_credit_accounts SET balance_cents=$2, ledger_version=$3, last_entry_hash=$4, last_posted_at=$5
         WHERE id=$1`,
        [source.id, String(balance), String(sequence), entryHash, effectiveDate]);
    }
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function issueMonthlyStatement(customerId, walletId, from, to, storage) {
  const run = await jobs.createRun({ product: 'oxsteed', periodFrom: from, periodTo: to });
  await jobs.discoverAccountJobs(run.id, [{
    customerId, product: 'oxsteed', accountId: walletId, currencyCode: 'USD',
  }]);
  const job = await jobs.claimNextAccountJob('amend-test-worker');
  if (!job) throw new Error('no claimable issuance job');
  return issuance.issueAccountStatement({ job, workerId: 'amend-test-worker', storage });
}

async function documentIdFor(customerId, walletId, from, to) {
  const { rows: [row] } = await pool.query(
    `SELECT id FROM credit_statement_documents
     WHERE customer_id = $1 AND product = 'oxsteed' AND account_id = $2
       AND currency_code = 'USD' AND period_from = $3 AND period_to = $4`,
    [customerId, walletId, from, to]);
  return row && row.id;
}

async function documentRow(documentId) {
  const { rows: [row] } = await pool.query(
    'SELECT * FROM credit_statement_documents WHERE id = $1', [documentId]);
  return row;
}

async function versionRowsFor(documentId) {
  const { rows } = await pool.query(
    `SELECT * FROM statement_amendment_versions WHERE original_document_id = $1 ORDER BY revision_number ASC`,
    [documentId]);
  return rows;
}

// Mirrors decideAmendment's decision update (minus audit) for service-level tests.
async function decideProposal(proposalId, approverId, decision, reason = 'verified against ledger') {
  const { rows: [row] } = await pool.query(
    `UPDATE statement_amendment_proposals
     SET status = $2, decided_by = $3, decision_reason = $4
     WHERE id = $1 RETURNING *`,
    [proposalId, decision, approverId, reason]);
  return row;
}

function equationHolds(core) {
  return BigInt(core.openingBalanceCents) + BigInt(core.totalCreditsCents) - BigInt(core.totalDebitsCents)
    === BigInt(core.closingBalanceCents);
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

function adminBearer(userId) {
  return `Bearer ${jwt.sign({ id: userId, role: 'admin' }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;
}

function customerBearer(userId) {
  return `Bearer ${jwt.sign({ id: userId, role: 'customer' }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;
}

function buildAdminApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/statements', statementAdmin);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.statusCode || err.status || 500).json({ code: err.code || 'internal_error', error: err.message });
  });
  return app;
}

function buildArchiveApp(storage) {
  const app = express();
  app.use(express.json());
  app.use('/api/statement-archive', createStatementArchiveRouter({ storage }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.statusCode || err.status || 500).json({ code: err.code || 'internal_error', error: err.message });
  });
  return app;
}

async function grantPermissions(granteeId, permissions, grantorId) {
  await pool.query(
    `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, expires_at)
     VALUES ($1, $2, $3::jsonb, NOW() + interval '1 day')`,
    [grantorId, granteeId, JSON.stringify(permissions)]);
}

const P = {
  retry: { from: '2026-02-01', to: '2026-02-28' },
  stale: { from: '2026-03-01', to: '2026-03-31' },
  concurrent: { from: '2026-04-01', to: '2026-04-30' },
  reject: { from: '2026-05-01', to: '2026-05-31' },
  clerical: { from: '2026-06-01', to: '2026-06-30' },
  acct: { from: '2026-07-01', to: '2026-07-31' },
  aug: { from: '2026-08-01', to: '2026-08-31' },
  sep: { from: '2026-09-01', to: '2026-09-30' },
};

ddescribe('statement amendments (workstream 3)', () => {
  let proposer;
  let approver;
  let approver2;
  let grantor;
  let treasury;

  beforeAll(async () => {
    tokenRevocationService.isRevoked.mockResolvedValue(false);
    for (const migration of [
      '682_credit_statement_documents.sql',
      '683_statement_issuance_jobs.sql',
      '684_statement_artifacts.sql',
      '686_statement_amendment_proposals.sql',
      '687_statement_amendment_versions.sql',
    ]) {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', migration), 'utf8');
      await pool.query(sql);
    }
    grantor = await createUser('super_admin');
    proposer = await createUser('admin');
    approver = await createUser('admin');
    approver2 = await createUser('admin');
    await grantPermissions(proposer, ['view_financials', 'manage_operations', 'manage_financials'], grantor);
    await grantPermissions(approver, ['view_financials', 'manage_financials'], grantor);
    await grantPermissions(approver2, ['view_financials', 'manage_financials'], grantor);
    treasury = await treasuryId();
  }, 120000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await drainClaimableJobs();
  });

  describe('amendment workflow', () => {
  test('clerical amendment end to end: proposal, approval, immutable version, exact balances', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 10000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await postTx({ debit: treasury, credit: walletId, amount: 2000, type: 'load', effectiveDate: '2026-06-15T12:00:00.000Z', actorId: approver });
    const issued = await issueMonthlyStatement(customerId, walletId, P.clerical.from, P.clerical.to, storage);
    const originalId = issued.documentId;
    const before = await documentRow(originalId);
    expect(before.document.closingBalanceCents).toBe(12000);

    const proposal = await amendments.proposeAmendment({
      adminId: proposer,
      documentId: originalId,
      amendmentType: 'clerical',
      reason: 'Correct the account label presentation on the June statement',
      evidenceRefs: ['ops-ticket-441'],
    });
    expect(proposal.amendmentType).toBe('clerical');
    expect(proposal.presentation).toBe('restated');
    expect(proposal.status).toBe('proposed');
    expect(proposal.baseRevisionNumber).toBe(0);
    expect(proposal.originalDocumentHash).toBe(before.content_hash);
    expect(proposal.ledgerFingerprint).toHaveLength(64);

    await decideProposal(proposal.proposalId, approver, 'approved', 'label verified against account record');
    const result = await amendments.finalizeApprovedProposal(proposal.proposalId, { storage });
    expect(result.status).toBe('published');
    expect(result.version.revisionNumber).toBe(1);
    expect(result.version.revision).toBe(2);
    expect(result.version.amendmentType).toBe('clerical');
    expect(result.version.continuityStatus).toBe('continuous');

    // Exactly one version row for the proposal.
    const versions = await versionRowsFor(originalId);
    expect(versions).toHaveLength(1);

    // The envelope is self-consistent and hash-verifiable.
    const envelope = versions[0].document;
    expect(statements.hashDocument(envelope)).toBe(versions[0].content_hash);
    expect(envelope.supersedes).toMatchObject({ kind: 'original', documentId: originalId });
    expect(envelope.amendment).toMatchObject({
      proposalId: proposal.proposalId, type: 'clerical', reason: proposal.reason,
    });
    // Exact balances + continuity equation on the version.
    for (const core of [envelope.totals.revised,
      { openingBalanceCents: envelope.openingBalanceCents, totalCreditsCents: envelope.totalCreditsCents, totalDebitsCents: envelope.totalDebitsCents, closingBalanceCents: envelope.closingBalanceCents }]) {
      const asCore = {
        openingBalanceCents: core.openingMinor !== undefined ? core.openingMinor : core.openingBalanceCents,
        totalCreditsCents: core.creditsMinor !== undefined ? core.creditsMinor : core.totalCreditsCents,
        totalDebitsCents: core.debitsMinor !== undefined ? core.debitsMinor : core.totalDebitsCents,
        closingBalanceCents: core.closingMinor !== undefined ? core.closingMinor : core.closingBalanceCents,
      };
      expect(equationHolds(asCore)).toBe(true);
    }
    expect(envelope.totals.original.closingMinor).toBe(12000);
    expect(envelope.totals.adjustment.netMinor).toBe(0);
    expect(envelope.totals.revised.closingMinor).toBe(12000);

    // The labeled rendition artifact is published and ready.
    const { rows: [artifact] } = await pool.query(
      'SELECT * FROM statement_artifacts WHERE id = $1', [versions[0].artifact_id]);
    expect(artifact.kind).toBe('rendition');
    expect(artifact.state).toBe('ready');
    expect(artifact.object_key).toMatch(/\/renditions\/amended-v1\//);

    // The issued original is untouched and still immutable.
    const after = await documentRow(originalId);
    expect(after.content_hash).toBe(before.content_hash);
    await expect(pool.query('UPDATE credit_statement_documents SET document = $2 WHERE id = $1',
      [originalId, JSON.stringify({ tampered: true })])).rejects.toThrow();
    await expect(pool.query('DELETE FROM credit_statement_documents WHERE id = $1', [originalId])).rejects.toThrow();

    // Published versions are immutable too.
    await expect(pool.query('UPDATE statement_amendment_versions SET continuity_status = $2 WHERE id = $1',
      [versions[0].id, 'continuous'])).rejects.toThrow();
    await expect(pool.query('DELETE FROM statement_amendment_versions WHERE id = $1', [versions[0].id])).rejects.toThrow();

    // The amendment moved no money: no new ledger transactions from finalization.
    const { rows: [{ n: txCount }] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM oxsteed_credit_transactions
       WHERE (debit_account_id = $1 OR credit_account_id = $1) AND description LIKE 'Synthetic amendment fixture%'`,
      [walletId]);
    expect(txCount).toBe(2);
  });

  test('accounting amendment (restated): correction posts through the ledger, totals reconcile exactly', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 10000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await postTx({ debit: treasury, credit: walletId, amount: 3000, type: 'load', effectiveDate: '2026-07-10T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.acct.from, P.acct.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.acct.from, P.acct.to);
    const before = await documentRow(originalId);
    expect(before.document.closingBalanceCents).toBe(13000);

    // The authoritative correction posts through the ledger (in-period).
    const correctionId = await postTx({
      debit: treasury, credit: walletId, amount: 500, type: 'adjustment',
      effectiveDate: '2026-07-20T12:00:00.000Z', actorId: approver,
    });

    const proposal = await amendments.proposeAmendment({
      adminId: proposer,
      documentId: originalId,
      amendmentType: 'accounting',
      presentation: 'restated',
      reason: 'Apply the approved July fee correction',
      evidenceRefs: ['adjustment-case-778'],
      compensatingTransactionRefs: [correctionId],
    });
    await decideProposal(proposal.proposalId, approver, 'approved');
    const result = await amendments.finalizeApprovedProposal(proposal.proposalId, { storage });
    expect(result.status).toBe('published');

    const versions = await versionRowsFor(originalId);
    expect(versions).toHaveLength(1);
    const envelope = versions[0].document;

    // Revised totals reconcile to the ledger exactly: original + the one correction.
    expect(envelope.totals.original.closingMinor).toBe(13000);
    expect(envelope.totals.adjustment.creditsMinor).toBe(500);
    expect(envelope.totals.adjustment.netMinor).toBe(500);
    expect(envelope.totals.revised.closingMinor).toBe(13500);
    expect(envelope.totals.revised.creditsMinor - envelope.totals.original.creditsMinor).toBe(500);
    expect(equationHolds({
      openingBalanceCents: envelope.totals.revised.openingMinor,
      totalCreditsCents: envelope.totals.revised.creditsMinor,
      totalDebitsCents: envelope.totals.revised.debitsMinor,
      closingBalanceCents: envelope.totals.revised.closingMinor,
    })).toBe(true);

    // No duplicated fees: the correction appears exactly once in the transactions.
    const occurrences = envelope.transactions.filter((row) => row.id === correctionId);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].creditCents).toBe(500);

    // Backdated correction is explicitly dated and disclosed.
    const ref = envelope.totals.adjustment.compensatingTransactions[0];
    expect(ref.id).toBe(correctionId);
    expect(ref.backdated).toBe(true);
    expect(ref.postedAt).toBeTruthy();
    expect(ref.affects).toBe('period');

    // Amended totals reconcile to a fresh ledger derivation (no invention).
    const fresh = await statements.getStatement(customerId, {
      product: 'oxsteed', currencyCode: 'USD', from: P.acct.from, to: P.acct.to, rederive: true,
    });
    expect(fresh.closingBalanceCents).toBe(envelope.totals.revised.closingMinor);
    expect(fresh.totalCreditsCents).toBe(envelope.totals.revised.creditsMinor);
  });

  test('ordered amendment chains: v2 builds on v1, each version immutable', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 10000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await postTx({ debit: treasury, credit: walletId, amount: 3000, type: 'load', effectiveDate: '2026-07-10T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.acct.from, P.acct.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.acct.from, P.acct.to);

    const correctionId = await postTx({
      debit: treasury, credit: walletId, amount: 500, type: 'adjustment',
      effectiveDate: '2026-07-20T12:00:00.000Z', actorId: approver,
    });
    const p1 = await amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'accounting',
      reason: 'July fee correction', compensatingTransactionRefs: [correctionId],
    });
    await decideProposal(p1.proposalId, approver, 'approved');
    const r1 = await amendments.finalizeApprovedProposal(p1.proposalId, { storage });
    expect(r1.version.revisionNumber).toBe(1);

    // v2 is clerical: the ledger did not move since v1, so the baseline is v1.
    const p2 = await amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'clerical',
      reason: 'Fix a label on the corrected July statement',
    });
    expect(p2.baseRevisionNumber).toBe(1);
    await decideProposal(p2.proposalId, approver2, 'approved');
    const r2 = await amendments.finalizeApprovedProposal(p2.proposalId, { storage });
    expect(r2.version.revisionNumber).toBe(2);
    expect(r2.version.revision).toBe(3);
    expect(r2.version.supersedesVersionId).toBe(r1.version.versionId);

    const versions = await versionRowsFor(originalId);
    expect(versions.map((v) => Number(v.revision_number))).toEqual([1, 2]);
    const v2envelope = versions[1].document;
    expect(v2envelope.supersedes).toMatchObject({ kind: 'amendment', versionId: r1.version.versionId, revision: 2 });
    // v2's "original" totals are v1's revised totals: the chain composes.
    expect(v2envelope.totals.original.closingMinor).toBe(13500);
    expect(v2envelope.totals.revised.closingMinor).toBe(13500);
    expect(equationHolds({
      openingBalanceCents: v2envelope.totals.revised.openingMinor,
      totalCreditsCents: v2envelope.totals.revised.creditsMinor,
      totalDebitsCents: v2envelope.totals.revised.debitsMinor,
      closingBalanceCents: v2envelope.totals.revised.closingMinor,
    })).toBe(true);
  });

  test('continuity: a later issued month blocks the amendment until restated forward', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 10000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await postTx({ debit: treasury, credit: walletId, amount: 1000, type: 'load', effectiveDate: '2026-08-10T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.aug.from, P.aug.to, storage);
    const augId = await documentIdFor(customerId, walletId, P.aug.from, P.aug.to);
    await issueMonthlyStatement(customerId, walletId, P.sep.from, P.sep.to, storage);
    const sepId = await documentIdFor(customerId, walletId, P.sep.from, P.sep.to);
    const sepBefore = await documentRow(sepId);
    expect(sepBefore.document.openingBalanceCents).toBe(11000);

    // Backdated August correction posted after both months were issued.
    const correctionId = await postTx({
      debit: treasury, credit: walletId, amount: 700, type: 'adjustment',
      effectiveDate: '2026-08-25T12:00:00.000Z', actorId: approver,
    });

    const p1 = await amendments.proposeAmendment({
      adminId: proposer, documentId: augId, amendmentType: 'accounting',
      reason: 'August fee correction', compensatingTransactionRefs: [correctionId],
    });
    await decideProposal(p1.proposalId, approver, 'approved');
    const blocked = await amendments.finalizeApprovedProposal(p1.proposalId, { storage })
      .then(() => { throw new Error('expected continuity block'); })
      .catch((error) => error);
    expect(blocked.code).toBe('statement_amendment_continuity_blocked');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.fields.nextPeriodDocumentId).toBe(sepId);
    expect(blocked.fields.revisedClosingMinor).toBe(11700);
    expect(blocked.fields.nextPeriodEffectiveOpeningMinor).toBe(11000);

    // The blocked proposal published nothing and stays approved.
    expect(await versionRowsFor(augId)).toHaveLength(0);
    const { rows: [stillApproved] } = await pool.query(
      'SELECT status FROM statement_amendment_proposals WHERE id = $1', [p1.proposalId]);
    expect(stillApproved.status).toBe('approved');
    const { rows: [attempt] } = await pool.query(
      `SELECT outcome FROM statement_amendment_publication_attempts WHERE proposal_id = $1 ORDER BY attempt DESC LIMIT 1`,
      [p1.proposalId]);
    expect(attempt.outcome).toBe('blocked');

    // The September original was never silently changed.
    const sepAfter = await documentRow(sepId);
    expect(sepAfter.content_hash).toBe(sepBefore.content_hash);
    expect(sepAfter.document.openingBalanceCents).toBe(11000);

    // Re-proposing with restate-forward discloses the break and publishes.
    const p2 = await amendments.proposeAmendment({
      adminId: proposer, documentId: augId, amendmentType: 'accounting',
      reason: 'August fee correction, restated forward', compensatingTransactionRefs: [correctionId],
      restateForward: true,
    });
    await decideProposal(p2.proposalId, approver2, 'approved');
    const r2 = await amendments.finalizeApprovedProposal(p2.proposalId, { storage });
    expect(r2.status).toBe('published');
    expect(r2.version.continuityStatus).toBe('restated_forward');
    expect(r2.version.nextPeriodDocumentId).toBe(sepId);

    const versions = await versionRowsFor(augId);
    expect(versions).toHaveLength(1);
    const envelope = versions[0].document;
    expect(envelope.continuity.status).toBe('restated_forward');
    expect(envelope.continuity.nextPeriodDocumentId).toBe(sepId);
    expect(envelope.continuity.restatedOpeningMinor).toBe(11700);
    expect(envelope.continuity.disclosures).toContain('statement.amendment.continuity.restated_forward');
  });
});

  describe('safety cases', () => {

  test('rejected proposals never publish and stay readable with the reason', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 5000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await postTx({ debit: treasury, credit: walletId, amount: 1400, type: 'load', effectiveDate: '2026-05-10T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.reject.from, P.reject.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.reject.from, P.reject.to);

    const proposal = await amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'clerical',
      reason: 'Proposed in error',
    });
    await decideProposal(proposal.proposalId, approver, 'rejected', 'No correction needed');

    expect(await versionRowsFor(originalId)).toHaveLength(0);
    const { rows: [row] } = await pool.query(
      'SELECT status, decision_reason FROM statement_amendment_proposals WHERE id = $1',
      [proposal.proposalId]);
    expect(row.status).toBe('rejected');
    expect(row.decision_reason).toBe('No correction needed');

    // A rejected proposal can never be published via the retry path either.
    await expect(amendments.retryPublication(proposal.proposalId, { storage }))
      .rejects.toMatchObject({ code: 'statement_amendment_not_approved' });
    expect(await versionRowsFor(originalId)).toHaveLength(0);

    // Rejection frees the document for a fresh proposal.
    const fresh = await amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'clerical',
      reason: 'Real correction this time',
    });
    expect(fresh.status).toBe('proposed');
  });

  test('concurrent proposals for the same document conflict with a clear error', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 5000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await postTx({ debit: treasury, credit: walletId, amount: 1300, type: 'load', effectiveDate: '2026-04-10T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.concurrent.from, P.concurrent.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.concurrent.from, P.concurrent.to);

    const first = await amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'clerical',
      reason: 'First proposal',
    });
    const conflict = await amendments.proposeAmendment({
      adminId: approver2, documentId: originalId, amendmentType: 'clerical',
      reason: 'Second proposal',
    }).then(() => { throw new Error('expected concurrent conflict'); }).catch((error) => error);
    expect(conflict.code).toBe('statement_amendment_concurrent_proposal');
    expect(conflict.statusCode).toBe(409);

    // Once the first is decided, a new proposal may proceed.
    await decideProposal(first.proposalId, approver, 'rejected', 'superseded by review');
    const second = await amendments.proposeAmendment({
      adminId: approver2, documentId: originalId, amendmentType: 'clerical',
      reason: 'Second proposal after rejection',
    });
    expect(second.status).toBe('proposed');
  });

  test('changed source data between proposal and approval blocks with 409', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 5000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await postTx({ debit: treasury, credit: walletId, amount: 1200, type: 'load', effectiveDate: '2026-03-10T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.stale.from, P.stale.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.stale.from, P.stale.to);

    const correctionId = await postTx({
      debit: treasury, credit: walletId, amount: 250, type: 'adjustment',
      effectiveDate: '2026-03-20T12:00:00.000Z', actorId: approver,
    });
    const proposal = await amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'accounting',
      reason: 'March correction', compensatingTransactionRefs: [correctionId],
    });

    // Another in-period correction lands after the proposal: the approval is stale.
    await postTx({
      debit: treasury, credit: walletId, amount: 100, type: 'adjustment',
      effectiveDate: '2026-03-25T12:00:00.000Z', actorId: approver,
    });
    await decideProposal(proposal.proposalId, approver, 'approved');
    const stale = await amendments.finalizeApprovedProposal(proposal.proposalId, { storage })
      .then(() => { throw new Error('expected source-changed block'); })
      .catch((error) => error);
    expect(stale.code).toBe('statement_amendment_source_changed');
    expect(stale.statusCode).toBe(409);
    expect(await versionRowsFor(originalId)).toHaveLength(0);
  });

  test('proposal validation: refs must exist, be posted, and match the scope', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    const { walletId: otherWallet } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 5000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.retry.from, P.retry.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.retry.from, P.retry.to);

    // Unknown transaction id.
    await expect(amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'accounting',
      reason: 'x', compensatingTransactionRefs: [crypto.randomUUID()],
    })).rejects.toMatchObject({ code: 'statement_amendment_transaction_not_found' });

    // Accounting without refs.
    await expect(amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'accounting', reason: 'x',
    })).rejects.toMatchObject({ code: 'statement_amendment_refs_required' });

    // Clerical with refs.
    const txId = await postTx({
      debit: treasury, credit: walletId, amount: 50, type: 'adjustment',
      effectiveDate: '2026-02-15T12:00:00.000Z', actorId: approver,
    });
    await expect(amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'clerical',
      reason: 'x', compensatingTransactionRefs: [txId],
    })).rejects.toMatchObject({ code: 'statement_amendment_refs_forbidden' });

    // A transaction on another account is out of scope.
    const foreignTx = await postTx({
      debit: treasury, credit: otherWallet, amount: 50, type: 'adjustment',
      effectiveDate: '2026-02-16T12:00:00.000Z', actorId: approver,
    });
    await expect(amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'accounting',
      reason: 'x', compensatingTransactionRefs: [foreignTx],
    })).rejects.toMatchObject({ code: 'statement_amendment_transaction_scope_mismatch' });

    // Missing reason.
    await expect(amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'clerical', reason: '  ',
    })).rejects.toMatchObject({ code: 'statement_admin_reason_required' });

    // Unknown document.
    await expect(amendments.proposeAmendment({
      adminId: proposer, documentId: crypto.randomUUID(), amendmentType: 'clerical', reason: 'x',
    })).rejects.toMatchObject({ code: 'statement_amendment_document_not_found' });
  });

  test('storage failure after approval: approved-but-unpublished, safe retry publishes exactly once', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 5000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await postTx({ debit: treasury, credit: walletId, amount: 1100, type: 'load', effectiveDate: '2026-02-10T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.retry.from, P.retry.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.retry.from, P.retry.to);

    const proposal = await amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'clerical',
      reason: 'Label correction',
    });
    await decideProposal(proposal.proposalId, approver, 'approved');

    // Storage fails during publication: the proposal stays approved, nothing published.
    const failed = await amendments.finalizeApprovedProposal(proposal.proposalId, { storage: makeFailingStorage() })
      .then(() => { throw new Error('expected storage failure'); })
      .catch((error) => error);
    expect(failed.statusCode).toBe(502);
    expect(await versionRowsFor(originalId)).toHaveLength(0);
    const { rows: [stillApproved] } = await pool.query(
      'SELECT status FROM statement_amendment_proposals WHERE id = $1', [proposal.proposalId]);
    expect(stillApproved.status).toBe('approved');
    const { rows: [failedAttempt] } = await pool.query(
      `SELECT outcome FROM statement_amendment_publication_attempts WHERE proposal_id = $1 ORDER BY attempt DESC LIMIT 1`,
      [proposal.proposalId]);
    expect(failedAttempt.outcome).toBe('failed');

    // The retry path publishes, and is idempotent: exactly one version row.
    const retried = await amendments.retryPublication(proposal.proposalId, { storage });
    expect(retried.status).toBe('published');
    const again = await amendments.retryPublication(proposal.proposalId, { storage });
    expect(again.status).toBe('published');
    expect(again.duplicate).toBe(true);
    expect(again.version.versionId).toBe(retried.version.versionId);
    const versions = await versionRowsFor(originalId);
    expect(versions).toHaveLength(1);

    // The concurrent-proposal guard sees the published version, not a conflict.
    const { rows: [{ n: attempts }] } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM statement_amendment_publication_attempts WHERE proposal_id = $1',
      [proposal.proposalId]);
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  test('double counting guard: a compensating transaction is referenced once per statement', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 5000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await postTx({ debit: treasury, credit: walletId, amount: 1100, type: 'load', effectiveDate: '2026-02-10T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.retry.from, P.retry.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.retry.from, P.retry.to);

    const correctionId = await postTx({
      debit: treasury, credit: walletId, amount: 300, type: 'adjustment',
      effectiveDate: '2026-02-15T12:00:00.000Z', actorId: approver,
    });
    const first = await amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'accounting',
      reason: 'First correction', compensatingTransactionRefs: [correctionId],
    });
    await expect(amendments.proposeAmendment({
      adminId: approver2, documentId: originalId, amendmentType: 'accounting',
      reason: 'Duplicate correction', compensatingTransactionRefs: [correctionId],
    })).rejects.toMatchObject({ code: 'statement_amendment_concurrent_proposal' });

    // After the first publishes, the reference stays spent.
    await decideProposal(first.proposalId, approver, 'approved');
    await amendments.finalizeApprovedProposal(first.proposalId, { storage });
    await expect(amendments.proposeAmendment({
      adminId: approver2, documentId: originalId, amendmentType: 'accounting',
      reason: 'Duplicate correction after publish', compensatingTransactionRefs: [correctionId],
    })).rejects.toMatchObject({ code: 'statement_amendment_duplicate_reference' });
  });
});

  describe('routes and archive', () => {

  test('POST /ops/amendments validates and creates proposals (201/400/403/409)', async () => {
    const storage = makeFakeStorage();
    const app = buildAdminApp();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 5000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.clerical.from, P.clerical.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.clerical.from, P.clerical.to);

    // manage_operations can propose.
    const created = await request(app)
      .post('/api/admin/statements/ops/amendments')
      .set('Authorization', adminBearer(proposer))
      .send({ documentId: originalId, amendmentType: 'clerical', reason: 'Fix a label', evidenceRefs: ['ticket-1'] })
      .expect(201);
    expect(created.body.proposal.proposalId).toBeTruthy();
    expect(created.body.proposal.amendmentType).toBe('clerical');
    expect(created.body.proposal.status).toBe('proposed');

    // A second live proposal conflicts.
    const conflict = await request(app)
      .post('/api/admin/statements/ops/amendments')
      .set('Authorization', adminBearer(proposer))
      .send({ documentId: originalId, amendmentType: 'clerical', reason: 'Another' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('statement_amendment_concurrent_proposal');

    // Missing reason.
    const noReason = await request(app)
      .post('/api/admin/statements/ops/amendments')
      .set('Authorization', adminBearer(proposer))
      .send({ documentId: originalId, amendmentType: 'clerical', reason: '' });
    expect(noReason.status).toBe(400);

    // Unknown document.
    const noDoc = await request(app)
      .post('/api/admin/statements/ops/amendments')
      .set('Authorization', adminBearer(proposer))
      .send({ documentId: crypto.randomUUID(), amendmentType: 'clerical', reason: 'x' });
    expect(noDoc.status).toBe(404);

    // An admin without manage_operations cannot propose.
    const denied = await request(app)
      .post('/api/admin/statements/ops/amendments')
      .set('Authorization', adminBearer(approver))
      .send({ documentId: originalId, amendmentType: 'clerical', reason: 'x' });
    expect(denied.status).toBe(403);
  });

  test('approve via the route finalizes publication; self-approval stays rejected', async () => {
    const storage = makeFakeStorage();
    // Inject private storage in this synthetic route fixture. Production has
    // no general uploads/local fallback for amendment publication.
    const privateStorage = require('../utils/statementStorage');
    const storageSpies = ['uploadFile', 'getObjectStream', 'getSignedDownloadUrl'].map(method =>
      jest.spyOn(privateStorage, method).mockImplementation(storage[method]));
    storageSpies.push(jest.spyOn(privateStorage, 'configuration').mockReturnValue({ bucket: 'statement-test-bucket' }));
    const app = buildAdminApp();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 5000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.reject.from, P.reject.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.reject.from, P.reject.to);

    const created = await request(app)
      .post('/api/admin/statements/ops/amendments')
      .set('Authorization', adminBearer(proposer))
      .send({ documentId: originalId, amendmentType: 'clerical', reason: 'Route-level correction' })
      .expect(201);
    const proposalId = created.body.proposal.proposalId;

    // Self-approval is rejected (maker-checker).
    const self = await request(app)
      .post(`/api/admin/statements/ops/amendments/${proposalId}/approve`)
      .set('Authorization', adminBearer(proposer))
      .send({ reason: 'approving my own' });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('statement_amendment_self_approval');

    // Independent approval publishes through the real finalize path.
    const approved = await request(app)
      .post(`/api/admin/statements/ops/amendments/${proposalId}/approve`)
      .set('Authorization', adminBearer(approver))
      .send({ reason: 'verified' })
      .expect(200);
    expect(approved.body.proposal.status).toBe('approved');
    expect(approved.body.publication.status).toBe('published');
    expect(approved.body.publication.version.revisionNumber).toBe(1);
    expect(await versionRowsFor(originalId)).toHaveLength(1);
    storageSpies.forEach(spy => spy.mockRestore());

    // A second decision is rejected.
    const again = await request(app)
      .post(`/api/admin/statements/ops/amendments/${proposalId}/approve`)
      .set('Authorization', adminBearer(approver))
      .send({ reason: 'duplicate' });
    expect(again.status).toBe(409);
  });

  test('archive shows the original and the amended version side by side, with permissions', async () => {
    const storage = makeFakeStorage();
    const archiveApp = buildArchiveApp(storage);
    const { customerId, walletId } = await newCustomerWithWallet();
    const strangerId = await createUser('customer');
    await postTx({ debit: treasury, credit: walletId, amount: 5000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await postTx({ debit: treasury, credit: walletId, amount: 2000, type: 'load', effectiveDate: '2026-06-15T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.clerical.from, P.clerical.to, storage);
    const originalId = await documentIdFor(customerId, walletId, P.clerical.from, P.clerical.to);

    const proposal = await amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'clerical',
      reason: 'Archive visibility correction',
    });
    await decideProposal(proposal.proposalId, approver, 'approved');
    const published = await amendments.finalizeApprovedProposal(proposal.proposalId, { storage });
    const versionId = published.version.versionId;

    const list = await request(archiveApp)
      .get('/api/statement-archive/archive')
      .set('Authorization', customerBearer(customerId))
      .expect(200);
    const originalItem = list.body.items.find((item) => item.id === originalId);
    const versionItem = originalItem.versions.find((item) => item.id === versionId);
    expect(list.body.paginationUnit).toBe('originals');
    expect(list.body.items.every(item => item.kind === 'original')).toBe(true);
    expect(originalItem).toBeTruthy();
    expect(originalItem.kind).toBe('original');
    expect(originalItem.superseded).toBe(true);
    expect(originalItem.supersession.latestVersionId).toBe(versionId);
    expect(originalItem.supersession.latestRevision).toBe(2);
    expect(originalItem.supersession.reason).toBe('Archive visibility correction');
    expect(versionItem).toBeTruthy();
    expect(versionItem.kind).toBe('amendment');
    expect(versionItem.revision).toBe(2);
    expect(versionItem.amendment.originalDocumentId).toBe(originalId);
    expect(versionItem.amendment.totals.revised.closingMinor).toBe(7000);
    expect(versionItem.downloadStatus).toBe('available');

    // The amended file downloads for the owner with an amended filename.
    const download = await request(archiveApp)
      .get(`/api/statement-archive/archive/${versionId}/download`)
      .set('Authorization', customerBearer(customerId))
      .expect(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain('amended-v1');
    expect(Number(download.headers['content-length'])).toBeGreaterThan(0);

    // The original still downloads for the owner.
    await request(archiveApp)
      .get(`/api/statement-archive/archive/${originalId}/download`)
      .set('Authorization', customerBearer(customerId))
      .expect(200);

    // Another customer sees neither.
    await request(archiveApp)
      .get(`/api/statement-archive/archive/${versionId}`)
      .set('Authorization', customerBearer(strangerId))
      .expect(404);
    await request(archiveApp)
      .get(`/api/statement-archive/archive/${versionId}/download`)
      .set('Authorization', customerBearer(strangerId))
      .expect(404);
    const strangerList = await request(archiveApp)
      .get('/api/statement-archive/archive')
      .set('Authorization', customerBearer(strangerId))
      .expect(200);
    expect(strangerList.body.items.find((item) => item.id === versionId)).toBeUndefined();
  });

  test('owner is notified exactly once after publication', async () => {
    const storage = makeFakeStorage();
    const { customerId, walletId } = await newCustomerWithWallet();
    await postTx({ debit: treasury, credit: walletId, amount: 5000, type: 'load', effectiveDate: '2026-01-20T12:00:00.000Z', actorId: approver });
    await issueMonthlyStatement(customerId, walletId, P.stale.from, P.stale.to, storage);
    // Drain the statement.ready event first so the amended drain is isolated.
    await issuance.processStatementReadyOutbox({ workerId: 'amend-notif-test' });
    const originalId = await documentIdFor(customerId, walletId, P.stale.from, P.stale.to);

    const proposal = await amendments.proposeAmendment({
      adminId: proposer, documentId: originalId, amendmentType: 'clerical',
      reason: 'Notification test correction',
    });
    await decideProposal(proposal.proposalId, approver, 'approved');
    const published = await amendments.finalizeApprovedProposal(proposal.proposalId, { storage });

    // The ready drain does not swallow the amended event (cooperative release).
    const readyDrain = await issuance.processStatementReadyOutbox({ workerId: 'amend-notif-test' });
    expect(readyDrain.processed).toBe(0);
    const { rows: [{ n: pending }] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM statement_outbox
       WHERE event_type = 'statement.amended' AND processed_at IS NULL`);
    expect(pending).toBeGreaterThanOrEqual(1);

    const drained = await amendments.processStatementAmendedOutbox({ workerId: 'amend-notif-test' });
    expect(drained.processed).toBeGreaterThanOrEqual(1);
    const { rows: notifications } = await pool.query(
      `SELECT type, title, body, data FROM notifications
       WHERE user_id = $1 AND type = 'statement_amended'
       ORDER BY created_at DESC`,
      [customerId]);
    expect(notifications.length).toBe(1);
    expect(notifications[0].title).toBeTruthy();
    expect(notifications[0].body).toBeTruthy();
    // No amounts, balances or digits in the user-visible text.
    expect(notifications[0].title).not.toMatch(/\d/);
    expect(notifications[0].body).not.toMatch(/\d/);
    const dataText = JSON.stringify(notifications[0].data).toLowerCase();
    expect(dataText).not.toMatch(/amount|balance|cents/);
    expect(notifications[0].data.statementVersionId).toBe(published.version.versionId);

    // A second drain notifies no one again.
    const redrained = await amendments.processStatementAmendedOutbox({ workerId: 'amend-notif-test' });
    expect(redrained.processed).toBe(0);
    const { rows: [{ n: total }] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'statement_amended'`,
      [customerId]);
    expect(total).toBe(1);
  });

  test('notification strings exist in all five locales without digits', async () => {
    const { tNotif } = require('../utils/i18n');
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      const { title, body } = tNotif('statement_amended', lang);
      expect(title).toBeTruthy();
      expect(body).toBeTruthy();
      expect(title).not.toMatch(/\d/);
      expect(body).not.toMatch(/\d/);
    }
  });
});
});
