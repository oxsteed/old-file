'use strict';

// Workstream 2: statement archive (issued monthly originals) + private
// original artifacts.
//
// Self-contained Express router. It is NOT mounted here; the coordinator
// mounts it (see the report for the exact mount line). Every read/download
// re-authorizes the requester against credit_statement_documents with a
// server-side customer_id = req.user.id predicate; document IDs and object
// keys alone never grant access. Restaurant-product rows additionally require
// the requester to be the wallet customer or an owner/active member of the
// restaurant's business (same membership shape as requireRestaurantAccess in
// controllers/foodController.js).
//
// Safety rules:
// - Issued originals are append-only; renditions never overwrite an original.
// - Only artifacts in state 'ready' are ever served. A download attempt never
//   promotes an artifact to ready and never deletes stored evidence.
// - No PII in URLs, object keys or download filenames; bytes are streamed or
//   handed out through short-lived signed URLs only. Signed-URL TTLs are
//   clamped to 60..3600 seconds and the TTL is returned to the client.
// - Responses carry private, no-store headers. Range requests are not
//   supported by the storage interface, so they are served as full 200
//   responses with Accept-Ranges: none (an interrupted download never marks
//   anything ready).

const express = require('express');
const crypto = require('crypto');
const { Readable } = require('stream');
const pool = require('../db');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { authenticate, requireRole } = require('../middleware/auth');
const { creditExportLimiter } = require('../middleware/rateLimiter');
const { getDownloadStream, createSignedUrl } = require('../services/statementArtifactService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTS = new Set(['oxsteed', 'restaurant']);
const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_PER_PAGE = 100;
const DEFAULT_PER_PAGE = 20;
const RENDITION_LABEL_PATTERN = /^[a-z0-9-]{1,40}$/;

function noStoreArchiveResponse(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function documentIdOr404(value) {
  // Tampered or malformed IDs are indistinguishable from missing ones: 404
  // with no indication of what exists.
  if (!UUID_PATTERN.test(String(value || ''))) {
    throw new AppError('Statement document not found', 404, 'statement_document_not_found');
  }
  return String(value).toLowerCase();
}

// Record-level authorization: the document must belong to the requester.
// Returns the document row; throws 404 otherwise (no leakage about other
// customers' documents).
async function requireOwnedDocument(documentId, userId) {
  const { rows: [document] } = await pool.query(
    `SELECT id, customer_id, product, account_id, currency_code,
            period_from, period_to, generated_at, document, content_hash
       FROM credit_statement_documents
      WHERE id = $1 AND customer_id = $2`,
    [documentId, userId]);
  if (!document) {
    throw new AppError('Statement document not found', 404, 'statement_document_not_found');
  }
  return document;
}

// For restaurant-product documents, the requester must additionally have
// standing with the restaurant account: either they own the wallet the
// document was issued for, or they are an owner / active member of the
// restaurant's business (membership shape mirrors requireRestaurantAccess).
async function assertRestaurantAccountStanding(userId, walletAccountId) {
  const { rows } = await pool.query(
    `SELECT a.customer_id AS wallet_customer_id,
            CASE
              WHEN b.user_id = $1 OR fr.owner_user_id = $1 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $1
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_customer_wallet_accounts a
       JOIN food_restaurants fr ON fr.id = a.restaurant_id
       JOIN businesses b ON b.id = fr.business_id
      WHERE a.id = $2`,
    [userId, walletAccountId]);
  const row = rows[0];
  const isWalletCustomer = row && String(row.wallet_customer_id) === String(userId);
  if (!row || (!isWalletCustomer && !row.effective_role)) {
    throw new AppError('Statement document not found', 404, 'statement_document_not_found');
  }
  return row;
}

async function requireAuthorizedDocument(documentId, userId) {
  const document = await requireOwnedDocument(documentId, userId);
  if (document.product === 'restaurant') {
    await assertRestaurantAccountStanding(userId, document.account_id);
  }
  return document;
}

function labelFromObjectKey(objectKey) {
  const match = String(objectKey || '').match(/\/renditions\/([a-z0-9-]{1,40})\//);
  return match ? match[1] : null;
}

function shapeArtifact(row) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.kind === 'rendition' ? labelFromObjectKey(row.object_key) : null,
    language: row.language,
    state: row.state,
    byteLength: Number(row.byte_length),
    sha256: row.sha256,
    mediaType: row.media_type,
    rendererVersion: row.renderer_version,
    templateVersion: row.template_version,
    fontVersion: row.font_version,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// All artifacts attached to a document: the issued original(s) plus any
// labeled renditions that share the original's snapshot.
async function listDocumentArtifacts(documentId) {
  const { rows } = await pool.query(
    `SELECT a.* FROM statement_artifacts a
      WHERE a.document_id = $1
         OR a.snapshot_id IN (SELECT snapshot_id FROM statement_artifacts WHERE document_id = $1)
      ORDER BY a.kind, a.language, a.created_at`,
    [documentId]);
  return rows.map(shapeArtifact);
}

function readyLanguages(artifacts, kind) {
  const languages = new Set();
  for (const artifact of artifacts) {
    if (artifact.kind === kind && artifact.state === 'ready') languages.add(artifact.language);
  }
  return [...languages].sort();
}

function shapeArchiveItem(document, artifacts) {
  const payload = document.document || {};
  const readyOriginalLanguages = readyLanguages(artifacts, 'original');
  const readyRenditionLanguages = readyLanguages(artifacts, 'rendition');
  const downloadable = readyOriginalLanguages.length > 0 || readyRenditionLanguages.length > 0;
  const pending = artifacts.some((artifact) => ['staged', 'verifying'].includes(artifact.state));
  return {
    id: document.id,
    product: document.product,
    accountId: Number(document.account_id),
    currency: document.currency_code,
    period: {
      from: new Date(document.period_from).toISOString().slice(0, 10),
      to: new Date(document.period_to).toISOString().slice(0, 10),
    },
    issuedAt: new Date(document.generated_at).toISOString(),
    // Issued documents are immutable and unique per
    // (customer, product, account, currency, period); the stored payload
    // carries its revision. Corrections post through the authoritative
    // ledgers and re-render as separate labeled renditions, never by editing
    // the issued original.
    revision: Number.isSafeInteger(payload.version) ? payload.version : 1,
    corrected: Boolean(payload.corrected || payload.supersedes),
    superseded: false,
    languages: [...new Set([...readyOriginalLanguages, ...readyRenditionLanguages])].sort(),
    readiness: readyOriginalLanguages.length > 0 ? 'ready' : 'pending',
    downloadStatus: downloadable ? 'available' : pending ? 'pending' : 'unavailable',
    contentHash: document.content_hash,
  };
}

function shapeArchiveDetail(document, artifacts) {
  const item = shapeArchiveItem(document, artifacts);
  const payload = document.document || {};
  const asMinor = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  return {
    ...item,
    totals: {
      openingMinor: asMinor(payload.openingBalanceCents),
      creditsMinor: asMinor(payload.totalCreditsCents),
      debitsMinor: asMinor(payload.totalDebitsCents),
      closingMinor: asMinor(payload.closingBalanceCents),
      transactionCount: Number.isSafeInteger(payload.transactionCount) ? payload.transactionCount : null,
    },
    artifacts: {
      originals: artifacts.filter((artifact) => artifact.kind === 'original'),
      renditions: artifacts.filter((artifact) => artifact.kind === 'rendition'),
    },
  };
}

// Picks the artifact to serve: a ready original in the requested language
// (falling back to a ready original in any language), or a ready rendition
// when kind=rendition with an explicit label. Never returns original bytes
// for a rendition request.
function selectServableArtifact(artifacts, { kind = 'original', language = 'en', label = null }) {
  const ready = artifacts.filter((artifact) => artifact.state === 'ready');
  if (kind === 'rendition') {
    if (!label || !RENDITION_LABEL_PATTERN.test(label)) {
      throw new AppError('A rendition label is required', 400, 'statement_archive_invalid_label');
    }
    const match = ready.find((artifact) => artifact.kind === 'rendition'
      && artifact.label === label && artifact.language === language)
      || ready.find((artifact) => artifact.kind === 'rendition' && artifact.label === label);
    if (!match) {
      throw new AppError(
        'This statement rendition is not ready for download yet. It is still being prepared; please try again later.',
        409,
        'statement_artifact_not_ready',
      );
    }
    return match;
  }
  const match = ready.find((artifact) => artifact.kind === 'original' && artifact.language === language)
    || ready.find((artifact) => artifact.kind === 'original' && artifact.language === 'en')
    || ready.find((artifact) => artifact.kind === 'original');
  if (!match) {
    throw new AppError(
      'This statement file is not ready for download yet. It is still being prepared; please try again later.',
      409,
      'statement_artifact_not_ready',
    );
  }
  return match;
}

// Defensive freshness check on a minted signed URL: if the provider embeds an
// expiry the client can read (the local backend's ?exp= scheme), refuse to
// hand out a link that is already dead.
function assertSignedUrlFresh(url) {
  let parsed = null;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new AppError('The download link could not be created. Please try again.', 502, 'statement_signed_url_invalid');
  }
  const exp = parsed.searchParams.get('exp');
  if (exp !== null) {
    const expiry = Number.parseInt(exp, 10);
    if (!Number.isFinite(expiry) || expiry * 1000 <= Date.now()) {
      throw new AppError(
        'The download link expired before it could be used. Your statement record is preserved; please request a new link.',
        502,
        'statement_signed_url_expired',
      );
    }
  }
  return url;
}

function downloadFilename(document, mediaType) {
  const from = new Date(document.period_from).toISOString().slice(0, 10);
  const to = new Date(document.period_to).toISOString().slice(0, 10);
  // No PII: product, period and currency identify the statement, never the holder.
  const extension = String(mediaType || '').includes('pdf') ? 'pdf' : 'bin';
  return `credit-statement-${document.product}-${from}-${to}.${extension}`;
}

function createStatementArchiveRouter({ storage } = {}) {
  const router = express.Router();

  router.use(authenticate, requireRole('customer'), noStoreArchiveResponse);

  // Paginated archive of issued monthly originals. Record-level authorization
  // is the customer_id predicate; restaurant rows additionally require
  // restaurant standing (see the detail route).
  router.get('/archive', async (req, res, next) => {
    try {
      const { product, accountId, currency, year, month } = req.query;
      const filters = [];
      const params = [req.user.id];
      if (product !== undefined) {
        if (!PRODUCTS.has(String(product))) {
          throw new AppError('Invalid statement product', 400, 'statement_archive_invalid_product');
        }
        params.push(String(product));
        filters.push(`d.product = $${params.length}`);
      }
      if (accountId !== undefined) {
        const parsed = parsePositiveInt(accountId, null);
        if (parsed === null) throw new AppError('Invalid statement account', 400, 'statement_archive_invalid_account');
        params.push(String(parsed));
        filters.push(`d.account_id = $${params.length}`);
      }
      if (currency !== undefined) {
        const code = String(currency).toUpperCase();
        if (!CURRENCY_PATTERN.test(code)) throw new AppError('Invalid currency', 400, 'statement_archive_invalid_currency');
        params.push(code);
        filters.push(`d.currency_code = $${params.length}`);
      }
      if (year !== undefined || month !== undefined) {
        const parsedYear = parsePositiveInt(year, null);
        const parsedMonth = month === undefined ? null : parsePositiveInt(month, null);
        if (parsedYear === null || parsedYear < 2000 || parsedYear > 2100
          || (month !== undefined && (parsedMonth === null || parsedMonth < 1 || parsedMonth > 12))) {
          throw new AppError('Invalid statement period filter', 400, 'statement_archive_invalid_period');
        }
        params.push(parsedYear);
        filters.push(`EXTRACT(YEAR FROM d.period_from) = $${params.length}`);
        if (parsedMonth !== null) {
          params.push(parsedMonth);
          filters.push(`EXTRACT(MONTH FROM d.period_from) = $${params.length}`);
        }
      }
      // Restaurant rows additionally require wallet ownership or restaurant
      // membership; the customer_id predicate below already scopes to the
      // requester's own wallet rows. Parenthesized: AND binds tighter than
      // OR, so without the parens the EXISTS clause would leak rows.
      filters.push(`(d.product <> 'restaurant' OR EXISTS (
        SELECT 1 FROM food_customer_wallet_accounts a
        JOIN food_restaurants fr ON fr.id = a.restaurant_id
        JOIN businesses b ON b.id = fr.business_id
        LEFT JOIN business_members bm
          ON bm.business_id = fr.business_id AND bm.member_id = d.customer_id AND bm.status = 'active'
        WHERE a.id = d.account_id
          AND (a.customer_id = d.customer_id OR b.user_id = d.customer_id
               OR fr.owner_user_id = d.customer_id OR bm.member_id IS NOT NULL)
      ))`);

      const perPage = Math.min(MAX_PER_PAGE, Math.max(1, parsePositiveInt(req.query.per_page, DEFAULT_PER_PAGE)));
      const page = Math.max(1, parsePositiveInt(req.query.page, 1));
      const offset = (page - 1) * perPage;
      const where = `WHERE d.customer_id = $1${filters.length ? ` AND ${filters.join(' AND ')}` : ''}`;
      const order = 'ORDER BY d.period_to DESC, d.period_from DESC, d.generated_at DESC';

      const { rows: [{ total }] } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM credit_statement_documents d ${where}`, params);
      const { rows: documents } = await pool.query(
        `SELECT d.id, d.product, d.account_id, d.currency_code, d.period_from,
                d.period_to, d.generated_at, d.document, d.content_hash
           FROM credit_statement_documents d ${where} ${order}
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, perPage, offset]);

      const artifactsByDocument = new Map();
      if (documents.length) {
        const documentIds = documents.map((document) => document.id);
        const { rows: artifacts } = await pool.query(
          `SELECT a.*, link.document_id AS owner_document_id
             FROM statement_artifacts a
             JOIN (SELECT DISTINCT document_id, snapshot_id FROM statement_artifacts
                    WHERE document_id = ANY($1)) link
               ON link.snapshot_id = a.snapshot_id`,
          [documentIds]);
        for (const row of artifacts) {
          const key = row.owner_document_id;
          if (!artifactsByDocument.has(key)) artifactsByDocument.set(key, []);
          artifactsByDocument.get(key).push(shapeArtifact(row));
        }
      }

      const items = documents.map((document) => shapeArchiveItem(document, artifactsByDocument.get(document.id) || []));
      res.json({
        items,
        page,
        perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / perPage)),
      });
    } catch (error) { next(error); }
  });

  // Immutable revision metadata + the original/rendition artifact list.
  router.get('/archive/:documentId', async (req, res, next) => {
    try {
      const documentId = documentIdOr404(req.params.documentId);
      const document = await requireAuthorizedDocument(documentId, req.user.id);
      const artifacts = await listDocumentArtifacts(documentId);
      res.json({ document: shapeArchiveDetail(document, artifacts) });
    } catch (error) { next(error); }
  });

  async function resolveServableArtifact(req) {
    const documentId = documentIdOr404(req.params.documentId);
    const document = await requireAuthorizedDocument(documentId, req.user.id);
    const language = req.query.language === undefined ? 'en' : String(req.query.language);
    if (!LANGUAGES.includes(language)) {
      throw new AppError('Unsupported statement language', 400, 'statement_archive_invalid_language');
    }
    const kind = req.query.kind === undefined ? 'original' : String(req.query.kind);
    if (!['original', 'rendition'].includes(kind)) {
      throw new AppError('Invalid statement artifact kind', 400, 'statement_archive_invalid_kind');
    }
    const label = req.query.label === undefined ? null : String(req.query.label);
    const artifacts = await listDocumentArtifacts(documentId);
    return { document, artifact: selectServableArtifact(artifacts, { kind, language, label }) };
  }

  // Stream the bytes of a ready artifact. Re-authorizes on every call;
  // incomplete artifacts are never served; a failed download never promotes
  // an artifact to ready and never deletes evidence.
  router.get('/archive/:documentId/download', creditExportLimiter, async (req, res, next) => {
    try {
      const { document, artifact } = await resolveServableArtifact(req);
      let download;
      try {
        download = await getDownloadStream({ artifactId: artifact.id, actor: req.user, storage });
      } catch (error) {
        if (error instanceof AppError && error.status === 502) {
          // Missing or unreadable stored object: 502 with recovery guidance.
          // State is untouched and nothing is deleted; the record survives.
          throw new AppError(
            'The statement file is temporarily unavailable. Your statement record is preserved and nothing was deleted. Please try again, or contact support if this persists.',
            502,
            'statement_artifact_unavailable',
          );
        }
        throw error;
      }
      const stream = download.stream instanceof Readable ? download.stream : Readable.from(download.stream);
      res.set('Content-Type', download.mediaType || 'application/pdf');
      res.set('Content-Length', String(download.byteLength));
      // Range requests are not supported by the storage interface; serve the
      // full object as 200 with Accept-Ranges: none rather than a partial
      // response. An interrupted download never marks anything ready.
      res.set('Accept-Ranges', 'none');
      res.set('Content-Disposition', `attachment; filename="${downloadFilename(document, download.mediaType)}"`);
      res.set('Cache-Control', 'private, no-store');
      res.set('Pragma', 'no-cache');
      if (req.headers.range) {
        logger.info('statement_archive_range_ignored', { documentId: document.id, artifactId: artifact.id });
      }
      stream.on('error', (streamError) => {
        logger.warn('statement archive download stream failed', {
          documentId: document.id, artifactId: artifact.id, error: streamError.message,
        });
        if (!res.headersSent) {
          res.status(502).json({
            error: 'The statement download was interrupted. Your statement record is preserved; please try again.',
            code: 'statement_artifact_unavailable',
          });
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
    } catch (error) { next(error); }
  });

  // Short-lived signed URL for an authorized download. The TTL is returned so
  // the client can communicate expiry honestly; links are single-purpose and
  // must not be stored or shared.
  router.get('/archive/:documentId/link', creditExportLimiter, async (req, res, next) => {
    try {
      const { artifact } = await resolveServableArtifact(req);
      const requestedTtl = req.query.ttlSeconds === undefined ? undefined : Number(req.query.ttlSeconds);
      const signed = await createSignedUrl({
        artifactId: artifact.id,
        actor: req.user,
        ...(requestedTtl === undefined ? {} : { ttlSeconds: requestedTtl }),
        storage,
      });
      assertSignedUrlFresh(signed.url);
      res.json({
        url: signed.url,
        ttlSeconds: signed.ttlSeconds,
        expiresAt: signed.expiresAt,
        // Documented for the client: the link stops working at expiresAt;
        // request a new one instead of retrying a stale URL.
        note: `This download link expires at ${signed.expiresAt} and must not be stored or shared.`,
      });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = createStatementArchiveRouter;
module.exports.createStatementArchiveRouter = createStatementArchiveRouter;
