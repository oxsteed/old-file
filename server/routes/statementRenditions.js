'use strict';

// Accessible statement renditions (workstream 7).
//
// Self-contained Express router. NOT mounted here: the application wires it
// with a mount line such as
//   app.use('/api/statements', creditExportLimiter, statementRenditions);
// (see the report for the exact recommended mount + client route lines).
// Apply the same credit export rate limiter used by the other statement
// download routes when mounting.
//
// Routes:
//   GET /documents/:documentId/renditions/:language/pdf   tagged-PDF rendition
//   GET /documents/:documentId/renditions/:language/html  accessible-HTML rendition
//
// Invariants honored:
// - Accessibility work never changes accounting facts: both renditions render
//   the immutable credit_statement_documents row byte-for-byte through the
//   same normalize()/amount() helpers as the original exports.
// - A rendition is a separate labeled RENDITION (statement_artifacts
//   kind='rendition'). The issued original row is never updated.
// - Authorization is server-side and per request: the document's customer_id
//   must equal req.user.id on every GET. Unknown or foreign documents return
//   404 so ownership cannot be probed.
// - no-store on every response.
// - Unsupported scripts fail loudly: the PDF renderer throws
//   statement_unsupported_glyph instead of emitting tofu boxes; the route
//   answers 422 with an explicit localized notice and HTML/CSV recovery URLs.
// - No PII in filenames, object keys, or URLs. Download names carry only the
//   product, period dates, and language.
//
// Artifact recording: each served rendition is recorded in
// statement_artifacts with kind='rendition' and honest renderer/template/font
// versions (see RENDERER_VERSIONS in creditStatementPdf.js). The row is stored
// with state='staged' deliberately: 'ready' is reserved by the publication
// workflow for objects verified to exist in the statement-only object bucket,
// and the admin reconcile job raises critical alerts for 'ready' rows it
// cannot read back. Inline-served renditions are verified by construction
// (the SHA-256 is computed over the exact bytes sent), so they are recorded
// as staged audit rows, never as published objects. Identical bytes are
// de-duplicated on (snapshot_id, kind, language, media_type, sha256).
//
// Snapshot linkage: the rendition links to the snapshot behind the issued
// document, resolved in order: (1) the document's original artifact row,
// (2) the deterministic issuance key stmt:v1:<product>:<accountId>:
// <currency>:<from>:<to>:<customerId> (restaurant uses the restaurant id),
// (3) an on-demand freezeSnapshot, which is idempotent and money-neutral.
// When no snapshot evidence exists the route refuses with 409 rather than
// recording a rendition against fabricated evidence.

const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { withDbBudget } = require('../utils/dbBudgets');
const { renderStatementPdfInWorker, MAX_PDF_BYTES } = require('../services/creditStatementExport');
const { renderStatementHtml } = require('../services/statementHtmlRenderer');
const { glyphFallbackNotice, RENDERER_VERSIONS } = require('../services/creditStatementPdf');
const { getSnapshot, freezeSnapshot } = require('../services/statementSnapshotService');

const router = express.Router();

const LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HTML_BYTES = 8 * 1024 * 1024;

function fail(code, message, status = 400) {
  throw new AppError(message, status, code);
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sqlDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? '').slice(0, 10);
  if (!DATE_PATTERN.test(text)) fail('statement_invalid_date', 'Invalid statement period', 500);
  return text;
}

