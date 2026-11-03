'use strict';

/**
 * Pre-acquisition disclosures for the open-loop OxSteed Credit product
 * (review §7): short form, long form, fee schedule, not-insured notice,
 * safeguarding statement, wage-payment terms and error resolution, in
 * en/es/fr/ht/ar.
 *
 * - Counsel-approved text is published per kind and language through the
 *   oversight action 'credit_disclosure_publish' (two administrators;
 *   DB CHECK credit_disclosure_two_person). Until then the placeholder
 *   wording in locales/credit-disclosures.json is served, flagged
 *   `placeholder: true`.
 * - The fee schedule is rendered from the live fee table, so the
 *   disclosure can never drift from what is charged.
 * - Acceptances are stored per user with the SHA-256 of the exact text
 *   shown. A text change means a new acceptance.
 * - OXSTEED_CREDIT_REQUIRE_DISCLOSURE_ACCEPTANCE=true makes acceptance of
 *   the pre-acquisition set a precondition of funding (checked in
 *   fiatComplianceService). Default off until counsel publishes text.
 */

const crypto = require('crypto');
const pool = require('../../db');
const { AppError } = require('../../middleware/errorHandler');
const { insertComplianceAudit } = require('./audit');
const PLACEHOLDERS = require('../../locales/credit-disclosures.json');

const LANGS = Object.freeze(['en', 'es', 'fr', 'ht', 'ar']);
const KINDS = Object.freeze(['short_form', 'long_form', 'fee_schedule', 'not_insured', 'safeguarding', 'wage_payment_terms', 'error_resolution']);
const PRE_ACQUISITION = Object.freeze(['short_form', 'long_form', 'fee_schedule', 'not_insured']);
const MAX_FX_SPREAD_BPS = 100;

const OPERATION_LABELS = Object.freeze({
  withdrawal: { en: 'Withdrawal', es: 'Retiro', fr: 'Retrait', ht: 'Retrè', ar: 'السحب' },
  transfer: { en: 'Send to another user', es: 'Enviar a otro usuario', fr: 'Envoi à un autre utilisateur', ht: 'Voye bay yon lòt itilizatè', ar: 'الإرسال إلى مستخدم آخر' },
  conversion: { en: 'Restaurant credit conversion', es: 'Conversión de crédito de restaurante', fr: 'Conversion de crédit restaurant', ht: 'Konvèsyon kredi restoran', ar: 'تحويل رصيد المطعم' },
  top_up: { en: 'Add money', es: 'Agregar dinero', fr: 'Ajout d’argent', ht: 'Ajoute lajan', ar: 'إضافة أموال' },
});
const FREE = Object.freeze({ en: 'free', es: 'gratis', fr: 'gratuit', ht: 'gratis', ar: 'مجانًا' });
const MIN = Object.freeze({ en: 'min.', es: 'mín.', fr: 'min.', ht: 'min.', ar: 'الحد الأدنى' });
const MAX = Object.freeze({ en: 'max.', es: 'máx.', fr: 'max.', ht: 'maks.', ar: 'الحد الأقصى' });

function normalizeLang(value) {
  const short = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(short) ? short : 'en';
}

