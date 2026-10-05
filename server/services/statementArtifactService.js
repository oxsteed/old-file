'use strict';

// Phase 2B: private statement artifact publication.
// Recoverable staged -> verifying -> ready workflow shared by automatic
// issuance originals, archive originals and background export renditions.
//
// Safety rules enforced here:
// - Object keys are opaque (stmt/<uuid4>.pdf); no PII in keys, URLs or names.
// - Artifacts live only in the statement-only object namespace configured via
//   STATEMENT_ARTIFACT_BUCKET / STATEMENT_ARTIFACT_PREFIX. If that namespace is
//   unconfigured the workflow fails closed; it never falls back to the backup
//   bucket or any public path, and getPublicUrl is never used for statements.
// - An artifact is never marked ready on the upload attempt alone. The stored
//   object is read back and its byte length and SHA-256 are recomputed before
//   the ready transition; incomplete or unverifiable objects are never exposed.
// - On an uncertain upload outcome (timeout with unknown result) the workflow
//   reconciles object metadata (read back by key; adopts the object when size
//   and hash match) before any retry, and retries use a new attempt key.
// - Issued originals are append-only: translations and re-renders are separate
//   labeled renditions; an original is never overwritten.
// - Server-side authorization happens in the route layer; these functions take
//   an already-authorized actor record purely for audit logging.

const crypto = require('crypto');
const { Readable } = require('stream');
const pool = require('../db');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const defaultStorage = require('../utils/statementStorage');

const LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_PATTERN = /^[a-z0-9-]{1,40}$/;
const PDF_MEDIA_TYPE = 'application/pdf';
const MAX_UPLOAD_ATTEMPTS = 3;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
const MIN_SIGNED_URL_TTL_SECONDS = 60;
const MAX_SIGNED_URL_TTL_SECONDS = 3600;
const MAX_PDF_BYTES = 32 * 1024 * 1024;

const DEFAULT_VERSIONS = {
  rendererVersion: 'creditStatementPdf/1',
  templateVersion: 'statement-template/1',
  fontVersion: 'statement-fonts/1',
};

function versionsOrDefault(versions) {
  const merged = { ...DEFAULT_VERSIONS, ...(versions || {}) };
  for (const [name, value] of Object.entries(merged)) {
    if (typeof value !== 'string' || !/^[\w.+/:-]{1,40}$/.test(value)) {
      throw new AppError(`Invalid statement artifact ${name}`, 400, 'statement_artifact_invalid_version');
    }
  }
  return merged;
}

// Resolve the statement-only object namespace from runtime config only.
// Fails closed: no bucket configured, no publication. Never falls back to the
// backup bucket or any public path.
function resolveNamespace(storage) {
  const bucket = String(process.env.STATEMENT_ARTIFACT_BUCKET || '').trim();
  if (!bucket) {
    throw new AppError(
      'Statement artifact storage is not configured (STATEMENT_ARTIFACT_BUCKET)',
      503,
      'statement_storage_unconfigured',
    );
  }
  const prefix = String(process.env.STATEMENT_ARTIFACT_PREFIX || 'statements')
    .replace(/^\/+|\/+$/g, '');
  if (!prefix || prefix.includes('..')) {
    throw new AppError('Invalid statement artifact storage prefix', 500, 'statement_storage_unconfigured');
  }
  // The real adapter has its own dedicated R2 bucket and no local fallback.
  if (storage === defaultStorage) defaultStorage.configuration();
  return { bucket, prefix };
}

function attemptKey(baseKey, attempt) {
  return attempt <= 1 ? baseKey : `${baseKey}.attempt-${attempt}`;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function collectStream(stream, maxBytes) {
  const chunks = [];
  let total = 0;
  const timeout = setTimeout(() => stream.destroy(new AppError('Statement storage read timed out', 503, 'statement_storage_unavailable')), 30000);
  timeout.unref?.();
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) throw new AppError('Stored statement object exceeds the recorded length', 502, 'statement_artifact_verification_failed');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timeout);
    stream.destroy();
  }
}

// Read the stored object back and recompute byte length + SHA-256 from it.
// Returns { bytes, hash } or null when the object does not exist.
async function readBackObject(storage, key, expectedLength) {
  const stream = await storage.getObjectStream(key);
  if (!stream) return null;
  const readable = stream instanceof Readable ? stream : Readable.from(stream);
  const bytes = await collectStream(readable, expectedLength + 1024 * 1024);
  return { bytes, hash: sha256Hex(bytes) };
}

