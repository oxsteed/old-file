'use strict';

// Behavior tests for the Phase 2B statement snapshot/chunk model and the
// private artifact publication workflow. These tests run ONLY against the
// disposable localhost credit_statement_test database (the same guard as
// scripts/credit-statement-rehearsal.js): real tables, real ledger fixtures,
// no pg mocks and no source-text searches.

jest.unmock('pg');

const DISPOSABLE_PATTERN = (() => {
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
process.env.DATABASE_URL = DISPOSABLE_PATTERN;
process.env.STATEMENT_ARTIFACT_BUCKET = 'statement-test-bucket';
process.env.STATEMENT_ARTIFACT_PREFIX = 'test-statements';

jest.setTimeout(120000);

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const pool = require('../db');
const snapshots = require('../services/statementSnapshotService');
const artifacts = require('../services/statementArtifactService');

const PERIOD = { from: '2026-08-01', to: '2026-08-31' };
const BEFORE = '2026-07-15T12:00:00.000Z';
const DURING = '2026-08-15T12:00:00.000Z';
const runId = crypto.randomUUID();

// --- in-memory fake implementing the storage.js interface ------------------
function makeFakeStorage(behavior = {}) {
  const objects = new Map();
  const calls = [];
  return {
    objects,
    calls,
    async uploadFile(key, buffer, contentType) {
      calls.push(['uploadFile', key]);
      if (behavior.uploadThrows === 'uncertain') {
        // Stores the bytes (as a real flaky network might) then reports a
        // timeout with unknown outcome.
        objects.set(key, { buffer: Buffer.from(buffer), contentType });
        const error = new Error('socket hang up');
        error.code = 'ECONNRESET';
        throw error;
      }
      if (behavior.uploadThrows === 'definite') throw new Error('provider rejected the upload');
      objects.set(key, { buffer: Buffer.from(buffer), contentType });
      return key;
    },
    async getObjectStream(key) {
      calls.push(['getObjectStream', key]);
      const stored = objects.get(key);
      if (!stored) return null;
      const buffer = behavior.corruptOnRead
        ? Buffer.from(stored.buffer).fill(0x41, 0, Math.min(16, stored.buffer.length))
        : stored.buffer;
      return Readable.from([buffer]);
    },
    async deleteFile(key) {
      calls.push(['deleteFile', key]);
      objects.delete(key);
    },
    async getSignedDownloadUrl(key, expiresIn) {
      calls.push(['getSignedDownloadUrl', key, expiresIn]);
      return `https://signed.invalid/${key}?ttl=${expiresIn}`;
    },
  };
}

async function createUser(role = 'customer') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'synthetic-unusable-hash', 'Snapshot', 'Fixture', $3, TRUE, TRUE)`,
    [id, `${id}@example.invalid`, role]);
  return id;
}

async function createAccount(type, customerId, currency = 'USD') {
  const { rows } = await pool.query(
    `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [type, customerId, currency, BEFORE]);
  if (rows[0]) return Number(rows[0].id);
  const { rows: [existing] } = await pool.query(
    `SELECT id FROM oxsteed_credit_accounts
     WHERE account_type = $1 AND currency_code = $2
       AND (customer_id = $3 OR ($3 IS NULL AND customer_id IS NULL))
     LIMIT 1`,
    [type, currency, customerId]);
  return Number(existing.id);
}

