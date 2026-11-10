'use strict';

/**
 * Security review 2026-11-10 F-05: several public routes carry a
 * bearer-equivalent capability in the URL path (invoice, order tracking,
 * broadcast tracking, unsubscribe, consulting feedback, offer and shared
 * cart links). Request logs and Sentry must never record those values, and
 * query strings (which can carry tokens, emails or codes) are dropped.
 *
 * redactUrlForTelemetry(url) returns the path with capability segments
 * replaced by ':redacted' and without the query string or fragment.
 */

const REDACTED = ':redacted';

// [pattern, indexes of capture groups to redact]. Patterns run on the path
// only and are anchored on the route shape, not on the mount, so they still
// match when a router is mounted under a different prefix.
const CAPABILITY_ROUTES = [
  /^(.*\/invoices\/public\/)([^/]+)(.*)$/,
  /^(.*\/orders\/track\/)([^/]+)(.*)$/,
  /^(.*\/broadcast-tracking\/[ocup]\/)([^/]+)(.*)$/,
  /^(.*\/unsubscribe\/)([^/]+)(.*)$/,
  /^(.*\/quotes\/view\/)([^/]+)(.*)$/,
  /^(.*\/t\/public\/)([^/]+)(.*)$/,
  /^(\/api\/o\/)([^/]+)(.*)$/,
  /^(\/api\/shared-carts\/)([^/]+)(.*)$/,
];
const CONSULTING_FEEDBACK = /^(.*\/consulting\/feedback\/)([^/]+)\/([^/]+)(.*)$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_LIKE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

// Any other segment that looks like a random secret (long, mixed letters
// and digits, not a UUID or a plain number/slug) is redacted too, so a new
// capability route is covered before anyone adds it to the list above.
function looksLikeSecret(segment) {
  if (!segment || UUID.test(segment)) return false;
  if (JWT_LIKE.test(segment)) return true;
  if (segment.length < 20) return false;
  if (!/^[A-Za-z0-9_.~%-]+$/.test(segment)) return false;
  return /[0-9]/.test(segment) && /[A-Za-z]/.test(segment) && !/^[a-z]+(?:-[a-z]+)+$/.test(segment);
}

function stripQuery(url) {
  const value = String(url ?? '');
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

function redactPath(path) {
  let out = stripQuery(path);
  const consulting = out.match(CONSULTING_FEEDBACK);
  if (consulting) out = `${consulting[1]}${REDACTED}/${REDACTED}${consulting[4]}`;
  for (const pattern of CAPABILITY_ROUTES) {
    const m = out.match(pattern);
    if (m && m[2] !== REDACTED) out = `${m[1]}${REDACTED}${m[3]}`;
  }
  return out.split('/').map((seg) => (looksLikeSecret(seg) ? REDACTED : seg)).join('/');
}

/** Absolute or relative URL in, redacted URL (origin kept) out. */
function redactUrlForTelemetry(url) {
  const value = String(url ?? '');
  const origin = value.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i)?.[0] || '';
  return origin + redactPath(value.slice(origin.length));
}

module.exports = { REDACTED, redactPath, redactUrlForTelemetry, looksLikeSecret };
