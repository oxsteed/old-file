// server/utils/profileSlug.js
// Vanity profile slug validation, normalization, and suggestion helpers.
// Shared by the availability-check and claim endpoints for helper/business profiles.
//
// Rules:
//  - 3–64 chars, lowercase letters / digits / hyphens, may not start or end with a hyphen
//  - case-insensitive uniqueness is enforced by the CITEXT UNIQUE columns
//  - reserved words can never be claimed

'use strict';

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$/;
const MIN_LEN = 3;
const MAX_LEN = 64;

// Words that must never become a profile slug (site routes, confusing names, abuse).
const RESERVED = new Set([
  'admin', 'administrator', 'api', 'app', 'assets', 'static',
  'help', 'support', 'contact', 'about', 'blog', 'press', 'careers',
  'login', 'logout', 'signin', 'signout', 'signup', 'register', 'auth',
  'settings', 'setting', 'account', 'profile', 'profiles', 'dashboard',
  'billing', 'payments', 'payment', 'checkout', 'pricing',
  'search', 'explore', 'discover', 'nearby',
  'helper', 'helpers', 'business', 'businesses', 'job', 'jobs',
  'delivery', 'book', 'booking', 'bookings', 'inbox', 'messages',
  'notifications', 'wallet', 'payout', 'payouts',
  'h', 'b', 'me', 'me2', 'you', 'user', 'users',
  'www', 'mail', 'ftp', 'root', 'system', 'null', 'undefined',
  'test', 'demo', 'example', 'official', 'verified', 'staff', 'team',
  'new', 'edit', 'create', 'delete', 'update',
]);

// Change cooldown: a claimed slug can be changed again after this long.
const SLUG_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeSlug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LEN);
}

function validateSlug(raw) {
  const slug = String(raw || '').trim().toLowerCase();
  if (!slug) return { ok: false, slug, reason: 'empty' };
  if (slug.length < MIN_LEN) return { ok: false, slug, reason: 'too_short' };
  if (slug.length > MAX_LEN) return { ok: false, slug, reason: 'too_long' };
  if (!SLUG_RE.test(slug)) return { ok: false, slug, reason: 'invalid_chars' };
  if (RESERVED.has(slug)) return { ok: false, slug, reason: 'reserved' };
  return { ok: true, slug };
}

// Build "mike-plumber", "mike-plumber-2", … suggestions when the wanted slug is taken.
// `taken` is a predicate/Set the caller wires to the DB so suggestions skip claimed slugs.
async function suggestSlugs(base, { count = 3, isTaken } = {}) {
  const suggestions = [];
  const tried = new Set([base]);
  const candidates = [];
  for (let i = 2; i < 200 && candidates.length < count * 4; i++) {
    candidates.push(`${base}-${i}`);
  }
  // Location-flavored fallbacks help humans pick something memorable.
  for (const suffix of ['hq', 'pro', 'co', 'official']) {
    candidates.push(`${base}-${suffix}`);
  }
  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    if (candidate.length > MAX_LEN) continue;
    if (RESERVED.has(candidate)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (isTaken && (await isTaken(candidate))) continue;
    suggestions.push(candidate);
    if (suggestions.length >= count) break;
  }
  return suggestions;
}

module.exports = {
  SLUG_RE,
  MIN_LEN,
  MAX_LEN,
  RESERVED,
  SLUG_CHANGE_COOLDOWN_MS,
  normalizeSlug,
  validateSlug,
  suggestSlugs,
};
