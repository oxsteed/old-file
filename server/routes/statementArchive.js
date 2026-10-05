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
const { authenticate } = require('../middleware/auth');
const { creditExportLimiter } = require('../middleware/rateLimiter');
const { getDownloadStream, createSignedUrl } = require('../services/statementArtifactService');
const { assertScopeStanding } = require('./settlementStatementArchive');
const { hashDocument } = require('../services/creditStatementService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTLEMENT_PRODUCTS = new Set(['restaurant_settlement', 'helper_earnings', 'business']);
const PRODUCTS = new Set(['oxsteed', 'restaurant', ...SETTLEMENT_PRODUCTS]);
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

function settlementAccount(row) {
  return row.scope_restaurant_id ?? row.scope_business_id ?? row.scope_helper_user_id;
}

function normalizeSettlementRow(row) {
  return { ...row, account_id: settlementAccount(row), archive: 'settlement' };
}

function verifyDocument(row) {
  if (!row.document || row.document.contentHash !== row.content_hash
      || hashDocument(row.document) !== row.content_hash) {
    throw new AppError('Statement verification failed', 409, 'statement_integrity_failed');
  }
  return row;
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
      WHERE a.document_id = $1 OR a.settlement_document_id = $1
         OR a.snapshot_id IN (SELECT snapshot_id FROM statement_artifacts
                              WHERE document_id = $1 OR settlement_document_id = $1)
      ORDER BY a.kind, a.language, a.created_at, a.id`,
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

function shapeArchiveItem(document, artifacts, amendmentInfo = {}) {
  const payload = document.document || {};
  const readyOriginalLanguages = readyLanguages(artifacts, 'original');
  const readyRenditionLanguages = readyLanguages(artifacts, 'rendition');
  const downloadable = readyOriginalLanguages.length > 0 || readyRenditionLanguages.length > 0;
  const pending = artifacts.some((artifact) => ['staged', 'verifying'].includes(artifact.state));
  // Amendment versions for this original, oldest revision first. The original
  // row is never edited: supersession is derived from the versions table.
  const versions = Array.isArray(amendmentInfo.versions) ? amendmentInfo.versions : [];
  const adminNames = amendmentInfo.adminNames instanceof Map ? amendmentInfo.adminNames : new Map();
  const latest = versions.length > 0 ? versions[versions.length - 1] : null;
  const latestEnvelope = (latest && latest.document && latest.document.amendment) || {};
  return {
    id: document.id,
    kind: 'original',
    product: document.product,
    accountId: document.product === 'helper_earnings' ? String(document.account_id) : Number(document.account_id),
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
    revision: 1,
    schemaVersion: Number.isSafeInteger(payload.version) ? payload.version : 1,
    corrected: Boolean(payload.corrected || payload.supersedes) || versions.length > 0,
    // An original with published amendment versions stays downloadable and is
    // clearly marked superseded, with the reason, approver, time and a link
    // to the latest version.
    superseded: versions.length > 0,
    supersession: latest ? {
      latestRevision: Number(latest.revision_number) + 1,
      latestVersionId: latest.id,
      amendmentType: latest.amendment_type,
      reason: latestEnvelope.reason || null,
      decidedBy: latestEnvelope.decidedBy || null,
      decidedByName: adminNames.get(latestEnvelope.decidedBy) || null,
      decidedAt: latestEnvelope.decidedAt || null,
      continuityStatus: latest.continuity_status,
    } : null,
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
      openingMinor: asMinor(payload.openingBalanceCents ?? payload.openingPayableCents ?? payload.receivables?.openingOutstandingCents),
      creditsMinor: asMinor(payload.totalCreditsCents ?? payload.postedEarningsCents ?? payload.receivables?.invoicedCents),
      debitsMinor: asMinor(payload.totalDebitsCents ?? (payload.product === 'helper_earnings'
        ? payload.settledPayoutsCents + payload.statusRemovalsCents
        : payload.receivables ? payload.receivables.collectedOrAdjustedCents + payload.receivables.cancelledCents : undefined)),
      closingMinor: asMinor(payload.closingBalanceCents ?? payload.closingPayableCents ?? payload.receivables?.closingOutstandingCents),
      transactionCount: payload.transactionCount ?? payload.earningsCount ?? payload.receivables?.invoiceCount ?? null,
    },
    artifacts: {
      originals: artifacts.filter((artifact) => artifact.kind === 'original'),
      renditions: artifacts.filter((artifact) => artifact.kind === 'rendition'),
    },
  };
}

// ── Amendment versions in the archive (Phase 4, workstream 3) ───────────────
// Amended versions appear alongside the original: each version is its own
// archive entry (kind 'amendment') carrying the amendment envelope
// (original/adjustment/revised totals, reason, approver, continuity
// disclosure). Ownership derives from the original document, so the same
// customer and restaurant-standing checks apply.

// Display names for amendment approvers. Admin UUIDs are never exposed as
// the display value; the name (or email fallback) is resolved server-side.
async function resolveAdminNames(adminIds) {
  const ids = [...new Set((adminIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), email) AS display_name
     FROM users WHERE id = ANY($1)`,
    [ids]);
  return new Map(rows.map((row) => [String(row.id), row.display_name]));
}

