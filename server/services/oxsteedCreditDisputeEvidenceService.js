'use strict';

/**
 * Group 13 Slice 4e (674, D-371/D-372/D-373/D-374): customer dispute
 * evidence submission.
 *
 * The customer attaches files and/or a note to their own open dispute.
 * This is a NEW upload/attach path: migration 463 ("dispute_status_
 * evidence") is operator evidence (a resolution note on every status
 * change) and is untouched here.
 *
 * Invariants (absolute):
 * - MONEY FAILS CLOSED: these functions ONLY insert rows into
 *   oxsteed_credit_dispute_evidence (plus one audit event). They NEVER
 *   mutate dispute state, amounts, resolution, journals, holds, or
 *   transactions, and they trigger no financial side effects.
 * - Record-level authorization on every read and write: the requester must
 *   own the dispute (dispute.customer_id = customer id) or be an admin
 *   reading through listEvidenceForAdmin. Unknown disputes, malformed ids,
 *   and disputes owned by someone else are indistinguishable: 404 in both
 *   cases so ownership cannot be probed.
 * - Only non-terminal disputes accept evidence (open / in_review); a
 *   terminal dispute is a 409.
 * - Files go through the existing storage backend
 *   (server/utils/storage.js) under the private prefix
 *   `credit-dispute-evidence/` — deliberately NOT in the public-key
 *   allowlist. Downloads are HMAC-signed URLs (1 hour, bound to dispute +
 *   evidence + expiry) to a server download endpoint that re-checks the
 *   caller's standing and streams the object. `storage.js` presigned URLs
 *   are deliberately NOT used: they embed the storage key in the URL path,
 *   and the key never leaves the server. The signed URL alone grants
 *   nothing: the download endpoint also requires the caller's live session
 *   (customer ownership, or super-admin standing).
 */

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { normalizeString } = require('./oxsteedCreditService');
const storage = require('../utils/storage');

const EVIDENCE_FOLDER = 'credit-dispute-evidence';
const EVIDENCE_MAX_FILE_BYTES = 10 * 1024 * 1024;
const EVIDENCE_MAX_NOTE_CHARS = 2000;
const EVIDENCE_SIGNED_URL_TTL_SECONDS = 3600;
const EVIDENCE_OPEN_STATUSES = Object.freeze(['open', 'in_review']);
// Images, PDF, and plain-text documents. Active content types
// (HTML/JS/SVG) are normalized to application/octet-stream by the storage
// layer, so an uploaded file can never be served as executable content.
const EVIDENCE_ALLOWED_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function notFound() {
  throw new AppError('Credit dispute not found', 404, 'credit_dispute_not_found');
}

function isAllowedMimeType(value) {
  return EVIDENCE_ALLOWED_MIME_TYPES.includes(String(value || '').split(';', 1)[0].trim().toLowerCase());
}

async function loadDisputeForCustomer(client, disputeId, customerId) {
  if (!UUID_RE.test(String(disputeId || ''))) notFound();
  const { rows } = await client.query(
    `SELECT id, customer_id, status FROM oxsteed_credit_disputes WHERE id = $1`,
    [String(disputeId).toLowerCase()]
  );
  const dispute = rows[0];
  if (!dispute || String(dispute.customer_id) !== String(customerId)) notFound();
  return dispute;
}

async function loadDisputeForAdmin(client, disputeId) {
  if (!UUID_RE.test(String(disputeId || ''))) notFound();
  const { rows } = await client.query(
    `SELECT id, customer_id, status FROM oxsteed_credit_disputes WHERE id = $1`,
    [String(disputeId).toLowerCase()]
  );
  if (!rows[0]) notFound();
  return rows[0];
}

function formatEvidenceRow(row, downloadUrl) {
  return {
    id: String(row.id),
    disputeId: String(row.dispute_id),
    kind: row.kind,
    note: row.note || null,
    originalFilename: row.original_filename || null,
    contentType: row.content_type || null,
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    downloadUrl: row.kind === 'file' ? downloadUrl || null : null,
    submittedAt: row.created_at,
  };
}

// Signed download URLs (D-371). The signature binds dispute + evidence +
// expiry under SIGNED_URL_SECRET (the dedicated signing secret, never the
// JWT secret); the URL carries ids only, never the storage key. Verification
// fails closed when the secret is absent. The download endpoint verifies
// this signature AND the caller's standing.
function signingSecret() {
  return String(process.env.SIGNED_URL_SECRET || '').trim();
}

