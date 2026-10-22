'use strict';

const AppError = require('../utils/appError');
const crypto = require('crypto');
const v = require('../utils/restaurantReviewValidation');

const PROVIDERS = new Set(['quickbooks', 'xero']);
const STATUSES = new Set(['disconnected', 'configured', 'active', 'paused', 'error']);
const EXPORT_STATUSES = new Set(['pending', 'sending', 'posted', 'failed', 'requires_reconciliation']);
const ACCOUNT_KEYS = ['sales', 'taxPayable', 'serviceFees', 'deliveryFees', 'tipsPayable', 'paymentClearing'];
const DEFAULT_MAPPING = Object.freeze({ sales: '4000', taxPayable: '2100', serviceFees: '4100', deliveryFees: '4200', tipsPayable: '2200', paymentClearing: '1000' });

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!PROVIDERS.has(provider)) throw new AppError('Unsupported accounting provider', 400, 'accounting_provider_invalid');
  return provider;
}

function normalizeStatus(value) {
  const status = String(value || 'disconnected').trim().toLowerCase();
  if (!STATUSES.has(status)) throw new AppError('Accounting integration status is invalid', 400, 'accounting_status_invalid');
  return status;
}

function normalizeSecretRef(value, field) {
  if (value == null || value === '') return null;
  const ref = String(value).trim();
  if (!/^\{\{resolve:secretsmanager:[^{}]+:SecretString(?::[^{}]+)?\}\}$/.test(ref)) {
    throw new AppError(`${field} must be a Secrets Manager dynamic reference`, 400, 'accounting_secret_ref_invalid');
  }
  return ref;
}

function normalizeMapping(value) {
  const mapping = { ...DEFAULT_MAPPING, ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}) };
  for (const key of ACCOUNT_KEYS) {
    if (typeof mapping[key] !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(mapping[key])) {
      throw new AppError(`Invalid account mapping for ${key}`, 400, 'accounting_mapping_invalid');
    }
  }
  return Object.fromEntries(ACCOUNT_KEYS.map((key) => [key, mapping[key]]));
}

function normalizeDate(value, field) {
  const date = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])) {
    throw new AppError(`Invalid ${field}`, 400, 'accounting_period_invalid');
  }
  return date;
}

function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new AppError('Currency must be a three-letter ISO code', 400, 'accounting_currency_invalid');
  return currency;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 180) throw new AppError('An accounting export idempotency key is required', 400, 'accounting_idempotency_required');
  return key;
}