// Versions (with their proposal decision metadata and published artifact)
// for a set of original document ids, ordered oldest revision first.
async function attachAmendmentVersions(documentIds) {
  const versionsByOriginal = new Map();
  const artifactsByVersion = new Map();
  if (!documentIds.length) return { versionsByOriginal, artifactsByVersion, adminNames: new Map() };
  const { rows: versions } = await pool.query(
    `SELECT v.* FROM statement_amendment_versions v
     WHERE v.original_document_id = ANY($1) OR v.settlement_original_document_id = ANY($1)
     ORDER BY COALESCE(v.original_document_id, v.settlement_original_document_id), v.revision_number ASC, v.id`,
    [documentIds]);
  const decidedByIds = [];
  for (const version of versions) {
    const key = version.settlement_original_document_id || version.original_document_id;
    if (!versionsByOriginal.has(key)) versionsByOriginal.set(key, []);
    versionsByOriginal.get(key).push(version);
    const decidedBy = version.document && version.document.amendment && version.document.amendment.decidedBy;
    if (decidedBy) decidedByIds.push(decidedBy);
  }
  if (versions.length) {
    const versionIds = versions.map((version) => version.id);
    const { rows: artifacts } = await pool.query(
      `SELECT a.* FROM statement_artifacts a
       JOIN statement_amendment_versions v ON v.artifact_id = a.id
       WHERE v.id = ANY($1)`,
      [versionIds]);
    for (const row of artifacts) {
      const version = versions.find((v) => v.artifact_id === row.id);
      if (version) artifactsByVersion.set(version.id, shapeArtifact(row));
    }
  }
  const adminNames = await resolveAdminNames(decidedByIds);
  return { versionsByOriginal, artifactsByVersion, adminNames };
}

function shapeVersionItem(version, original, artifact, amendmentContext = {}) {
  const payload = (version.document && typeof version.document === 'object') ? version.document : {};
  const amendment = (payload.amendment && typeof payload.amendment === 'object') ? payload.amendment : {};
  const adminNames = amendmentContext.adminNames instanceof Map ? amendmentContext.adminNames : new Map();
  const superseded = Boolean(amendmentContext.superseded);
  const ready = Boolean(artifact) && artifact.state === 'ready';
  return {
    id: version.id,
    kind: 'amendment',
    product: original.product,
    accountId: original.product === 'helper_earnings' ? String(original.account_id) : Number(original.account_id),
    currency: original.currency_code,
    period: {
      from: new Date(original.period_from).toISOString().slice(0, 10),
      to: new Date(original.period_to).toISOString().slice(0, 10),
    },
    issuedAt: new Date(version.created_at).toISOString(),
    revision: Number(version.revision_number) + 1,
    corrected: true,
    superseded,
    languages: ready ? [artifact.language] : [],
    readiness: ready ? 'ready' : 'pending',
    downloadStatus: ready ? 'available' : 'pending',
    contentHash: version.content_hash,
    amendment: {
      revisionNumber: Number(version.revision_number),
      type: version.amendment_type,
      presentation: version.presentation,
      reason: amendment.reason || null,
      evidenceRefs: Array.isArray(amendment.evidenceRefs) ? amendment.evidenceRefs : [],
      proposedAt: amendment.proposedAt || null,
      decidedAt: amendment.decidedAt || null,
      decidedBy: amendment.decidedBy || null,
      decidedByName: adminNames.get(amendment.decidedBy) || null,
      decisionReason: amendment.decisionReason || null,
      originalDocumentId: version.settlement_original_document_id || version.original_document_id,
      supersedes: amendment.supersedes || payload.supersedes || null,
      totals: payload.totals || null,
      continuity: payload.continuity || null,
      artifactId: version.artifact_id || null,
      artifact: artifact || null,
    },
  };
}

