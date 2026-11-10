'use strict';

// Shared helpers for the Careers marketplace modules
// (docs/careers/marketplace.md). Keeps the same conventions as the core
// careers services: AppError codes, FieldErrors, no PII in logs.

const crypto = require('crypto');
const { AppError } = require('../../../middleware/errorHandler');
const { maskPhoneNumbers, detectOffPlatformContact } = require('../../../utils/messageSanitizer');

/** 503 for a feature whose flag is off (same shape as vendor-off answers). */
function featureOff(feature) {
  return new AppError('This feature is not available yet', 503, 'provider_not_configured', { reason: 'feature_disabled', feature });
}

function notFound(what = 'Not found') {
  return new AppError(what, 404, 'not_found');
}

function positiveId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function requireId(value, what = 'Not found') {
  const id = positiveId(value);
  if (!id) throw notFound(what);
  return id;
}

/** Keyed hash of a viewer (user id or IP) for de-duplication; never reversible. */
function viewerHash(req) {
  const pepper = process.env.CAREERS_IP_PEPPER || process.env.JWT_SECRET || 'careers-ip';
  const who = req?.user?.id ? `u:${req.user.id}` : `ip:${String(req?.ip || '').split(',')[0].trim()}`;
  return crypto.createHmac('sha256', pepper).update(`${new Date().toISOString().slice(0, 10)}|${who}`).digest('hex').slice(0, 32);
}

/**
 * Plain-text user content: strips control characters, masks phone numbers
 * (off-platform deterrence, same as chat) and reports what was flagged.
 * Rendering is always as text (React text nodes, escaped email HTML).
 */
function cleanUserText(value, max) {
  const raw = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  const flags = detectOffPlatformContact(raw);
  return { text: maskPhoneNumbers(raw), flags };
}

function pageParams(query, { defaultSize = 20, maxSize = 50 } = {}) {
  const size = Math.min(Math.max(Number.parseInt(query?.page_size, 10) || defaultSize, 1), maxSize);
  const page = Math.min(Math.max(Number.parseInt(query?.page, 10) || 1, 1), 1000);
  return { size, page, offset: (page - 1) * size };
}

/** Normalised job title used to group salary reports and insights. */
function normalizeTitle(title) {
  return String(title || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
}

const HOURS_PER = { hourly: 1, daily: 8, per_shift: 8, monthly: 173, yearly: 2080 };
function toHourly(amount, period) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n / (HOURS_PER[period] || 1);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

module.exports = {
  featureOff, notFound, positiveId, requireId, viewerHash, cleanUserText, pageParams,
  normalizeTitle, toHourly, percentile, round2, HOURS_PER,
};