async function postMovement({ debit, credit, amount, type, date, actorId, actorType = 'admin' }) {
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
       VALUES ($1,$2,'posted',$3,$4,$5,'USD',$6,$9,'Synthetic snapshot fixture',
         'Local synthetic fixture only',$10,$7,$8,$8)`,
      [id, type, debit, credit, amount, `${runId}:${id}`, actorId, date, id, actorType]);
    await client.query("SELECT set_config('oxsteed.credit_ledger_transaction_id', $1, TRUE)", [id]);
    for (const [source, side, sign] of [[debitAccount, 'debit', -1n], [creditAccount, 'credit', 1n]]) {
      const balance = BigInt(source.balance_cents) + sign * BigInt(amount);
      const sequence = BigInt(source.ledger_version) + 1n;
      const entryHash = crypto.createHash('sha256').update(`${runId}:${id}:${source.id}`).digest('hex');
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

function fakePdf(payload = 'statement') {
  return Buffer.from(`%PDF-1.7\n% synthetic ${payload} ${runId}\n`, 'utf8');
}

async function consume(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

let owner;
let walletId;
let issuanceKey;

beforeAll(async () => {
  // Migration 684 must apply cleanly (idempotent re-apply on an already
  // migrated disposable DB; the runbook applies the full chain on a fresh DB).
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '684_statement_artifacts.sql'), 'utf8');
  await pool.query(sql);
  for (const table of ['statement_snapshots', 'statement_snapshot_chunks', 'statement_artifacts', 'statement_publication_attempts']) {
    const { rows } = await pool.query('SELECT to_regclass($1) AS name', [`public.${table}`]);
    expect(rows[0].name).toBe(table);
  }

  owner = await createUser();
  const admin = await createUser('super_admin');
  walletId = await createAccount('customer_wallet', owner);
  const treasury = await createAccount('platform_treasury', null);
  const revenue = await createAccount('platform_revenue', null);
  await postMovement({ debit: treasury, credit: walletId, amount: 6000, type: 'load', date: BEFORE, actorId: admin });
  await postMovement({ debit: treasury, credit: walletId, amount: 2000, type: 'load', date: DURING, actorId: admin });
  await postMovement({ debit: walletId, credit: revenue, amount: 1000, type: 'transfer_fee', date: DURING,
    actorId: owner, actorType: 'customer' });
  await postMovement({ debit: treasury, credit: walletId, amount: 250, type: 'load', date: DURING, actorId: admin });

  issuanceKey = `stmt:v1:oxsteed:${walletId}:USD:${PERIOD.from}:${PERIOD.to}:${owner}`;
}, 120000);

afterAll(async () => {
  await pool.end();
});

describe('snapshot freeze and verify', () => {
  test('freeze + verify round-trip with exact totals and chunk boundaries', async () => {
    const snapshot = await snapshots.freezeSnapshot({
      issuanceKey, product: 'oxsteed', accountId: walletId, currency: 'USD',
      periodFrom: PERIOD.from, periodTo: PERIOD.to, customerId: owner, chunkSize: 2,
    });
    expect(snapshot.issuanceKey).toBe(issuanceKey);
    expect(snapshot.rowCount).toBe(3);
    expect(snapshot.openingMinor).toBe('6000');
    expect(snapshot.totalCreditsMinor).toBe('2250');
    expect(snapshot.totalDebitsMinor).toBe('1000');
    expect(snapshot.closingMinor).toBe('7250');
    expect(snapshot.chunkCount).toBe(2);
    expect(snapshot.chunks).toHaveLength(2);
    expect(snapshot.chunks[0].rowCount).toBe(2);
    expect(snapshot.chunks[1].rowCount).toBe(1);
    // Chunk boundaries are continuous keyset cursors; the final chunk is open.
    expect(snapshot.chunks[0].cursorTo).toBe(snapshot.chunks[1].cursorFrom);
    expect(snapshot.chunks[1].cursorTo).toBeNull();
    for (const chunk of snapshot.chunks) {
      expect(chunk.cursorFrom).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|.+$/);
    }
    expect(snapshot.sourceHash).toMatch(/^[a-f0-9]{64}$/);

    const verification = await snapshots.verifySnapshot(snapshot.id);
    expect(verification.ok).toBe(true);
    expect(verification.details.checks.every((check) => check.ok)).toBe(true);
  }, 60000);

  test('verifySnapshot catches a tampered chunk', async () => {
    const snapshot = await snapshots.getSnapshot(issuanceKey);
    expect(snapshot).not.toBeNull();
    await pool.query(
      `UPDATE statement_snapshot_chunks SET credits_minor = credits_minor + 1
       WHERE snapshot_id = $1 AND chunk_index = 0`, [snapshot.id]);
    try {
      const verification = await snapshots.verifySnapshot(snapshot.id);
      expect(verification.ok).toBe(false);
      const failing = verification.details.checks.filter((check) => !check.ok);
      expect(failing.length).toBeGreaterThan(0);
      expect(failing.some((check) => check.name.includes('chunk credits sum'))).toBe(true);
    } finally {
      await pool.query(
        `UPDATE statement_snapshot_chunks SET credits_minor = credits_minor - 1
         WHERE snapshot_id = $1 AND chunk_index = 0`, [snapshot.id]);
    }
    expect((await snapshots.verifySnapshot(snapshot.id)).ok).toBe(true);
  }, 60000);

  test('idempotent re-freeze returns the same snapshot without duplicating', async () => {
    const first = await snapshots.getSnapshot(issuanceKey);
    const second = await snapshots.freezeSnapshot({
      issuanceKey, product: 'oxsteed', accountId: walletId, currency: 'USD',
      periodFrom: PERIOD.from, periodTo: PERIOD.to, customerId: owner, chunkSize: 2,
    });
    expect(second.id).toBe(first.id);
    expect(second.sourceHash).toBe(first.sourceHash);
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*) AS count FROM statement_snapshots WHERE issuance_key = $1', [issuanceKey]);
    expect(count).toBe('1');
    const { rows: [chunks] } = await pool.query(
      'SELECT COUNT(*) AS count FROM statement_snapshot_chunks WHERE snapshot_id = $1', [first.id]);
    expect(chunks.count).toBe('2');
  }, 60000);

  test('issuance key scope mismatch is rejected', async () => {
    const other = await createUser();
    await expect(snapshots.freezeSnapshot({
      issuanceKey, product: 'oxsteed', accountId: walletId, currency: 'USD',
      periodFrom: PERIOD.from, periodTo: PERIOD.to, customerId: other,
    })).rejects.toMatchObject({ code: 'statement_snapshot_scope_mismatch' });
    // A key naming another customer's wallet is rejected even when the caller
    // supplies a well-formed customer id.
    const otherWallet = await createAccount('customer_wallet', other);
    const crossKey = `stmt:v1:oxsteed:${otherWallet}:USD:${PERIOD.from}:${PERIOD.to}:${owner}`;
    await expect(snapshots.freezeSnapshot({
      issuanceKey: crossKey, product: 'oxsteed', accountId: otherWallet, currency: 'USD',
      periodFrom: PERIOD.from, periodTo: PERIOD.to, customerId: owner,
    })).rejects.toMatchObject({ code: 'statement_snapshot_scope_mismatch' });
  }, 60000);
});

describe('artifact publication workflow', () => {
  let snapshotId;

  beforeAll(async () => {
    snapshotId = (await snapshots.getSnapshot(issuanceKey)).id;
  });

  test('staged -> verifying -> ready with a verifying read-back', async () => {
    const storage = makeFakeStorage();
    const pdf = fakePdf('original');
    const artifact = await artifacts.publishOriginal({ snapshotId, language: 'en', pdfBytes: pdf, storage });
    expect(artifact.state).toBe('ready');
    expect(artifact.kind).toBe('original');
    expect(artifact.byteLength).toBe(pdf.length);
    expect(artifact.sha256).toBe(crypto.createHash('sha256').update(pdf).digest('hex'));
    expect(artifact.objectKey).toMatch(/^test-statements\/stmt\/[0-9a-f-]{36}\.pdf$/);
    expect(artifact.objectKey).not.toContain(owner);

    const { rows: attempts } = await pool.query(
      'SELECT outcome FROM statement_publication_attempts WHERE artifact_id = $1 ORDER BY attempt',
      [artifact.id]);
    expect(attempts.map((row) => row.outcome)).toEqual(['uploaded', 'verified']);
  }, 60000);

  test('uncertain upload outcome reconciles and adopts the existing object', async () => {
    const storage = makeFakeStorage({ uploadThrows: 'uncertain' });
    const pdf = fakePdf('uncertain');
    const artifact = await artifacts.publishRendition({
      snapshotId, language: 'fr', pdfBytes: pdf, label: 'uncertain-case', storage,
    });
    expect(artifact.state).toBe('ready');
    expect(artifact.objectKey).toContain('/renditions/uncertain-case/');
    const { rows: attempts } = await pool.query(
      'SELECT outcome FROM statement_publication_attempts WHERE artifact_id = $1 ORDER BY attempt',
      [artifact.id]);
    expect(attempts.map((row) => row.outcome)).toContain('uncertain');
    expect(attempts.map((row) => row.outcome)).toContain('adopted');
    // Adopted under the original attempt key: no re-upload happened.
    expect(storage.calls.filter(([name]) => name === 'uploadFile')).toHaveLength(1);
  }, 60000);

  test('failed verification never marks the artifact ready', async () => {
    const storage = makeFakeStorage({ corruptOnRead: true });
    const pdf = fakePdf('corrupt');
    await expect(artifacts.publishRendition({
      snapshotId, language: 'es', pdfBytes: pdf, label: 'corrupt-case', storage,
    })).rejects.toMatchObject({ code: 'statement_artifact_verification_failed' });
    const { rows: [row] } = await pool.query(
      `SELECT state FROM statement_artifacts
       WHERE snapshot_id = $1 AND kind = 'rendition' AND object_key LIKE '%/renditions/corrupt-case/%'`,
      [snapshotId]);
    expect(row.state).toBe('failed');
    const { rows: attempts } = await pool.query(
      'SELECT outcome FROM statement_publication_attempts WHERE artifact_id = $1 ORDER BY attempt',
      [(await pool.query(
        `SELECT id FROM statement_artifacts WHERE snapshot_id = $1 AND kind = 'rendition'
         AND object_key LIKE '%/renditions/corrupt-case/%'`, [snapshotId])).rows[0].id]);
    expect(attempts.map((a) => a.outcome)).toContain('verification_failed');
  }, 60000);

  test('byte-identical re-download: streamed hash equals recorded sha256', async () => {
    const storage = makeFakeStorage();
    const pdf = fakePdf('download');
    const artifact = await artifacts.publishRendition({
      snapshotId, language: 'ht', pdfBytes: pdf, label: 'download-case', storage,
    });
    expect(artifact.state).toBe('ready');
    const { stream, mediaType, byteLength, sha256 } = await artifacts.getDownloadStream({
      artifactId: artifact.id, actor: { id: owner }, storage,
    });
    expect(mediaType).toBe('application/pdf');
    expect(byteLength).toBe(pdf.length);
    const bytes = await consume(stream);
    expect(bytes.equals(pdf)).toBe(true);
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
  }, 60000);

  test('incomplete artifacts are never exposed for download', async () => {
    const { rows: [failed] } = await pool.query(
      `SELECT id FROM statement_artifacts WHERE snapshot_id = $1 AND kind = 'rendition'
       AND object_key LIKE '%/renditions/corrupt-case/%'`, [snapshotId]);
    await expect(artifacts.getDownloadStream({ artifactId: failed.id, actor: { id: owner }, storage: makeFakeStorage() }))
      .rejects.toMatchObject({ code: 'statement_artifact_not_ready' });
    await expect(artifacts.createSignedUrl({ artifactId: failed.id, actor: { id: owner }, storage: makeFakeStorage() }))
      .rejects.toMatchObject({ code: 'statement_artifact_not_ready' });
  }, 60000);

  test('signed URLs are short-lived and document their TTL', async () => {
    const storage = makeFakeStorage();
    const pdf = fakePdf('signed');
    const artifact = await artifacts.publishRendition({
      snapshotId, language: 'ar', pdfBytes: pdf, label: 'signed-case', storage,
    });
    const signed = await artifacts.createSignedUrl({ artifactId: artifact.id, actor: { id: owner }, storage, ttlSeconds: 300 });
    expect(signed.ttlSeconds).toBe(300);
    const expiresIn = (Date.parse(signed.expiresAt) - Date.now()) / 1000;
    expect(expiresIn).toBeGreaterThan(290);
    expect(expiresIn).toBeLessThanOrEqual(300);
    expect(typeof signed.url).toBe('string');
    expect(signed.url).not.toContain('public');
  }, 60000);

  test('storage without signed-URL support fails closed with a provider blocker', async () => {
    const storage = makeFakeStorage();
    delete storage.getSignedDownloadUrl;
    const { rows: [ready] } = await pool.query(
      `SELECT id FROM statement_artifacts WHERE snapshot_id = $1 AND kind = 'original' LIMIT 1`, [snapshotId]);
    await expect(artifacts.createSignedUrl({ artifactId: ready.id, actor: { id: owner }, storage }))
      .rejects.toMatchObject({ code: 'statement_signed_url_unavailable' });
  }, 60000);

  test('unconfigured artifact namespace fails closed with a provider-blocker error', async () => {
    const savedBucket = process.env.STATEMENT_ARTIFACT_BUCKET;
    delete process.env.STATEMENT_ARTIFACT_BUCKET;
    try {
      const { rows: [{ count: before }] } = await pool.query(
        "SELECT COUNT(*) AS count FROM statement_artifacts WHERE snapshot_id = $1 AND kind = 'original'", [snapshotId]);
      await expect(artifacts.publishOriginal({
        snapshotId, language: 'en', pdfBytes: fakePdf('blocked'), storage: makeFakeStorage(),
      })).rejects.toMatchObject({ code: 'statement_storage_unconfigured' });
      const { rows: [{ count: after }] } = await pool.query(
        "SELECT COUNT(*) AS count FROM statement_artifacts WHERE snapshot_id = $1 AND kind = 'original'", [snapshotId]);
      expect(after).toBe(before);
    } finally {
      process.env.STATEMENT_ARTIFACT_BUCKET = savedBucket;
    }
  }, 60000);
});