async function nestedArchiveItem(document, artifacts, amendmentData) {
  const versions = amendmentData.versionsByOriginal.get(document.id) || [];
  return {
    ...shapeArchiveItem(document, artifacts, { versions, adminNames: amendmentData.adminNames }),
    versions: versions.map((version, index) => shapeVersionItem(version, document,
      amendmentData.artifactsByVersion.get(version.id) || null,
      { adminNames: amendmentData.adminNames, superseded: index < versions.length - 1 })),
    versionCount: versions.length,
  };
}

// Resolve an archive entry id to either an issued original or an amendment
// version. Version ownership derives from the original document: the same
// customer predicate and restaurant-standing checks apply, and unknown ids
// are indistinguishable from missing ones (404).
async function resolveArchiveEntry(documentId, userId) {
  const { rows: [original] } = await pool.query(
    `SELECT id, customer_id, product, account_id, currency_code,
            period_from, period_to, generated_at, document, content_hash
     FROM credit_statement_documents
     WHERE id = $1 AND customer_id = $2`,
    [documentId, userId]);
  if (original) {
    if (original.product === 'restaurant') {
      await assertRestaurantAccountStanding(userId, original.account_id);
    }
    return { kind: 'original', document: verifyDocument(original), version: null };
  }
  const { rows: [settlement] } = await pool.query(
    'SELECT * FROM settlement_statement_documents WHERE id = $1', [documentId]);
  if (settlement) {
    await assertScopeStanding(userId, settlement.product, settlementAccount(settlement));
    return { kind: 'original', document: normalizeSettlementRow(verifyDocument(settlement)), version: null };
  }
  const { rows: [version] } = await pool.query(
    `SELECT v.*, d.customer_id, d.product, d.account_id, d.currency_code,
            d.period_from, d.period_to
     FROM statement_amendment_versions v
     JOIN credit_statement_documents d ON d.id = v.original_document_id
     WHERE v.id = $1 AND d.customer_id = $2`,
    [documentId, userId]);
  if (!version) {
    const { rows: [settlementVersion] } = await pool.query(
      `SELECT v.*, d.product, d.currency_code, d.period_from, d.period_to,
              d.scope_restaurant_id, d.scope_business_id, d.scope_helper_user_id
       FROM statement_amendment_versions v
       JOIN settlement_statement_documents d ON d.id = v.settlement_original_document_id
       WHERE v.id = $1`, [documentId]);
    if (!settlementVersion) throw new AppError('Statement document not found', 404, 'statement_document_not_found');
    await assertScopeStanding(userId, settlementVersion.product, settlementAccount(settlementVersion));
    const row = normalizeSettlementRow(verifyDocument(settlementVersion));
    return { kind: 'amendment', document: row, version: row };
  }
  if (version.product === 'restaurant') {
    await assertRestaurantAccountStanding(userId, version.account_id);
  }
  return { kind: 'amendment', document: verifyDocument(version), version };
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

function downloadFilename(document, mediaType, version) {
  const from = new Date(document.period_from).toISOString().slice(0, 10);
  const to = new Date(document.period_to).toISOString().slice(0, 10);
  // No PII: product, period and currency identify the statement, never the holder.
  // Amendment versions are marked so the two files are never confused.
  const amendmentSuffix = version ? `-amended-v${Number(version.revision_number)}` : '';
  const extension = String(mediaType || '').includes('pdf') ? 'pdf' : 'bin';
  return `credit-statement-${document.product}${amendmentSuffix}-${from}-${to}.${extension}`;
}

function createStatementArchiveRouter({ storage } = {}) {
  const router = express.Router();

  router.use(authenticate, noStoreArchiveResponse);

  // Discovery uses the same current owner/active-manager finance standing as
  // document access. Ordinary staff and former members receive no scopes.
  router.get('/scopes', async (req, res, next) => {
    try {
      const product = String(req.query.product || '');
      if (!SETTLEMENT_PRODUCTS.has(product)) throw new AppError('Invalid statement product', 400, 'statement_archive_invalid_product');
      if (product === 'helper_earnings') {
        return res.json({ accounts: [{ accountId: req.user.id, currencyCode: null, name: null }] });
      }
      const restaurant = product === 'restaurant_settlement';
      const { rows } = await pool.query(restaurant
        ? `SELECT fr.id AS account_id, fr.display_name AS name, fr.currency_code
           FROM food_restaurants fr JOIN businesses b ON b.id = fr.business_id
           WHERE b.user_id = $1 OR fr.owner_user_id = $1 OR EXISTS (
             SELECT 1 FROM business_members bm WHERE bm.business_id = b.id
             AND bm.member_id = $1 AND bm.status = 'active' AND bm.role = 'manager')
           ORDER BY fr.id LIMIT 100`
        : `SELECT b.id AS account_id, b.business_name AS name, b.currency_code
           FROM businesses b WHERE b.user_id = $1 OR EXISTS (
             SELECT 1 FROM business_members bm WHERE bm.business_id = b.id
             AND bm.member_id = $1 AND bm.status = 'active' AND bm.role = 'manager')
           ORDER BY b.id LIMIT 100`, [req.user.id]);
      res.json({ accounts: rows.map(row => ({ accountId: row.account_id, name: row.name, currencyCode: row.currency_code })) });
    } catch (error) { next(error); }
  });

  // Paginated archive of issued monthly originals. Record-level authorization
  // is the customer_id predicate; restaurant rows additionally require
  // restaurant standing (see the detail route).
  router.get('/archive', async (req, res, next) => {
    try {
      const { product, accountId, currency, year, month } = req.query;
      if (SETTLEMENT_PRODUCTS.has(String(product))) {
        const params = [String(product), req.user.id];
        const conditions = ['d.product = $1'];
        if (product === 'helper_earnings') conditions.push('d.scope_helper_user_id = $2');
        else if (product === 'business') conditions.push(`EXISTS (SELECT 1 FROM businesses b
          WHERE b.id = d.scope_business_id AND (b.user_id = $2 OR EXISTS (
            SELECT 1 FROM business_members bm WHERE bm.business_id = b.id AND bm.member_id = $2
            AND bm.status = 'active' AND bm.role = 'manager')))`);
        else conditions.push(`EXISTS (SELECT 1 FROM food_restaurants fr JOIN businesses b ON b.id = fr.business_id
          WHERE fr.id = d.scope_restaurant_id AND (fr.owner_user_id = $2 OR b.user_id = $2 OR EXISTS (
            SELECT 1 FROM business_members bm WHERE bm.business_id = b.id AND bm.member_id = $2
            AND bm.status = 'active' AND bm.role = 'manager')))`);
        if (accountId !== undefined) {
          if (product === 'helper_earnings' ? !UUID_PATTERN.test(String(accountId)) : !/^[1-9]\d*$/.test(String(accountId))) {
            throw new AppError('Invalid statement account', 400, 'statement_archive_invalid_account');
          }
          params.push(accountId);
          const column = product === 'helper_earnings' ? 'scope_helper_user_id' : product === 'business' ? 'scope_business_id' : 'scope_restaurant_id';
          conditions.push(`d.${column} = $${params.length}`);
        }
        if (currency !== undefined) {
          const code = String(currency).toUpperCase();
          if (!CURRENCY_PATTERN.test(code)) throw new AppError('Invalid currency', 400, 'statement_archive_invalid_currency');
          params.push(code); conditions.push(`d.currency_code = $${params.length}`);
        }
        if (year !== undefined || month !== undefined) {
          const y = parsePositiveInt(year, null); const m = month === undefined ? null : parsePositiveInt(month, null);
          if (!y || y < 2000 || y > 2100 || (month !== undefined && (!m || m > 12))) {
            throw new AppError('Invalid statement period filter', 400, 'statement_archive_invalid_period');
          }
          params.push(y); conditions.push(`EXTRACT(YEAR FROM d.period_from) = $${params.length}`);
          if (m) { params.push(m); conditions.push(`EXTRACT(MONTH FROM d.period_from) = $${params.length}`); }
        }
        const perPage = Math.min(MAX_PER_PAGE, Math.max(1, parsePositiveInt(req.query.per_page, DEFAULT_PER_PAGE)));
        const page = Math.max(1, parsePositiveInt(req.query.page, 1));
        const where = `WHERE ${conditions.join(' AND ')}`;
        const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM settlement_statement_documents d ${where}`, params);
        const { rows } = await pool.query(`SELECT d.* FROM settlement_statement_documents d ${where}
          ORDER BY d.period_to DESC, d.period_from DESC, d.generated_at DESC, d.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, perPage, (page - 1) * perPage]);
        const documents = rows.map(normalizeSettlementRow);
        const amendments = await attachAmendmentVersions(documents.map(row => row.id));
        const items = [];
        for (const document of documents) {
          items.push(await nestedArchiveItem(document, await listDocumentArtifacts(document.id), amendments));
        }
        return res.json({ items, page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)), paginationUnit: 'originals' });
      }
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
      const order = 'ORDER BY d.period_to DESC, d.period_from DESC, d.generated_at DESC, d.id DESC';

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

      // Paginate originals only; each original owns its complete version chain.
      // Counts, items, page size and navigation now describe one collection.
      const amendmentData = await attachAmendmentVersions(documents.map((document) => document.id));
      const items = [];
      for (const document of documents) {
        items.push(await nestedArchiveItem(document, artifactsByDocument.get(document.id) || [], amendmentData));
      }
      res.json({
        items,
        page,
        perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / perPage)),
        paginationUnit: 'originals',
      });
    } catch (error) { next(error); }
  });

  // Immutable revision metadata + the original/rendition artifact list.
  // Amendment version ids resolve to the version entry with its envelope.
  router.get('/archive/:documentId', async (req, res, next) => {
    try {
      const documentId = documentIdOr404(req.params.documentId);
      const entry = await resolveArchiveEntry(documentId, req.user.id);
      if (entry.kind === 'amendment') {
        const originalId = entry.version.settlement_original_document_id || entry.version.original_document_id;
        const amendmentData = await attachAmendmentVersions([originalId]);
        const supersededCount = (amendmentData.versionsByOriginal.get(originalId) || [])
          .filter(version => Number(version.revision_number) > Number(entry.version.revision_number)).length;
        res.json({
          document: shapeVersionItem(
            entry.version,
            entry.version,
            amendmentData.artifactsByVersion.get(entry.version.id) || null,
            { adminNames: amendmentData.adminNames, superseded: supersededCount > 0 }),
        });
        return;
      }
      const artifacts = await listDocumentArtifacts(documentId);
      const amendmentData = await attachAmendmentVersions([documentId]);
      const item = await nestedArchiveItem(entry.document, artifacts, amendmentData);
      res.json({ document: { ...shapeArchiveDetail(entry.document, artifacts), ...item } });
    } catch (error) { next(error); }
  });

  async function resolveServableArtifact(req) {
    const documentId = documentIdOr404(req.params.documentId);
    const language = req.query.language === undefined ? 'en' : String(req.query.language);
    if (!LANGUAGES.includes(language)) {
      throw new AppError('Unsupported statement language', 400, 'statement_archive_invalid_language');
    }
    const entry = await resolveArchiveEntry(documentId, req.user.id);
    if (entry.kind === 'amendment') {
      // An amendment version serves its own published artifact directly;
      // incomplete artifacts are never served.
      const notReady = new AppError(
        'This corrected statement file is not ready for download yet. It is still being prepared; please try again later.',
        409,
        'statement_artifact_not_ready',
      );
      if (!entry.version.artifact_id) throw notReady;
      const { rows: [row] } = await pool.query(
        'SELECT * FROM statement_artifacts WHERE id = $1', [entry.version.artifact_id]);
      if (!row || row.state !== 'ready') throw notReady;
      return { document: entry.version, artifact: shapeArtifact(row), version: entry.version };
    }
    const kind = req.query.kind === undefined ? 'original' : String(req.query.kind);
    if (!['original', 'rendition'].includes(kind)) {
      throw new AppError('Invalid statement artifact kind', 400, 'statement_archive_invalid_kind');
    }
    const label = req.query.label === undefined ? null : String(req.query.label);
    const artifacts = await listDocumentArtifacts(documentId);
    return { document: entry.document, artifact: selectServableArtifact(artifacts, { kind, language, label }) };
  }

  // Stream the bytes of a ready artifact. Re-authorizes on every call;
  // incomplete artifacts are never served; a failed download never promotes
  // an artifact to ready and never deletes evidence.
  router.get('/archive/:documentId/download', creditExportLimiter, async (req, res, next) => {
    try {
      const { document, artifact, version } = await resolveServableArtifact(req);
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
      res.set('Content-Disposition', `attachment; filename="${downloadFilename(document, download.mediaType, version || null)}"`);
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
