'use strict';

// Accessible statement renditions (workstream 7, extended to the settlement
// products and to published amendment versions).
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
// :documentId names an issued original (credit_statement_documents or
// settlement_statement_documents) or a published amendment version
// (statement_amendment_versions). Versions render their amendment envelope;
// the renderers label amended versions as such.
//
// Invariants honored:
// - Accessibility work never changes accounting facts: both renditions render
//   the immutable archive row byte-for-byte through the same normalize()/
//   amount() helpers as the original exports. Credit and settlement archives
//   stay separate; scopes never mix.
// - A rendition is a separate labeled RENDITION (statement_artifacts
//   kind='rendition'). The issued original row is never updated.
// - Authorization is server-side and per request. Credit originals: the
//   document's customer_id must equal req.user.id. Settlement originals and
//   settlement versions: the scope standing rule from the settlement archive
//   (helper self-service; business owner or active manager). Versions are
//   authorized as the original's owner. Unknown or foreign documents return
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
// Settlement originals link via settlement_document_id; credit rows and
// version renditions link via document_id.
//
// Snapshot linkage: the rendition links to the snapshot behind the issued
// document, resolved in order: (1) the document's original artifact row,
// (2) the deterministic issuance key stmt:v1:<product>:<accountId>:
// <currency>:<from>:<to>:<customerId>, (3) an on-demand freezeSnapshot, which
// is idempotent and money-neutral. When no snapshot evidence exists the route
// refuses with 409 rather than recording a rendition against fabricated
// evidence.

const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { withDbBudget } = require('../utils/dbBudgets');
const { renderStatementPdfInWorker, MAX_PDF_BYTES } = require('../services/creditStatementExport');
const { renderStatementHtml, renderSettlementStatementHtml } = require('../services/statementHtmlRenderer');
const { glyphFallbackNotice, RENDERER_VERSIONS } = require('../services/creditStatementPdf');
const { getSnapshot, freezeSnapshot } = require('../services/statementSnapshotService');
const { assertScopeStanding } = require('./settlementStatementArchive');
const { hashDocument: hashSettlementDocument } = require('../services/settlementStatementService');
const { SETTLEMENT_PRODUCTS } = require('../services/statementIssuancePolicy');

const router = express.Router();

const LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const CREDIT_PRODUCTS = new Set(['oxsteed', 'restaurant']);

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

// The scope value that identifies a settlement document's owner, for the
// standing check.
function settlementScopeId(row) {
  return row.scope_restaurant_id ?? row.scope_business_id ?? row.scope_helper_user_id;
}

// The notification-scope recipient behind a settlement document: the helper
// for helper_earnings, otherwise the business owner. Mirrors the finance
// standing rule in settlementStatementArchive.js and the amendment service.
async function settlementRecipientId(clientOrPool, row) {
  if (row.product === 'helper_earnings') {
    return String(row.scope_helper_user_id).toLowerCase();
  }
  if (row.product === 'business') {
    const { rows: [business] } = await clientOrPool.query(
      'SELECT user_id FROM businesses WHERE id = $1', [row.scope_business_id]);
    return business ? String(business.user_id) : null;
  }
  const { rows: [entry] } = await clientOrPool.query(
    `SELECT b.user_id FROM food_restaurants fr
     JOIN businesses b ON b.id = fr.business_id WHERE fr.id = $1`,
    [row.scope_restaurant_id]);
  return entry ? String(entry.user_id) : null;
}

