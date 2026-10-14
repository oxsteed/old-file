'use strict';

// Orchestration for the statement export additions that sit beside (not
// inside) the background export-job pipeline in statementExportJobService:
// bulk export packages, the export-history listing, and synchronous
// accounting (OFX/QFX/QBO) downloads.
//
// Design notes:
// - Bulk export reuses the existing job pipeline: one export job per item,
//   each with its own idempotency key derived from the bulk key, so the
//   existing progress/cancel/retry UI and worker pool apply unchanged.
// - The ZIP package streams the verified bytes of already-complete jobs
//   through the same guarded download path the single-file UI uses.
// - OFX/QFX/QBO are generated synchronously from the statement builders
//   (not the job table) because statement_export_jobs.format is CHECKed to
//   csv/pdf; no migration may widen it here. Statements are capped at the
//   builders' MAX_ROWS (5000), which keeps the synchronous path bounded.
// - Export history reads the existing statement_export_jobs records; no new
//   table.

const crypto = require('node:crypto');
const AppError = require('../utils/appError');
const jobService = require('./statementExportJobService');
const { periodFor } = require('./creditStatementService');
const settlementStatements = require('./settlementStatementService');
const creditStatements = require('./creditStatementService');
const ofx = require('./ofxExportService');

const PRODUCTS = new Set(['oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business']);
const ACCOUNTING_FORMATS = new Set(['ofx', 'qfx', 'qbo']);
const BULK_MAX_ITEMS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => { throw new AppError('Statement export not found', 404, 'statement_export_not_found'); };
const fail = (code, status = 400) => { throw new AppError(code, status, code); };

function checkCurrency(currency) {
  const value = String(currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) fail('statement_invalid_currency');
  return value;
}

// Mirrors the scope derivation in statementExportJobService.parseRequest so
// bulk items and accounting exports authorize exactly like single exports.
function scopeFor(product, input, userId) {
  if (product === 'oxsteed' || product === 'helper_earnings') return String(userId);
  if (product === 'business') return String(input.businessId);
  return String(input.restaurantId);
}