function signDownload({ basePath, disputeId, evidenceId, expiresInSeconds }) {
  const secret = signingSecret();
  if (!secret) throw new AppError('Evidence downloads are unavailable', 503, 'credit_dispute_evidence_download_unavailable');
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Number(expiresInSeconds) || EVIDENCE_SIGNED_URL_TTL_SECONDS);
  const payload = `credit-dispute-evidence-download:${disputeId}:${evidenceId}:${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${basePath}?exp=${exp}&sig=${sig}`;
}

function verifyDownloadSignature({ disputeId, evidenceId, exp, sig }) {
  const secret = signingSecret();
  if (!secret) throw new AppError('Evidence downloads are unavailable', 503, 'credit_dispute_evidence_download_unavailable');
  const expSeconds = Number(exp);
  if (!Number.isSafeInteger(expSeconds) || expSeconds <= Math.floor(Date.now() / 1000)) {
    throw new AppError('The evidence download link has expired', 403, 'credit_dispute_evidence_download_expired');
  }
  if (typeof sig !== 'string' || !sig) {
    throw new AppError('The evidence download link is invalid', 403, 'credit_dispute_evidence_download_invalid');
  }
  const payload = `credit-dispute-evidence-download:${disputeId}:${evidenceId}:${expSeconds}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const presented = Buffer.from(sig, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const valid = presented.length === expectedBuffer.length
    && crypto.timingSafeEqual(presented, expectedBuffer);
  if (!valid) {
    throw new AppError('The evidence download link is invalid', 403, 'credit_dispute_evidence_download_invalid');
  }
}

function mintDownloadUrl(basePath, row) {
  return signDownload({
    basePath,
    disputeId: String(row.dispute_id),
    evidenceId: String(row.id),
    expiresInSeconds: EVIDENCE_SIGNED_URL_TTL_SECONDS,
  });
}

async function withDownloadUrls(rows, basePathFor) {
  return rows.map((row) => {
    const downloadUrl = row.kind === 'file' && row.storage_key
      ? mintDownloadUrl(basePathFor(row), row)
      : null;
    return formatEvidenceRow(row, downloadUrl);
  });
}

const EVIDENCE_COLUMNS = `id, dispute_id, customer_id, kind, note, storage_key,
  original_filename, content_type, size_bytes, created_at`;

async function findByIdempotencyKey(client, disputeId, idempotencyKey) {
  const { rows } = await client.query(
    `SELECT ${EVIDENCE_COLUMNS} FROM oxsteed_credit_dispute_evidence
      WHERE dispute_id = $1 AND idempotency_key = $2`,
    [disputeId, idempotencyKey]
  );
  return rows[0] || null;
}

function evidenceDetailsMatch(row, { kind, note, originalFilename, contentType, sizeBytes }) {
  return (
    row.kind === kind
    && (row.note || null) === (note || null)
    && (row.original_filename || null) === (originalFilename || null)
    && (row.content_type || null) === (contentType || null)
    && Number(row.size_bytes || 0) === Number(sizeBytes || 0)
  );
}

function normalizeNote(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  if (typeof value !== 'string') {
    throw new AppError('Invalid evidence note', 400, 'credit_dispute_evidence_note_invalid');
  }
  if (value.length > EVIDENCE_MAX_NOTE_CHARS) {
    throw new AppError('The evidence note is too long', 400, 'credit_dispute_evidence_note_too_long');
  }
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').trim() || null;
}

function validateFile(file) {
  if (!file) return null;
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new AppError('The evidence file is empty', 400, 'credit_dispute_evidence_file_empty');
  }
  if (file.buffer.length > EVIDENCE_MAX_FILE_BYTES) {
    throw new AppError('The evidence file is too large', 400, 'credit_dispute_evidence_file_too_large');
  }
  if (!isAllowedMimeType(file.mimetype)) {
    throw new AppError('That file type cannot be attached as dispute evidence', 400, 'credit_dispute_evidence_file_type_invalid');
  }
  return {
    buffer: file.buffer,
    originalname: String(file.originalname || 'evidence').slice(0, 200),
    mimetype: String(file.mimetype).split(';', 1)[0].trim().toLowerCase(),
    size: file.buffer.length,
  };
}

/**
 * Attach a note and/or one file to the customer's own open dispute.
 * Idempotent on `idempotencyKey`: a retry returns the original row
 * (`replayed: true`); a reused key with different details is a 409.
 */
async function submitDisputeEvidence({ disputeId, customerId, note, file, idempotencyKey, requestIp }) {
  const normalizedNote = normalizeNote(note);
  const validatedFile = validateFile(file);
  if (!normalizedNote && !validatedFile) {
    throw new AppError('A note or a file is required to submit evidence', 400, 'credit_dispute_evidence_required');
  }
  const normalizedKey = normalizeString(idempotencyKey, 160);
  if (!normalizedKey) {
    throw new AppError('Idempotency-Key is required for dispute evidence', 400, 'credit_idempotency_key_required');
  }
  const kind = validatedFile ? 'file' : 'note';

  const dispute = await loadDisputeForCustomer(pool, disputeId, customerId);
  if (!EVIDENCE_OPEN_STATUSES.includes(dispute.status)) {
    throw new AppError('Evidence can only be added while a dispute is open', 409, 'credit_dispute_evidence_closed');
  }

  const preexisting = await findByIdempotencyKey(pool, dispute.id, normalizedKey);
  if (preexisting) {
    if (!evidenceDetailsMatch(preexisting, {
      kind,
      note: normalizedNote,
      originalFilename: validatedFile ? validatedFile.originalname : null,
      contentType: validatedFile ? validatedFile.mimetype : null,
      sizeBytes: validatedFile ? validatedFile.size : null,
    })) {
      throw new AppError('Idempotency key was already used for different details', 409, 'credit_dispute_evidence_idempotency_conflict');
    }
    const [formatted] = await withDownloadUrls([preexisting], customerDownloadBasePath);
    return { evidence: formatted, replayed: true };
  }

  // The file lands in private storage before the row exists. If the row
  // insert fails, the orphan is best-effort removed so a failed submit
  // leaves no unreferenced private object behind.
  let storageKey = null;
  if (validatedFile) {
    storageKey = await storage.uploadFile(
      validatedFile.buffer,
      EVIDENCE_FOLDER,
      validatedFile.originalname,
      validatedFile.mimetype
    );
    if (!storageKey) throw new AppError('Evidence upload failed', 503, 'credit_dispute_evidence_upload_failed');
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO oxsteed_credit_dispute_evidence
           (dispute_id, customer_id, submitted_by, kind, note, storage_key,
            original_filename, content_type, size_bytes, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (dispute_id, idempotency_key) DO NOTHING
         RETURNING ${EVIDENCE_COLUMNS}`,
        [
          dispute.id,
          customerId,
          customerId,
          kind,
          normalizedNote,
          storageKey,
          validatedFile ? validatedFile.originalname : null,
          validatedFile ? validatedFile.mimetype : null,
          validatedFile ? validatedFile.size : null,
          normalizedKey,
        ]
      );
      let row = rows[0];
      let replayed = false;
      if (!row) {
        // Lost a race with a concurrent insert of the same key: return the
        // winner instead of failing.
        row = await findByIdempotencyKey(client, dispute.id, normalizedKey);
        if (!row) {
          throw new AppError('Evidence could not be submitted; please try again', 409, 'credit_dispute_evidence_conflict');
        }
        if (!evidenceDetailsMatch(row, {
          kind,
          note: normalizedNote,
          originalFilename: validatedFile ? validatedFile.originalname : null,
          contentType: validatedFile ? validatedFile.mimetype : null,
          sizeBytes: validatedFile ? validatedFile.size : null,
        })) {
          throw new AppError('Idempotency key was already used for different details', 409, 'credit_dispute_evidence_idempotency_conflict');
        }
        replayed = true;
      } else {
        await client.query(
          `INSERT INTO oxsteed_credit_audit_events
             (action_type, actor_user_id, customer_id, resource_type, resource_id, reason, request_ip, after_state)
           VALUES ('credit.dispute.evidence.submitted', $1, $2, 'credit_dispute_evidence', $3, $4, $5, $6::jsonb)`,
          [
            customerId,
            customerId,
            String(row.id),
            'customer-evidence',
            requestIp || null,
            JSON.stringify({
              disputeId: String(dispute.id),
              kind,
              hasFile: validatedFile !== null,
              hasNote: normalizedNote !== null,
            }),
          ]
        );
      }
      return { row, replayed };
    }, 'credit_dispute_evidence_submit');
    const [formatted] = await withDownloadUrls([result.row], customerDownloadBasePath);
    return { evidence: formatted, replayed: result.replayed };
  } catch (error) {
    if (storageKey) {
      try { await storage.deleteFile(storageKey); } catch { /* best effort */ }
    }
    throw error;
  }
}