async function recordAttempt(client, artifactId, attempt, { outcome, verifiedBytes, verifiedHash, error }) {
  await client.query(
    `INSERT INTO statement_publication_attempts
      (id, artifact_id, attempt, outcome, verified_bytes, verified_hash, error, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, transaction_timestamp())`,
    [crypto.randomUUID(), artifactId, attempt, outcome || null,
      verifiedBytes == null ? null : String(verifiedBytes),
      verifiedHash || null, error ? String(error).slice(0, 2000) : null]);
}

async function setState(client, artifactId, state, objectKey, token) {
  const { rows: [row] } = await client.query(
    `UPDATE statement_artifacts SET state = $2, object_key = COALESCE($3, object_key)
     WHERE id = $1 AND publication_token = $4 AND state <> 'ready' RETURNING *`,
    [artifactId, state, objectKey || null, token]);
  if (!row) throw new AppError('Statement publication lease is stale', 409, 'statement_publication_stale');
  return row;
}

function shapeArtifact(row) {
  if (!row) return null;
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    documentId: row.document_id,
    settlementDocumentId: row.settlement_document_id || null,
    kind: row.kind,
    language: row.language,
    rendererVersion: row.renderer_version,
    templateVersion: row.template_version,
    fontVersion: row.font_version,
    byteLength: Number(row.byte_length),
    sha256: row.sha256,
    mediaType: row.media_type,
    objectKey: row.object_key,
    storageBucket: row.storage_bucket,
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// Best-effort link from a snapshot to the archived monthly original produced by
// the statement service (interim periods have no archived document). Settlement
// products resolve into settlement_statement_documents (migration 688); credit
// products into credit_statement_documents (migration 682). Scopes never mix.
async function resolveDocumentId(client, snapshot) {
  try {
    const parts = String(snapshot.issuance_key).split(':');
    if (parts.length !== 8) return null;
    const [, , product, accountIdText, currency, periodFrom, periodTo, customerId] = parts;
    if (['restaurant_settlement', 'helper_earnings', 'business'].includes(product)) {
      const scopeColumn = product === 'restaurant_settlement' ? 'scope_restaurant_id'
        : product === 'helper_earnings' ? 'scope_helper_user_id' : 'scope_business_id';
      const scopeValue = product === 'helper_earnings' ? accountIdText : Number(accountIdText);
      if (product !== 'helper_earnings' && !Number.isSafeInteger(scopeValue)) return null;
      const { rows: [document] } = await client.query(
        `SELECT id FROM settlement_statement_documents
         WHERE product = $1 AND ${scopeColumn} = $2
           AND currency_code = $3 AND period_from = $4 AND period_to = $5`,
        [product, scopeValue, currency, periodFrom, periodTo]);
      return document ? { settlementDocumentId: document.id } : null;
    }
    let walletAccountId = Number(accountIdText);
    if (product === 'restaurant') {
      const { rows: [wallet] } = await client.query(
        `SELECT id FROM food_customer_wallet_accounts
         WHERE customer_id = $1 AND restaurant_id = $2 AND currency_code = $3`,
        [customerId, Number(accountIdText), currency]);
      if (!wallet) return null;
      walletAccountId = Number(wallet.id);
    }
    const { rows: [document] } = await client.query(
      `SELECT id FROM credit_statement_documents
       WHERE customer_id = $1 AND product = $2 AND account_id = $3
         AND currency_code = $4 AND period_from = $5 AND period_to = $6`,
      [customerId, product, walletAccountId, currency, periodFrom, periodTo]);
    return document ? { documentId: document.id } : null;
  } catch {
    return null;
  }
}

function isUncertainUploadError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ECONNABORTED', 'EAI_AGAIN'].includes(code)) return true;
  return /timed?\s?out|timeout|socket hang up|connection reset|unknown result/i.test(String(error?.message || ''));
}