function flagOn(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function percent(bps, lang) {
  return new Intl.NumberFormat(lang === 'ht' ? 'fr' : lang, { style: 'percent', maximumFractionDigits: 2 }).format(Number(bps) / 10000);
}

function money(minor, currency, lang) {
  const { formatMoney } = require('../../validation/money');
  return formatMoney(Number(minor), currency, lang === 'ht' ? 'fr-HT' : lang);
}

/** Structured fee rows for one currency (also used by the UI table). */
async function feeRows(currency, db = pool) {
  const fees = require('../oxsteedCreditFeeScheduleService');
  const rows = await fees.listFeeSchedule(db);
  const out = [];
  for (const op of fees.OPERATION_TYPES) {
    const row = rows.find((r) => r.operation_type === op && r.currency_code === currency && r.is_active !== false) || null;
    out.push({
      operation: op,
      fixed_minor: row ? Number(row.fixed_cents || 0) : 0,
      percentage_bps: row ? Number(row.percentage_bps || 0) : 0,
      min_minor: row ? Number(row.min_fee_cents || 0) : 0,
      max_minor: row && row.max_fee_cents !== null && row.max_fee_cents !== undefined ? Number(row.max_fee_cents) : null,
    });
  }
  return out;
}

function renderFeeTable(rows, currency, lang) {
  return rows.map((r) => {
    const label = OPERATION_LABELS[r.operation]?.[lang] || r.operation;
    if (!r.fixed_minor && !r.percentage_bps && !r.min_minor) return `${label}: ${FREE[lang]}`;
    const parts = [];
    if (r.fixed_minor) parts.push(money(r.fixed_minor, currency, lang));
    if (r.percentage_bps) parts.push(percent(r.percentage_bps, lang));
    let text = `${label}: ${parts.join(' + ')}`;
    const limits = [];
    if (r.min_minor) limits.push(`${MIN[lang]} ${money(r.min_minor, currency, lang)}`);
    if (r.max_minor !== null) limits.push(`${MAX[lang]} ${money(r.max_minor, currency, lang)}`);
    if (limits.length) text += ` (${limits.join(', ')})`;
    return text;
  }).join('; ');
}

async function publishedVersion(db, kind, lang) {
  const { rows } = await db.query(
    `SELECT * FROM credit_disclosure_versions WHERE disclosure_kind = $1 AND language = $2 AND status = 'published' LIMIT 1`,
    [kind, lang]
  );
  return rows[0] || null;
}

/** The exact disclosure a user sees now, with its content hash. */
async function getDisclosure(kind, language, { currency = 'USD', db = pool } = {}) {
  if (!KINDS.includes(kind)) throw new AppError('Unknown disclosure', 400, 'credit_disclosure_kind_invalid');
  const lang = normalizeLang(language);
  const cur = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'USD';
  const published = await publishedVersion(db, kind, lang);
  const [title, template] = published ? [published.title, published.body] : PLACEHOLDERS[lang][kind];
  const needsFees = template.includes('{fee_table}');
  const rows = needsFees || kind === 'fee_schedule' ? await feeRows(cur, db) : null;
  const body = template
    .replace(/\{fee_table\}/g, rows ? renderFeeTable(rows, cur, lang) : '')
    .replace(/\{fx_spread\}/g, percent(MAX_FX_SPREAD_BPS, lang));
  return {
    kind,
    language: lang,
    currency: cur,
    title,
    body,
    version: published ? Number(published.version) : 0,
    version_id: published ? String(published.id) : null,
    placeholder: !published,
    approved_reference: published ? published.approved_reference : null,
    sha256: sha256(`${kind}\n${lang}\n${title}\n${body}`),
    fees: kind === 'fee_schedule' ? rows : undefined,
    max_fx_spread_bps: MAX_FX_SPREAD_BPS,
  };
}

async function getDisclosureSet(language, { kinds = KINDS, currency = 'USD', userId = null, db = pool } = {}) {
  const items = [];
  for (const kind of kinds) items.push(await getDisclosure(kind, language, { currency, db }));
  let accepted = new Set();
  if (userId) {
    const { rows } = await db.query(
      `SELECT content_sha256 FROM credit_disclosure_acceptances WHERE user_id = $1 AND content_sha256 = ANY($2::text[])`,
      [userId, items.map((i) => i.sha256)]
    );
    accepted = new Set(rows.map((r) => r.content_sha256));
  }
  return items.map((i) => ({ ...i, accepted: accepted.has(i.sha256) }));
}

/**
 * Record acceptance of the disclosures the user was shown. Each entry is
 * { kind, sha256 }; the hash must match the current text in that language
 * (stale screens are refused with 409 so the user re-reads).
 */
async function acceptDisclosures({ user, language, currency = 'USD', items, context = 'pre_acquisition', requestIp = null, userAgent = null, db = pool }) {
  if (!user?.id) throw new AppError('Sign in first', 401, 'auth_required');
  if (!Array.isArray(items) || !items.length || items.length > KINDS.length) throw new AppError('Choose what you accept', 400, 'validation_failed', { items: 'required' });
  if (!['pre_acquisition', 'wage_consent', 'update', 'cashout'].includes(context)) throw new AppError('Invalid context', 400, 'validation_failed', { context: 'invalid' });
  const lang = normalizeLang(language);
  const recorded = [];
  for (const item of items) {
    const current = await getDisclosure(String(item?.kind || ''), lang, { currency, db });
    if (String(item.sha256 || '') !== current.sha256) {
      throw new AppError('This text has changed. Please read the current version.', 409, 'credit_disclosure_changed', { kind: current.kind });
    }
    await db.query(
      `INSERT INTO credit_disclosure_acceptances
         (user_id, disclosure_kind, language, disclosure_version_id, content_sha256, context, request_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, disclosure_kind, content_sha256) DO NOTHING`,
      [user.id, current.kind, lang, current.version_id, current.sha256, context, requestIp, userAgent ? String(userAgent).slice(0, 300) : null]
    );
    recorded.push({ kind: current.kind, sha256: current.sha256, version: current.version });
  }
  await insertComplianceAudit(db, {
    actionType: 'credit.disclosure.accepted', actorUserId: user.id, customerId: user.id,
    resourceType: 'credit_disclosure', resourceId: recorded.map((r) => r.kind).join(',').slice(0, 160),
    reason: context, requestIp, afterState: { language: lang, items: recorded },
  });
  return recorded;
}

/** Hashes of the current text of `kind` in every language. */
async function currentHashes(kind, db, currency) {
  const hashes = [];
  for (const lang of LANGS) hashes.push((await getDisclosure(kind, lang, { db, currency })).sha256);
  return hashes;
}

async function hasAcceptedCurrent(db, userId, kinds = PRE_ACQUISITION, currency = 'USD') {
  for (const kind of kinds) {
    const hashes = await currentHashes(kind, db, currency);
    const { rows } = await db.query(
      `SELECT 1 FROM credit_disclosure_acceptances WHERE user_id = $1 AND disclosure_kind = $2 AND content_sha256 = ANY($3::text[]) LIMIT 1`,
      [userId, kind, hashes]
    );
    if (!rows.length) return false;
  }
  return true;
}

/** Funding gate; a no-op (no query) unless the flag is on. */
async function assertPreAcquisitionAccepted(db, userId, currency = 'USD') {
  if (!flagOn('OXSTEED_CREDIT_REQUIRE_DISCLOSURE_ACCEPTANCE')) return { required: false };
  if (!(await hasAcceptedCurrent(db, userId, PRE_ACQUISITION, currency))) {
    throw new AppError('Please read and accept the OxSteed Credit terms first', 409, 'credit_disclosure_acceptance_required', { kinds: PRE_ACQUISITION });
  }
  return { required: true, accepted: true };
}

function validatePublish(payload = {}) {
  if (!KINDS.includes(payload.kind)) throw new AppError('Unknown disclosure', 400, 'validation_failed', { kind: 'invalid' });
  if (!LANGS.includes(payload.language)) throw new AppError('Unsupported language', 400, 'validation_failed', { language: 'invalid' });
  const title = String(payload.title || '').trim();
  const body = String(payload.body || '').trim();
  const ref = String(payload.approvedReference || '').trim();
  if (!title || title.length > 200) throw new AppError('Title is required', 400, 'validation_failed', { title: 'required' });
  if (!body || body.length > 20000) throw new AppError('Text is required', 400, 'validation_failed', { body: 'required' });
  if (ref.length < 3 || ref.length > 160) throw new AppError('Counsel approval reference is required', 400, 'validation_failed', { approvedReference: 'required' });
  if (payload.kind === 'fee_schedule' && !body.includes('{fee_table}')) {
    throw new AppError('The fee schedule must include {fee_table}', 400, 'validation_failed', { body: 'fee_table_placeholder_required' });
  }
}

/** Oversight executor 'credit_disclosure_publish' (two administrators). */
async function applyPublish({ client, payload, actorUserId, requestedBy }) {
  validatePublish(payload);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`credit-disclosure:${payload.kind}:${payload.language}`]);
  const { rows: [{ next }] } = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM credit_disclosure_versions WHERE disclosure_kind = $1 AND language = $2`,
    [payload.kind, payload.language]
  );
  await client.query(
    `UPDATE credit_disclosure_versions SET status = 'retired', retired_at = NOW()
      WHERE disclosure_kind = $1 AND language = $2 AND status = 'published'`,
    [payload.kind, payload.language]
  );
  const { rows } = await client.query(
    `INSERT INTO credit_disclosure_versions
       (disclosure_kind, language, version, title, body, approved_reference, requested_by, published_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [payload.kind, payload.language, next, String(payload.title).trim(), String(payload.body).trim(), String(payload.approvedReference).trim(), requestedBy, actorUserId]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.disclosure.published', actorUserId, resourceType: 'credit_disclosure_version', resourceId: String(rows[0].id),
    reason: `${payload.kind}/${payload.language} v${next}`, afterState: { requestedBy, approvedReference: payload.approvedReference },
  });
  return { id: String(rows[0].id), kind: payload.kind, language: payload.language, version: Number(next) };
}
applyPublish.validate = validatePublish;

async function listVersions({ kind = null } = {}) {
  const { rows } = await pool.query(
    `SELECT id, disclosure_kind, language, version, title, status, approved_reference, requested_by, published_by, published_at, retired_at
       FROM credit_disclosure_versions WHERE ($1::text IS NULL OR disclosure_kind = $1)
      ORDER BY disclosure_kind, language, version DESC LIMIT 500`,
    [kind]
  );
  return rows.map((r) => ({ ...r, id: String(r.id), version: Number(r.version) }));
}

function registerOversightActions(register) {
  register('credit_disclosure_publish', applyPublish);
}

module.exports = {
  LANGS,
  KINDS,
  PRE_ACQUISITION,
  MAX_FX_SPREAD_BPS,
  normalizeLang,
  feeRows,
  renderFeeTable,
  getDisclosure,
  getDisclosureSet,
  acceptDisclosures,
  hasAcceptedCurrent,
  assertPreAcquisitionAccepted,
  validatePublish,
  applyPublish,
  listVersions,
  registerOversightActions,
};