function customerDownloadBasePath(row) {
  return `/api/oxsteed-credit/disputes/${String(row.dispute_id)}/evidence/${String(row.id)}/download`;
}

function adminDownloadBasePath(row) {
  return `/api/admin/super/oxsteed-credit/disputes/${String(row.dispute_id)}/evidence/${String(row.id)}/download`;
}

async function listDisputeEvidenceForCustomer({ disputeId, customerId }) {
  const dispute = await loadDisputeForCustomer(pool, disputeId, customerId);
  const { rows } = await pool.query(
    `SELECT ${EVIDENCE_COLUMNS} FROM oxsteed_credit_dispute_evidence
      WHERE dispute_id = $1
      ORDER BY created_at ASC, id ASC`,
    [dispute.id]
  );
  return { evidence: await withDownloadUrls(rows, customerDownloadBasePath) };
}

async function listDisputeEvidenceForAdmin({ disputeId }) {
  const dispute = await loadDisputeForAdmin(pool, disputeId);
  const { rows } = await pool.query(
    `SELECT ${EVIDENCE_COLUMNS} FROM oxsteed_credit_dispute_evidence
      WHERE dispute_id = $1
      ORDER BY created_at ASC, id ASC`,
    [dispute.id]
  );
  return { evidence: await withDownloadUrls(rows, adminDownloadBasePath), customerId: String(dispute.customer_id) };
}