function validatePublishInput({ snapshotId, language, pdfBytes, label }) {
  if (!UUID_PATTERN.test(String(snapshotId || ''))) {
    throw new AppError('Invalid statement snapshot id', 400, 'statement_artifact_invalid_input');
  }
  if (!LANGUAGES.has(language)) {
    throw new AppError('Unsupported statement language', 400, 'statement_artifact_invalid_input');
  }
  if (!Buffer.isBuffer(pdfBytes) || pdfBytes.length === 0) {
    throw new AppError('Statement PDF bytes are required', 400, 'statement_artifact_invalid_input');
  }
  if (pdfBytes.length > MAX_PDF_BYTES) {
    throw new AppError('Statement PDF exceeds the maximum size', 409, 'statement_artifact_too_large');
  }
  if (pdfBytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new AppError('Statement artifact is not a PDF', 400, 'statement_artifact_invalid_input');
  }
  if (label !== undefined && !LABEL_PATTERN.test(String(label))) {
    throw new AppError('Invalid statement rendition label', 400, 'statement_artifact_invalid_input');
  }
}

async function publishArtifact({ kind, snapshotId, language, pdfBytes, label, storage = defaultStorage, versions, settlementDocumentId }) {
  validatePublishInput({ snapshotId, language, pdfBytes, label });
  if (settlementDocumentId !== undefined && settlementDocumentId !== null
      && !UUID_PATTERN.test(String(settlementDocumentId))) {
    throw new AppError('Invalid settlement statement document id', 400, 'statement_artifact_invalid_input');
  }
  const namespace = resolveNamespace(storage);
  const rendered = versionsOrDefault(versions);
  const hash = sha256Hex(pdfBytes);
  const byteLength = pdfBytes.length;
  const baseKey = kind === 'original'
    ? `${namespace.prefix}/stmt/${crypto.randomUUID()}.pdf`
    : `${namespace.prefix}/stmt/renditions/${label}/${crypto.randomUUID()}.pdf`;

  const client = await pool.connect();
  const identity = `${snapshotId}:${kind}:${language}:${label || ''}`;
  let locked = false;
  try {
    const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 692)) AS locked', [identity]);
    locked = lock.locked;
    if (!locked) throw new AppError('Statement publication is in progress', 409, 'statement_publication_busy');
    const { rows: [snapshot] } = await client.query('SELECT * FROM statement_snapshots WHERE id = $1', [snapshotId]);
    if (!snapshot) throw new AppError('Statement snapshot not found', 404, 'statement_snapshot_not_found');

    // Idempotent publish: an in-flight or completed artifact for the same
    // (snapshot, kind, language[, label]) is returned instead of duplicating.
    // Failed artifacts may be retried with a fresh row.
    const { rows: [existing] } = await client.query(
      `SELECT * FROM statement_artifacts
       WHERE snapshot_id = $1 AND kind = $2 AND language = $3 AND state <> 'failed'
         AND rendition_label = $4 AND (kind = 'original' OR storage_bucket IS NOT NULL)
       ORDER BY created_at DESC LIMIT 1`,
      [snapshotId, kind, language, label || '']);
    const token = crypto.randomUUID();
    if (existing) {
      assertStorageLocation(existing, storage);
      if (existing.state !== 'ready') {
        await client.query('UPDATE statement_artifacts SET publication_token = $2 WHERE id = $1 AND state <> \'ready\'', [existing.id, token]);
      }
      // A restarted worker adopts the original bytes, not a newly rendered PDF.
      const stored = await readBackObject(storage, existing.object_key, Number(existing.byte_length));
      if (stored && stored.bytes.length === Number(existing.byte_length) && stored.hash === existing.sha256) {
        if (existing.state === 'ready') return shapeArtifact(existing);
        await recordAttempt(client, existing.id, 1, { outcome: 'adopted', verifiedBytes: stored.bytes.length, verifiedHash: stored.hash });
        return shapeArtifact(await setState(client, existing.id, 'ready', null, token));
      }
      if (existing.state === 'ready') {
        throw new AppError('Issued statement original is missing or corrupt', 502, 'statement_artifact_verification_failed');
      }
      // Preserve failed-attempt evidence. The next row is still pre-issuance.
      await setState(client, existing.id, 'failed', null, token);
    }

    const documentLink = kind === 'original' ? await resolveDocumentId(client, snapshot) : null;
    const { rows: [artifact] } = await client.query(
      `INSERT INTO statement_artifacts
        (id, snapshot_id, document_id, settlement_document_id, kind, language, renderer_version, template_version,
         font_version, byte_length, sha256, media_type, object_key, storage_bucket, publication_token, rendition_label, state, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'staged', transaction_timestamp())
       RETURNING *`,
      [crypto.randomUUID(), snapshotId,
        documentLink && documentLink.documentId ? documentLink.documentId : null,
        documentLink && documentLink.settlementDocumentId ? documentLink.settlementDocumentId
          : (settlementDocumentId || null),
        kind, language, rendered.rendererVersion,
        rendered.templateVersion, rendered.fontVersion, String(byteLength), hash, PDF_MEDIA_TYPE, baseKey,
        namespace.bucket, token, label || '']);

    let currentKey = baseKey;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      const key = attemptKey(currentKey, attempt);
      if (attempt > 1 && key !== currentKey) {
        // Retry under a new attempt key so a half-written object from an
        // uncertain outcome is never silently reused.
        await setState(client, artifact.id, 'staged', key, token);
        currentKey = key;
      }
      let uploadError = null;
      try {
        await storage.uploadFile(currentKey, pdfBytes, PDF_MEDIA_TYPE);
      } catch (error) {
        uploadError = error;
      }

      if (!uploadError) {
        await recordAttempt(client, artifact.id, attempt, { outcome: 'uploaded' });
      } else if (isUncertainUploadError(uploadError) && attempt < MAX_UPLOAD_ATTEMPTS) {
        // Uncertain outcome: reconcile before any retry. Read the object back
        // by key; adopt it when size and hash match, otherwise retry under a
        // new attempt key.
        await recordAttempt(client, artifact.id, attempt, { outcome: 'uncertain', error: uploadError.message });
        const reconciled = await readBackObject(storage, currentKey, byteLength);
        if (reconciled && reconciled.bytes.length === byteLength && reconciled.hash === hash) {
          await recordAttempt(client, artifact.id, attempt, {
            outcome: 'adopted', verifiedBytes: reconciled.bytes.length, verifiedHash: reconciled.hash,
          });
          const ready = await setState(client, artifact.id, 'verifying', null, token);
          void ready;
          const done = await setState(client, artifact.id, 'ready', null, token);
          return shapeArtifact(done);
        }
        lastError = uploadError;
        continue;
      } else {
        lastError = uploadError;
        break;
      }

      // Verify-before-ready: read the stored object back and recompute byte
      // length and SHA-256 from it. Never mark ready on the attempt alone.
      await setState(client, artifact.id, 'verifying', null, token);
      const readBack = await readBackObject(storage, currentKey, byteLength);
      if (readBack && readBack.bytes.length === byteLength && readBack.hash === hash) {
        await recordAttempt(client, artifact.id, attempt, {
          outcome: 'verified', verifiedBytes: readBack.bytes.length, verifiedHash: readBack.hash,
        });
        const done = await setState(client, artifact.id, 'ready', null, token);
        return shapeArtifact(done);
      }
      await recordAttempt(client, artifact.id, attempt, {
        outcome: 'verification_failed',
        verifiedBytes: readBack ? readBack.bytes.length : null,
        verifiedHash: readBack ? readBack.hash : null,
        error: 'Stored object did not match the recorded bytes',
      });
      try {
        await storage.deleteFile(currentKey);
      } catch (deleteError) {
        logger.warn('statement artifact cleanup failed', { error: deleteError.message });
      }
      lastError = new AppError('Stored statement object did not match the recorded bytes', 502, 'statement_artifact_verification_failed');
      break;
    }

    await setState(client, artifact.id, 'failed', null, token);
    throw lastError instanceof AppError ? lastError : new AppError(
      `Statement artifact publication failed: ${lastError ? lastError.message : 'unknown error'}`,
      502,
      'statement_artifact_upload_failed',
    );
  } finally {
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 692))', [identity]); }
      catch { /* disconnected sessions release their locks automatically */ }
    }
    client.release();
  }
}