function shapeIntegration(row) {
  return {
    id: Number(row.id), restaurantId: Number(row.restaurant_id), provider: row.provider, status: row.status,
    externalCompanyId: row.external_company_id || null,
    credentialsConfigured: Boolean(row.access_token_ref && row.refresh_token_ref),
    tokenExpiresAt: row.token_expires_at || null,
    accountMapping: normalizeMapping(row.account_mapping || {}),
    lastExportAt: row.last_export_at || null, lastError: row.last_error || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function shapeExport(row) {
  return {
    id: Number(row.id), restaurantId: Number(row.restaurant_id), integrationId: Number(row.integration_id),
    periodFrom: row.period_from, periodTo: row.period_to, currencyCode: row.currency_code,
    idempotencyKey: row.idempotency_key, status: row.status,
    lineCount: Array.isArray(row.payload?.lines) ? row.payload.lines.length : Number(row.line_count || 0),
    externalBatchId: row.external_batch_id || null, lastError: row.last_error || null,
    attempts: Number(row.attempts || 0), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function upsertIntegration(client, { restaurantId, provider, status, externalCompanyId, accessTokenRef, refreshTokenRef, tokenExpiresAt, accountMapping, actorUserId }) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedStatus = normalizeStatus(status);
  const mapping = normalizeMapping(accountMapping);
  const accessRef = normalizeSecretRef(accessTokenRef, 'accessTokenRef');
  const refreshRef = normalizeSecretRef(refreshTokenRef, 'refreshTokenRef');
  if (normalizedStatus === 'active' && (!accessRef || !refreshRef)) {
    throw new AppError('Active accounting integrations require runtime token references', 400, 'accounting_credentials_required');
  }
  const { rows: [row] } = await client.query(
    `INSERT INTO restaurant_accounting_integrations
       (restaurant_id, provider, status, external_company_id, access_token_ref,
        refresh_token_ref, token_expires_at, account_mapping, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     ON CONFLICT (restaurant_id, provider) DO UPDATE SET
       status = EXCLUDED.status, external_company_id = EXCLUDED.external_company_id,
       access_token_ref = EXCLUDED.access_token_ref, refresh_token_ref = EXCLUDED.refresh_token_ref,
       token_expires_at = EXCLUDED.token_expires_at, account_mapping = EXCLUDED.account_mapping,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING *`,
    [restaurantId, normalizedProvider, normalizedStatus, externalCompanyId ? String(externalCompanyId).trim().slice(0, 180) : null,
      accessRef, refreshRef, tokenExpiresAt || null, mapping, actorUserId || null]
  );
  if (!row) throw new AppError('Accounting integration could not be saved', 500, 'accounting_integration_save_failed');
  return shapeIntegration(row);
}

async function listIntegrations(client, restaurantId) {
  const { rows } = await client.query(
    `SELECT * FROM restaurant_accounting_integrations WHERE restaurant_id = $1 ORDER BY provider ASC`,
    [restaurantId]
  );
  return rows.map(shapeIntegration);
}

async function listExports(client, restaurantId, { provider, limit = 50 } = {}) {
  const normalizedProvider = provider == null || provider === '' ? null : normalizeProvider(provider);
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  const { rows } = await client.query(
    `SELECT e.*
       FROM restaurant_accounting_exports e
       JOIN restaurant_accounting_integrations i ON i.id = e.integration_id
      WHERE e.restaurant_id = $1
        AND ($2::text IS NULL OR i.provider = $2)
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $3`,
    [restaurantId, normalizedProvider, safeLimit]
  );
  return rows.map(shapeExport);
}

function money(value) {
  const amount = typeof value === 'number' ? String(value) : value;
  if (typeof amount !== 'string' || !/^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,2})?$/.test(amount)) throw new AppError('Invalid journal amount', 400, 'accounting_amount_invalid');
  const [whole, fraction = ''] = amount.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError('Journal amount exceeds the supported range', 400, 'accounting_amount_invalid');
  return { cents, formatted: `${whole}.${fraction.padEnd(2, '0')}` };
}
function assertJournal(lines, from, to, currency) {
  let balance = 0n;
  for (const line of lines) {
    if (line.date < from || line.date > to || line.currency !== currency) throw new AppError('Journal lines must match the export period and currency', 400, 'accounting_line_scope_invalid');
    const debit = money(line.debit).cents, credit = money(line.credit).cents;
    if ((debit > 0n && credit > 0n) || (debit === 0n && credit === 0n)) throw new AppError('A journal line must have one positive debit or credit', 400, 'accounting_amount_invalid');
    balance += debit - credit;
  }
  if (balance !== 0n) throw new AppError('Journal debits and credits must balance', 400, 'accounting_journal_unbalanced');
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function payloadHash(payload) { return crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex'); }
function replayExport(row, payload) {
  if (payloadHash(row.payload) !== payloadHash(payload)) throw new AppError('Export retry conflicts with the original journal', 409, 'accounting_idempotency_conflict');
  return { export: shapeExport(row), replayed: true };
}

function mapLines(lines, mapping) {
  const accountMapping = normalizeMapping(mapping);
  const codeByStandard = {
    '4000': accountMapping.sales, '2100': accountMapping.taxPayable,
    '4100': accountMapping.serviceFees, '4200': accountMapping.deliveryFees,
    '2200': accountMapping.tipsPayable, '1000': accountMapping.paymentClearing,
  };
  if (!Array.isArray(lines) || lines.length > 50000) throw new AppError('Journal lines must be a bounded array', 400, 'accounting_lines_invalid');
  return lines.map((line) => ({
    date: normalizeDate(line.date, 'journal date'),
    reference: String(line.reference || '').slice(0, 180),
    description: String(line.description || '').slice(0, 240),
    account: codeByStandard[String(line.account)] || v.text(line.account, 'account', 80),
    debit: money(line.debit ?? '0.00').formatted, credit: money(line.credit ?? '0.00').formatted,
    currency: normalizeCurrency(line.currency), location: String(line.location || '').slice(0, 180),
  }));
}

async function queueExport(client, { restaurantId, provider, periodFrom, periodTo, currencyCode, idempotencyKey, lines, actorUserId }) {
  const normalizedProvider = normalizeProvider(provider);
  const from = normalizeDate(periodFrom, 'period start');
  const to = normalizeDate(periodTo, 'period end');
  if (from > to) throw new AppError('Accounting period start must be before its end', 400, 'accounting_period_invalid');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 >= 366) throw new AppError('Accounting periods are capped at 366 days', 400, 'accounting_period_invalid');
  const currency = normalizeCurrency(currencyCode);
  const key = normalizeIdempotencyKey(idempotencyKey);
  const { rows: [integration] } = await client.query(
    `SELECT * FROM restaurant_accounting_integrations
      WHERE restaurant_id = $1 AND provider = $2 AND status IN ('configured','active')
      FOR SHARE`,
    [restaurantId, normalizedProvider]
  );
  if (!integration) throw new AppError('Accounting provider is not configured for exports', 409, 'accounting_provider_not_ready');
  const mappedLines = mapLines(lines, integration.account_mapping);
  if (!mappedLines.length) throw new AppError('Accounting export has no journal lines', 400, 'accounting_export_empty');
  assertJournal(mappedLines, from, to, currency);
  const payload = { schema: 'oxsteed.restaurant.accounting.journal.v1', from_date: from, to_date: to, currency, lines: mappedLines };
  const { rows: [existing] } = await client.query(
    `SELECT * FROM restaurant_accounting_exports WHERE integration_id = $1 AND idempotency_key = $2`,
    [integration.id, key]
  );
  if (existing) return replayExport(existing, payload);
  const { rows: inserted } = await client.query(
    `INSERT INTO restaurant_accounting_exports
       (restaurant_id, integration_id, period_from, period_to, currency_code, idempotency_key, payload, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (integration_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [restaurantId, integration.id, from, to, currency, key, payload, actorUserId || null]
  );
  if (inserted[0]) return { export: shapeExport(inserted[0]), replayed: false };
  const { rows: [recovered] } = await client.query(
    `SELECT * FROM restaurant_accounting_exports WHERE integration_id = $1 AND idempotency_key = $2`,
    [integration.id, key]
  );
  if (!recovered) throw new AppError('Accounting export could not be recovered after an idempotency conflict', 503, 'accounting_export_recovery_failed');
  return replayExport(recovered, payload);
}

async function updateExportStatus(client, { restaurantId, exportId, status, externalBatchId, lastError }) {
  exportId = v.integer(exportId, 'exportId');
  externalBatchId = v.text(externalBatchId, 'externalBatchId', 180, { optional: true });
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!EXPORT_STATUSES.has(normalizedStatus)) throw new AppError('Accounting export status is invalid', 400, 'accounting_export_status_invalid');
  if (normalizedStatus === 'posted' && !String(externalBatchId || '').trim()) throw new AppError('Posted exports require an external batch ID', 400, 'accounting_external_id_required');
  const { rows: [current] } = await client.query('SELECT * FROM restaurant_accounting_exports WHERE id = $1 AND restaurant_id = $2 FOR UPDATE', [exportId, restaurantId]);
  if (!current) throw new AppError('Accounting export not found', 404, 'accounting_export_not_found');
  if (current.status === 'posted' && normalizedStatus === 'posted' && externalBatchId === String(current.external_batch_id || '').trim()) return shapeExport(current);
  if (current.status === 'posted') throw new AppError('Posted accounting exports are immutable', 409, 'accounting_export_immutable');
  const transitions = {
    pending: ['sending', 'requires_reconciliation'], sending: ['posted', 'failed', 'requires_reconciliation'],
    failed: ['pending', 'requires_reconciliation'], requires_reconciliation: ['pending', 'posted'],
  };
  if (normalizedStatus === current.status) return shapeExport(current);
  if (!transitions[current.status]?.includes(normalizedStatus)) throw new AppError('Invalid accounting export transition', 409, 'accounting_export_transition_invalid');
  const { rows: [row] } = await client.query(
    `UPDATE restaurant_accounting_exports
        SET status = $3::text, external_batch_id = COALESCE($4, external_batch_id),
            last_error = $5, attempts = attempts + CASE WHEN $3::text = 'sending' THEN 1 ELSE 0 END,
            updated_at = NOW()
      WHERE id = $1 AND restaurant_id = $2
      RETURNING *`,
    [exportId, restaurantId, normalizedStatus, externalBatchId ? String(externalBatchId).slice(0, 180) : null, lastError ? String(lastError).slice(0, 1000) : null]
  );
  return shapeExport(row);
}

module.exports = {
  normalizeProvider, normalizeStatus, normalizeSecretRef, normalizeMapping, normalizeDate, normalizeCurrency,
  normalizeIdempotencyKey, shapeIntegration, shapeExport, mapLines, upsertIntegration, listIntegrations, listExports,
  queueExport, updateExportStatus, DEFAULT_MAPPING, money, assertJournal, payloadHash,
};