/**
 * Stream one evidence file to its owner (or a super admin). The signed URL
 * is verified first, then the caller's standing — a valid signature for
 * someone else's evidence still 404s, and a missing/expired signature
 * fails closed before any row is read.
 */
async function downloadDisputeEvidenceFile({ disputeId, evidenceId, customerId, isAdmin, exp, sig }) {
  if (!UUID_RE.test(String(disputeId || '')) || !UUID_RE.test(String(evidenceId || ''))) notFound();
  verifyDownloadSignature({ disputeId: String(disputeId).toLowerCase(), evidenceId: String(evidenceId).toLowerCase(), exp, sig });
  const { rows } = await pool.query(
    `SELECT ${EVIDENCE_COLUMNS} FROM oxsteed_credit_dispute_evidence
      WHERE id = $1 AND dispute_id = $2`,
    [String(evidenceId).toLowerCase(), String(disputeId).toLowerCase()]
  );
  const row = rows[0];
  if (!row || row.kind !== 'file' || !row.storage_key) notFound();
  if (!isAdmin && String(row.customer_id) !== String(customerId)) notFound();
  const stream = await storage.getObjectStream(row.storage_key);
  if (!stream) throw new AppError('Evidence file is unavailable', 503, 'credit_dispute_evidence_unavailable');
  return {
    stream,
    contentType: row.content_type || 'application/octet-stream',
    filename: row.original_filename || 'evidence',
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
  };
}

async function countEvidenceByDisputeIds(disputeIds) {
  const ids = [...new Set((disputeIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return {};
  const { rows } = await pool.query(
    `SELECT dispute_id, COUNT(*)::int AS n FROM oxsteed_credit_dispute_evidence
      WHERE dispute_id = ANY($1::uuid[]) GROUP BY dispute_id`,
    [ids]
  );
  return Object.fromEntries(rows.map((row) => [String(row.dispute_id), row.n]));
}

module.exports = {
  EVIDENCE_FOLDER,
  EVIDENCE_MAX_FILE_BYTES,
  EVIDENCE_MAX_NOTE_CHARS,
  EVIDENCE_ALLOWED_MIME_TYPES,
  EVIDENCE_OPEN_STATUSES,
  submitDisputeEvidence,
  listDisputeEvidenceForCustomer,
  listDisputeEvidenceForAdmin,
  downloadDisputeEvidenceFile,
  countEvidenceByDisputeIds,
};