// Server-side authorization, re-run on every request. Never accept an owner
// or account id from the body or query: the document id in the path is the
// only lookup key. It may name a credit original, a settlement original, or
// a published amendment version; versions are authorized as the original's
// owner. Unknown or foreign documents return 404 so ownership cannot be
// probed.
async function loadAuthorizedDocument(req) {
  const { documentId, language } = req.params;
  if (!UUID_PATTERN.test(String(documentId || ''))) fail('statement_invalid_document', 'Invalid statement document', 400);
  if (!LANGUAGES.has(language)) fail('statement_unsupported_language', 'Unsupported statement language', 400);
  const customerId = req.user && req.user.id;
  if (!customerId) fail('statement_unauthorized', 'Authentication required', 401);

  // 1. Credit original.
  const { rows: [credit] } = await pool.query(
    `SELECT id, customer_id, product, account_id, currency_code,
            period_from::text AS period_from, period_to::text AS period_to,
            generated_at, document, content_hash
     FROM credit_statement_documents WHERE id = $1`,
    [documentId]);
  if (credit) {
    // 404 for foreign documents: ownership is not probeable.
    if (String(credit.customer_id) !== String(customerId)) {
      fail('statement_not_found', 'Statement not found', 404);
    }
    if (!CREDIT_PRODUCTS.has(credit.product)) fail('statement_invalid', 'Invalid statement', 500);
    return { kind: 'original', archive: 'credit', row: credit, language, document: credit.document };
  }

  // 2. Settlement original (688 archive): scope-based standing, content hash
  // verified like the archive route.
  const { rows: [settlement] } = await pool.query(
    `SELECT id, product, scope_restaurant_id, scope_business_id, scope_helper_user_id,
            currency_code, period_from::text AS period_from, period_to::text AS period_to,
            generated_at, document, content_hash
     FROM settlement_statement_documents WHERE id = $1`,
    [documentId]);
  if (settlement) {
    // assertScopeStanding throws 404 for unauthorized scopes so document
    // existence cannot be enumerated.
    await assertScopeStanding(customerId, settlement.product, settlementScopeId(settlement));
    if (hashSettlementDocument(settlement.document) !== settlement.content_hash
        || settlement.document?.contentHash !== settlement.content_hash) {
      fail('statement_integrity_failed', 'Statement verification failed', 409);
    }
    return { kind: 'original', archive: 'settlement', row: settlement, language, document: settlement.document };
  }

  // 3. Published amendment version: authorized as the original's owner.
  const { rows: [version] } = await pool.query(
    `SELECT id, original_document_id, settlement_original_document_id, artifact_id,
            document, content_hash, revision_number
     FROM statement_amendment_versions WHERE id = $1`,
    [documentId]);
  if (version) {
    if (version.settlement_original_document_id) {
      const { rows: [srow] } = await pool.query(
        `SELECT product, scope_restaurant_id, scope_business_id, scope_helper_user_id
         FROM settlement_statement_documents WHERE id = $1`,
        [version.settlement_original_document_id]);
      if (!srow) fail('statement_not_found', 'Statement not found', 404);
      await assertScopeStanding(customerId, srow.product, settlementScopeId(srow));
    } else if (version.original_document_id) {
      const { rows: [crow] } = await pool.query(
        'SELECT product, customer_id FROM credit_statement_documents WHERE id = $1',
        [version.original_document_id]);
      if (!crow || String(crow.customer_id) !== String(customerId)) {
        fail('statement_not_found', 'Statement not found', 404);
      }
    } else {
      fail('statement_not_found', 'Statement not found', 404);
    }
    return {
      kind: 'version',
      archive: version.settlement_original_document_id ? 'settlement' : 'credit',
      row: version,
      originalDocumentId: version.settlement_original_document_id || version.original_document_id,
      language,
      document: version.document,
    };
  }

  fail('statement_not_found', 'Statement not found', 404);
}