function createService({ db = require('../db'), jobs = jobService } = {}) {
  function parseBulkItem(item, userId) {
    const product = String(item.product || '');
    if (!PRODUCTS.has(product)) fail('statement_invalid_product');
    const currency = checkCurrency(item.currencyCode);
    const format = String(item.format || 'csv');
    // The job table CHECKs format to csv/pdf; bulk rides the job pipeline.
    if (!['csv', 'pdf'].includes(format)) fail('statement_export_invalid_format');
    const language = String(item.language || 'en');
    if (!['en', 'es', 'fr', 'ht', 'ar'].includes(language)) fail('statement_export_invalid_format');
    const period = periodFor(item.from, item.to);
    const scope = scopeFor(product, item, userId);
    if (!['oxsteed', 'helper_earnings'].includes(product)
        && (!/^[1-9]\d*$/.test(scope) || !Number.isSafeInteger(Number(scope)))) {
      fail('statement_invalid_account');
    }
    return { product, from: period.from, to: period.to, currencyCode: currency, format, language,
      ...(product === 'business' ? { businessId: scope } : {}),
      ...(['restaurant', 'restaurant_settlement'].includes(product) ? { restaurantId: scope } : {}) };
  }

  async function requestBulk(userId, items, idempotencyKey) {
    if (!UUID.test(String(userId))) missing();
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(String(idempotencyKey || ''))) fail('statement_export_idempotency_required');
    if (!Array.isArray(items) || items.length < 1 || items.length > BULK_MAX_ITEMS) {
      fail('statement_bulk_invalid_items');
    }
    const bulkId = crypto.randomUUID();
    const created = [];
    for (let index = 0; index < items.length; index += 1) {
      const input = parseBulkItem(items[index], userId);
      // Derived per-item key keeps each job independently idempotent and
      // replay-safe: re-POSTing the bulk request replays the same jobs.
      const job = await jobs.request(userId, input, `${idempotencyKey}:bulk:${index}`);
      created.push(job);
    }
    return { bulkId, jobs: created };
  }

  // Streams a ZIP of already-complete jobs. Every job is re-authorized to the
  // caller and must be complete; any other state fails closed with 409.
  // Returns the archiver instance (already finalized); the route pipes it.
  async function packageJobs(userId, jobIds, archiverLib = require('archiver')) {
    if (!UUID.test(String(userId))) missing();
    if (!Array.isArray(jobIds) || jobIds.length < 1 || jobIds.length > BULK_MAX_ITEMS) {
      fail('statement_bulk_invalid_items');
    }
    const unique = [...new Set(jobIds.map(String))];
    const archive = archiverLib('zip', { zlib: { level: 9 } });
    const seenNames = new Set();
    for (const jobId of unique) {
      const job = await jobs.requireJob(jobId, userId);
      if (job.state !== 'complete') fail('statement_export_not_ready', 409);
      const manifest = await jobs.manifest(jobId, userId);
      if (!manifest?.complete || !Array.isArray(manifest.files) || !manifest.files.length) {
        fail('statement_export_not_ready', 409);
      }
      const period = `${manifest.period?.from || job.period.from}_${manifest.period?.to || job.period.to}`
        .replace(/[^0-9A-Za-z_-]/g, '-');
      let part = 0;
      for (const file of manifest.files) {
        part += 1;
        const extension = file.kind === 'csv' ? 'csv' : 'pdf';
        let name = `statement-${job.product}-${period}-part${part}.${extension}`;
        let suffix = 1;
        while (seenNames.has(name)) { suffix += 1; name = `statement-${job.product}-${period}-part${part}-${suffix}.${extension}`; }
        seenNames.add(name);
        // The guarded download path re-verifies size and sha256 while
        // streaming; a corrupt object aborts the package, never ships bytes.
        const { stream } = await jobs.download(jobId, file.id, userId);
        archive.append(stream, { name });
      }
    }
    await archive.finalize();
    return { archive, filename: `statement-package-${new Date().toISOString().slice(0, 10)}.zip` };
  }

  // Existing export-job records power the history screen; no new table.
  // Download links come from the stored manifest and stay valid while the
  // private storage object exists (verified on every download).
  async function exportHistory(userId, { page = 1, pageSize = 20 } = {}) {
    if (!UUID.test(String(userId))) missing();
    const safePage = Number.isSafeInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeSize = Number.isSafeInteger(Number(pageSize)) && Number(pageSize) > 0
      ? Math.min(Number(pageSize), 100) : 20;
    const { rows } = await db.query(
      `SELECT id, product, currency_code, period_from, period_to, format, language,
              state, error_code, row_count, rows_rendered, manifest,
              created_at, completed_at
         FROM statement_export_jobs
        WHERE requested_by=$1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, safeSize, (safePage - 1) * safeSize]);
    const { rows: [{ total }] } = await db.query(
      'SELECT count(*)::int AS total FROM statement_export_jobs WHERE requested_by=$1', [userId]);
    return {
      page: safePage,
      pageSize: safeSize,
      total,
      jobs: rows.map((row) => {
        const manifest = row.state === 'complete' ? row.manifest : null;
        const files = manifest?.complete && Array.isArray(manifest.files)
          ? manifest.files.map((file) => ({
            id: file.id, kind: file.kind, part: file.part, rowFrom: file.rowFrom, rowTo: file.rowTo,
            byteLength: file.byteLength,
            downloadUrl: `/api/statements/exports/${row.id}/files/${file.id}`,
          }))
          : null;
        return {
          id: row.id, product: row.product, currencyCode: row.currency_code,
          period: { from: row.period_from instanceof Date ? row.period_from.toISOString().slice(0, 10) : String(row.period_from),
            to: row.period_to instanceof Date ? row.period_to.toISOString().slice(0, 10) : String(row.period_to) },
          format: row.format, language: row.language, state: row.state,
          errorCode: row.error_code || null,
          rowsTotal: row.row_count === null ? null : Number(row.row_count),
          rowsRendered: Number(row.rows_rendered),
          files, createdAt: row.created_at, completedAt: row.completed_at,
        };
      }),
    };
  }

  // Synchronous OFX/QFX/QBO download. Authorizes the scope exactly like an
  // export job, then builds the statement through the standard builders.
  async function accountingExport(userId, input) {
    if (!UUID.test(String(userId))) missing();
    const product = String(input.product || '');
    if (!PRODUCTS.has(product)) fail('statement_invalid_product');
    const currency = checkCurrency(input.currencyCode);
    const format = String(input.format || 'ofx');
    if (!ACCOUNTING_FORMATS.has(format)) fail('statement_export_invalid_format');
    const period = periodFor(input.from, input.to);
    const scope = scopeFor(product, input, userId);
    if (!['oxsteed', 'helper_earnings'].includes(product)
        && (!/^[1-9]\d*$/.test(scope) || !Number.isSafeInteger(Number(scope)))) {
      fail('statement_invalid_account');
    }
    await jobService.authorizeScope(db, userId, product, scope, currency);
    let document;
    if (product === 'oxsteed' || product === 'restaurant') {
      document = await creditStatements.getStatement(userId, {
        product,
        ...(product === 'restaurant' ? { restaurantId: scope } : {}),
        currencyCode: currency, from: period.from, to: period.to,
      });
    } else {
      document = await settlementStatements.getStatement(userId, {
        product,
        ...(product === 'restaurant_settlement' ? { restaurantId: Number(scope) } : {}),
        ...(product === 'business' ? { businessId: Number(scope) } : {}),
        ...(product === 'helper_earnings' ? { helperId: String(userId).toLowerCase() } : {}),
        currencyCode: currency, from: period.from, to: period.to,
      });
    }
    return ofx.buildOfx(document, { variant: format });
  }

  return { requestBulk, packageJobs, exportHistory, accountingExport, parseBulkItem };
}

let defaultService;
function service() { return defaultService || (defaultService = createService()); }

module.exports = { createService,
  ...Object.fromEntries(['requestBulk', 'packageJobs', 'exportHistory', 'accountingExport']
    .map((name) => [name, (...args) => service()[name](...args)])) };