// Server-side authorization, re-run on every request. Never accept an owner
// or account id from the body or query: the document id in the path is the
// only lookup key, and it must belong to the signed-in customer.
async function loadAuthorizedDocument(req) {
  const { documentId, language } = req.params;
  if (!UUID_PATTERN.test(String(documentId || ''))) fail('statement_invalid_document', 'Invalid statement document', 400);
  if (!LANGUAGES.has(language)) fail('statement_unsupported_language', 'Unsupported statement language', 400);
  const customerId = req.user && req.user.id;
  if (!customerId) fail('statement_unauthorized', 'Authentication required', 401);
  const { rows: [row] } = await pool.query(
    `SELECT id, customer_id, product, account_id, currency_code,
            period_from::text AS period_from, period_to::text AS period_to,
            generated_at, document, content_hash
     FROM credit_statement_documents WHERE id = $1`,
    [documentId]);
  // 404 for foreign documents: ownership is not probeable.
  if (!row || String(row.customer_id) !== String(customerId)) {
    fail('statement_not_found', 'Statement not found', 404);
  }
  if (!['oxsteed', 'restaurant'].includes(row.product)) fail('statement_invalid', 'Invalid statement', 500);
  return { row, language, document: row.document };
}

async function resolveSnapshotId(documentRow) {
  const client = await pool.connect();
  try {
    const { rows: [original] } = await client.query(
      `SELECT snapshot_id FROM statement_artifacts
       WHERE document_id = $1 AND kind = 'original' AND state <> 'failed'
       ORDER BY created_at DESC LIMIT 1`,
      [documentRow.id]);
    if (original) return original.snapshot_id;

    let accountId = Number(documentRow.account_id);
    if (documentRow.product === 'restaurant') {
      const { rows: [wallet] } = await client.query(
        'SELECT restaurant_id FROM food_customer_wallet_accounts WHERE id = $1', [documentRow.account_id]);
      if (!wallet) return null;
      accountId = Number(wallet.restaurant_id);
    }
    if (!Number.isSafeInteger(accountId) || accountId <= 0) return null;
    const periodFrom = sqlDate(documentRow.period_from);
    const periodTo = sqlDate(documentRow.period_to);
    const issuanceKey = `stmt:v1:${documentRow.product}:${accountId}:${documentRow.currency_code}:${periodFrom}:${periodTo}:${documentRow.customer_id}`;
    const existing = await getSnapshot(issuanceKey);
    if (existing) return existing.id;
    // Idempotent, money-neutral freeze from the append-only ledger. Closed
    // monthly periods reproduce the archived document; anything else throws
    // and the rendition is refused below.
    try {
      const frozen = await freezeSnapshot({
        issuanceKey, product: documentRow.product, accountId,
        currency: documentRow.currency_code, periodFrom, periodTo,
        customerId: String(documentRow.customer_id),
      });
      return frozen ? frozen.id : null;
    } catch {
      return null;
    }
  } finally {
    client.release();
  }
}

function renditionVersions(mediaType) {
  return mediaType === 'application/pdf' ? RENDERER_VERSIONS.pdf : RENDERER_VERSIONS.html;
}

async function recordRendition({ snapshotId, documentId, language, mediaType, bytes }) {
  const versions = renditionVersions(mediaType);
  const hash = sha256Hex(bytes);
  const extension = mediaType === 'application/pdf' ? 'pdf' : 'html';
  const client = await pool.connect();
  try {
    const { rows: [existing] } = await client.query(
      `SELECT * FROM statement_artifacts
       WHERE snapshot_id = $1 AND kind = 'rendition' AND language = $2
         AND media_type = $3 AND sha256 = $4 AND state = 'staged'
       ORDER BY created_at DESC LIMIT 1`,
      [snapshotId, language, mediaType, hash]);
    if (existing) return existing;
    // Opaque key: uuid only, never PII. Inline-served renditions are staged
    // audit rows (see the module header); they are not published objects.
    const objectKey = `stmt/renditions/accessible/${crypto.randomUUID()}.${extension}`;
    const { rows: [row] } = await client.query(
      `INSERT INTO statement_artifacts
        (id, snapshot_id, document_id, kind, language, renderer_version, template_version,
         font_version, byte_length, sha256, media_type, object_key, state, created_at)
       VALUES ($1,$2,$3,'rendition',$4,$5,$6,$7,$8,$9,$10,$11,'staged', transaction_timestamp())
       RETURNING *`,
      [crypto.randomUUID(), snapshotId, documentId, language, versions.rendererVersion,
        versions.templateVersion, versions.fontVersion, String(bytes.length), hash, mediaType, objectKey]);
    return row;
  } finally {
    client.release();
  }
}