async function publishOriginal({ snapshotId, language = 'en', pdfBytes, storage, versions, settlementDocumentId }) {
  return publishArtifact({ kind: 'original', snapshotId, language, pdfBytes, storage, versions, settlementDocumentId });
}

async function publishRendition({ snapshotId, language, pdfBytes, label, storage, versions, settlementDocumentId }) {
  if (label === undefined) throw new AppError('Statement rendition label is required', 400, 'statement_artifact_invalid_input');
  return publishArtifact({ kind: 'rendition', snapshotId, language, pdfBytes, label, storage, versions, settlementDocumentId });
}

async function requireReadyArtifact(client, artifactId) {
  const { rows: [row] } = await client.query('SELECT * FROM statement_artifacts WHERE id = $1', [artifactId]);
  if (!row) throw new AppError('Statement artifact not found', 404, 'statement_artifact_not_found');
  if (row.state !== 'ready') {
    // Incomplete objects are never exposed, even to authorized callers.
    throw new AppError('Statement artifact is not ready', 409, 'statement_artifact_not_ready');
  }
  return row;
}

function assertStorageLocation(row, storage) {
  const { bucket } = resolveNamespace(storage);
  if (row.storage_bucket !== bucket) {
    throw new AppError('Statement artifact storage location requires verified recovery', 503, 'statement_storage_bucket_mismatch');
  }
  if (!Number.isSafeInteger(Number(row.byte_length)) || Number(row.byte_length) > MAX_PDF_BYTES) {
    throw new AppError('Statement object exceeds the download limit', 409, 'statement_artifact_too_large');
  }
}