async function resolveSnapshotId(authorized) {
  // Backward compatibility: a bare credit_statement_documents row (the
  // pre-settlement signature) is treated as a credit original.
  const auth = authorized && authorized.row && (authorized.kind || authorized.archive)
    ? authorized
    : { kind: 'original', archive: 'credit', row: authorized };
  const { kind, archive, row } = auth;
  const client = await pool.connect();
  try {
    if (kind === 'version') {
      // The amended artifact was published from the snapshot used to build
      // the envelope; link the rendition to that snapshot.
      const { rows: [art] } = await client.query(
        'SELECT snapshot_id FROM statement_artifacts WHERE id = $1', [row.artifact_id]);
      return art && art.snapshot_id ? art.snapshot_id : null;
    }
    const linkColumn = archive === 'settlement' ? 'settlement_document_id' : 'document_id';
    const { rows: [original] } = await client.query(
      `SELECT snapshot_id FROM statement_artifacts
       WHERE ${linkColumn} = $1 AND kind = 'original' AND state <> 'failed'
       ORDER BY created_at DESC LIMIT 1`,
      [row.id]);
    if (original) return original.snapshot_id;

    // Deterministic issuance-key fallback (idempotent, money-neutral).
    let accountId;
    let customerId;
    if (archive === 'settlement') {
      const scope = settlementScopeId(row);
      if (row.product === 'helper_earnings') {
        accountId = String(scope).toLowerCase();
      } else {
        accountId = Number(scope);
      }
      customerId = await settlementRecipientId(client, row);
      if (!customerId) return null;
    } else {
      accountId = Number(row.account_id);
      if (row.product === 'restaurant') {
        const { rows: [wallet] } = await client.query(
          'SELECT restaurant_id FROM food_customer_wallet_accounts WHERE id = $1', [row.account_id]);
        if (!wallet) return null;
        accountId = Number(wallet.restaurant_id);
      }
      customerId = String(row.customer_id);
    }
    if (accountId === null || accountId === undefined) return null;
    if (typeof accountId === 'number' && (!Number.isSafeInteger(accountId) || accountId <= 0)) return null;
    const periodFrom = sqlDate(row.period_from);
    const periodTo = sqlDate(row.period_to);
    const issuanceKey = `stmt:v1:${row.product}:${accountId}:${row.currency_code}:${periodFrom}:${periodTo}:${customerId}`;
    const existing = await getSnapshot(issuanceKey);
    if (existing) return existing.id;
    // Idempotent, money-neutral freeze from the source records. Closed
    // monthly periods reproduce the archived document; anything else throws
    // and the rendition is refused below.
    try {
      const frozen = await freezeSnapshot({
        issuanceKey, product: row.product, accountId,
        currency: row.currency_code, periodFrom, periodTo, customerId,
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

async function recordRendition({ snapshotId, documentId, settlementDocumentId, language, mediaType, bytes }) {
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
        (id, snapshot_id, document_id, settlement_document_id, kind, language, renderer_version, template_version,
         font_version, byte_length, sha256, media_type, object_key, state, created_at)
       VALUES ($1,$2,$3,$4,'rendition',$5,$6,$7,$8,$9,$10,$11,$12,'staged', transaction_timestamp())
       RETURNING *`,
      [crypto.randomUUID(), snapshotId, documentId || null, settlementDocumentId || null,
        language, versions.rendererVersion, versions.templateVersion, versions.fontVersion,
        String(bytes.length), hash, mediaType, objectKey]);
    return row;
  } finally {
    client.release();
  }
}

function downloadName(authorized, language, extension) {
  const { kind, archive, row, document } = authorized;
  // Version rows carry no period columns; the envelope's period is the
  // statement period.
  const periodFrom = kind === 'version'
    ? sqlDate(document && document.period && document.period.from)
    : sqlDate(row.period_from);
  const periodTo = kind === 'version'
    ? sqlDate(document && document.period && document.period.to)
    : sqlDate(row.period_to);
  const product = archive === 'settlement' ? `${row.product || (document && document.product) || 'statement'}-` : '';
  return `accessible-statement-${product}${periodFrom}-to-${periodTo}-${language}.${extension}`;
}

async function csvRecoveryUrl(authorized, language) {
  const { kind, archive, row } = authorized;
  if (kind === 'version') return null;
  const params = new URLSearchParams({
    from: sqlDate(row.period_from),
    to: sqlDate(row.period_to),
    currencyCode: row.currency_code,
    language,
  });
  if (archive === 'settlement') {
    // The settlement archive's CSV export; mounted by the coordinator at
    // /api/settlement-statements (see server/index.js).
    return `/api/settlement-statements/archive/${row.id}.csv?${params}`;
  }
  if (row.product === 'oxsteed') return `/oxsteed-credit/documents.csv?${params}`;
  const { rows: [wallet] } = await pool.query(
    'SELECT restaurant_id FROM food_customer_wallet_accounts WHERE id = $1', [row.account_id]);
  if (!wallet) return null;
  return `/food/customer/wallets/${encodeURIComponent(String(wallet.restaurant_id))}/statements.csv?${params}`;
}

function noStore(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
}

function renderHtml(document, language) {
  // The PDF worker dispatches on document.product itself; the HTML renderer
  // needs an explicit dispatch.
  return SETTLEMENT_PRODUCTS.has(document && document.product)
    ? renderSettlementStatementHtml(document, { language })
    : renderStatementHtml(document, { language });
}

async function handleRendition(req, res, next, format) {
  let authorized = null;
  try {
    noStore(res);
    authorized = await loadAuthorizedDocument(req);
    const { language, document } = authorized;
    const mediaType = format === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8';

    const bytes = await withDbBudget('exports', async () => {
      if (format === 'pdf') {
        // The worker dispatches to the settlement tagged-PDF renderer for
        // settlement products and labels amended versions as such.
        const pdf = await renderStatementPdfInWorker(document, { language });
        if (pdf.length > MAX_PDF_BYTES) fail('statement_export_too_large', 'Statement export is too large', 409);
        return pdf;
      }
      const html = renderHtml(document, language);
      const buffer = Buffer.from(html, 'utf8');
      if (buffer.length > MAX_HTML_BYTES) fail('statement_export_too_large', 'Statement export is too large', 409);
      return buffer;
    });

    const snapshotId = await resolveSnapshotId(authorized);
    if (!snapshotId) {
      fail('statement_rendition_unavailable',
        'An accessible rendition is not available for this statement yet; use the standard PDF or CSV export', 409);
    }
    // Version renditions link to the original they amend, so the archive
    // keeps one document lineage per rendition row.
    const originalId = authorized.kind === 'version' ? authorized.originalDocumentId : authorized.row.id;
    await recordRendition({
      snapshotId,
      documentId: authorized.archive === 'settlement' ? null : originalId,
      settlementDocumentId: authorized.archive === 'settlement' ? originalId : null,
      language,
      mediaType,
      bytes,
    });

    res.set('Content-Language', language);
    if (format === 'pdf') {
      res.set('Content-Disposition', `attachment; filename="${downloadName(authorized, language, 'pdf')}"`);
      res.type('application/pdf');
      return res.send(bytes);
    }
    // The HTML rendition is the readable equivalent-access option: served
    // inline so screen readers and browser reading tools can use it directly.
    res.set('Content-Disposition', `inline; filename="${downloadName(authorized, language, 'html')}"`);
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
            csv: await csvRecoveryUrl(authorized, language),
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
module.exports.renderHtml = renderHtml;