function downloadName(documentRow, language, extension) {
  const periodFrom = sqlDate(documentRow.period_from);
  const periodTo = sqlDate(documentRow.period_to);
  return `accessible-statement-${periodFrom}-to-${periodTo}-${language}.${extension}`;
}

async function csvRecoveryUrl(documentRow, language) {
  const params = new URLSearchParams({
    from: sqlDate(documentRow.period_from),
    to: sqlDate(documentRow.period_to),
    currencyCode: documentRow.currency_code,
    language,
  });
  if (documentRow.product === 'oxsteed') return `/oxsteed-credit/documents.csv?${params}`;
  const { rows: [wallet] } = await pool.query(
    'SELECT restaurant_id FROM food_customer_wallet_accounts WHERE id = $1', [documentRow.account_id]);
  if (!wallet) return null;
  return `/food/customer/wallets/${encodeURIComponent(String(wallet.restaurant_id))}/statements.csv?${params}`;
}

function noStore(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
}

async function handleRendition(req, res, next, format) {
  let authorized = null;
  try {
    noStore(res);
    const { row, language, document } = await loadAuthorizedDocument(req);
    authorized = { row, language };
    const mediaType = format === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8';

    const bytes = await withDbBudget('exports', async () => {
      if (format === 'pdf') {
        const pdf = await renderStatementPdfInWorker(document, { language });
        if (pdf.length > MAX_PDF_BYTES) fail('statement_export_too_large', 'Statement export is too large', 409);
        return pdf;
      }
      const html = renderStatementHtml(document, { language });
      const buffer = Buffer.from(html, 'utf8');
      if (buffer.length > MAX_HTML_BYTES) fail('statement_export_too_large', 'Statement export is too large', 409);
      return buffer;
    });

    const snapshotId = await resolveSnapshotId(row);
    if (!snapshotId) {
      fail('statement_rendition_unavailable',
        'An accessible rendition is not available for this statement yet; use the standard PDF or CSV export', 409);
    }
    await recordRendition({ snapshotId, documentId: row.id, language, mediaType, bytes });

    res.set('Content-Language', language);
    if (format === 'pdf') {
      res.set('Content-Disposition', `attachment; filename="${downloadName(row, language, 'pdf')}"`);
      res.type('application/pdf');
      return res.send(bytes);
    }
    // The HTML rendition is the readable equivalent-access option: served
    // inline so screen readers and browser reading tools can use it directly.
    res.set('Content-Disposition', `inline; filename="${downloadName(row, language, 'html')}"`);
    res.type('text/html; charset=utf-8');
    return res.send(bytes);
  } catch (error) {
    if (error && error.code === 'statement_unsupported_glyph') {
      // Fail loudly with an explicit notice and the recovery path. Never a
      // PDF with silent tofu boxes.
      const language = LANGUAGES.has(req.params.language) ? req.params.language : 'en';
      const fallback = glyphFallbackNotice(language);
      let urls = null;
      if (authorized) {
        try {
          urls = {
            html: req.baseUrl + req.path.replace(/\/pdf$/, '/html'),
            csv: await csvRecoveryUrl(authorized.row, language),
          };
        } catch { urls = null; }
      }
      return res.status(422).json({ code: fallback.code, notice: fallback.notice, recovery: fallback.recovery, urls });
    }
    return next(error);
  }
}

router.get('/documents/:documentId/renditions/:language/pdf', authenticate, (req, res, next) => handleRendition(req, res, next, 'pdf'));
router.get('/documents/:documentId/renditions/:language/html', authenticate, (req, res, next) => handleRendition(req, res, next, 'html'));

module.exports = router;
module.exports.recordRendition = recordRendition;
module.exports.resolveSnapshotId = resolveSnapshotId;
module.exports.renditionVersions = renditionVersions;
module.exports.loadAuthorizedDocument = loadAuthorizedDocument;