// Streams an authenticated download. Authorization is enforced by the caller;
// the actor record is already-authorized and used for audit only.
async function getDownloadStream({ artifactId, actor, storage = defaultStorage }) {
  if (!UUID_PATTERN.test(String(artifactId || ''))) {
    throw new AppError('Invalid statement artifact id', 400, 'statement_artifact_invalid_input');
  }
  const client = await pool.connect();
  try {
    const row = await requireReadyArtifact(client, artifactId);
    assertStorageLocation(row, storage);
    const stored = await readBackObject(storage, row.object_key, Number(row.byte_length));
    if (!stored) throw new AppError('Statement artifact is temporarily unavailable', 502, 'statement_artifact_unavailable');
    if (stored.bytes.length !== Number(row.byte_length) || stored.hash !== row.sha256) {
      throw new AppError('Statement original failed verification', 502, 'statement_artifact_verification_failed');
    }
    const stream = Readable.from([stored.bytes]);
    logger.info('statement_artifact_download', {
      artifactId: row.id,
      snapshotId: row.snapshot_id,
      actorId: actor && actor.id ? String(actor.id) : 'unknown',
    });
    return {
      stream,
      mediaType: row.media_type,
      byteLength: Number(row.byte_length),
      sha256: row.sha256,
    };
  } finally {
    client.release();
  }
}

// Short-lived, scoped signed URL for an authorized download. Never mints a
// permanent link and never uses the public-URL path. The TTL is returned so
// callers can communicate expiry honestly.
async function createSignedUrl({ artifactId, actor, ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS, storage = defaultStorage }) {
  if (!UUID_PATTERN.test(String(artifactId || ''))) {
    throw new AppError('Invalid statement artifact id', 400, 'statement_artifact_invalid_input');
  }
  if (typeof storage.getSignedDownloadUrl !== 'function') {
    throw new AppError(
      'Short-lived signed URLs are not supported by the configured storage provider',
      503,
      'statement_signed_url_unavailable',
    );
  }
  const ttl = Math.min(MAX_SIGNED_URL_TTL_SECONDS, Math.max(MIN_SIGNED_URL_TTL_SECONDS, Number(ttlSeconds) || DEFAULT_SIGNED_URL_TTL_SECONDS));
  const client = await pool.connect();
  try {
    const row = await requireReadyArtifact(client, artifactId);
    assertStorageLocation(row, storage);
    const verified = await readBackObject(storage, row.object_key, Number(row.byte_length));
    if (!verified || verified.bytes.length !== Number(row.byte_length) || verified.hash !== row.sha256) {
      throw new AppError('Statement original failed verification', 502, 'statement_artifact_verification_failed');
    }
    const url = await storage.getSignedDownloadUrl(row.object_key, ttl);
    if (!url) {
      throw new AppError('Short-lived signed URLs are not supported by the configured storage provider', 503, 'statement_signed_url_unavailable');
    }
    logger.info('statement_artifact_signed_url', {
      artifactId: row.id,
      snapshotId: row.snapshot_id,
      actorId: actor && actor.id ? String(actor.id) : 'unknown',
      ttlSeconds: ttl,
    });
    return {
      url,
      ttlSeconds: ttl,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  } finally {
    client.release();
  }
}

module.exports = {
  publishOriginal,
  publishRendition,
  getDownloadStream,
  createSignedUrl,
  MAX_UPLOAD_ATTEMPTS,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
};
