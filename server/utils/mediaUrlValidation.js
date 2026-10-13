'use strict';

// Shared media URL validation for user-supplied image URLs (profile photos,
// business logos/covers, gallery images).
//
// Allowlist only: the host must be one of our storage/CDN hosts (or, in
// non-production, the local /api/storage/public/ route) and the scheme must be
// https. Rejects:
// - http (except the local storage route in non-production)
// - any host outside the allowlist (including private IPs and SSRF targets)
// - IPv4-mapped IPv6 literals ([::ffff:127.0.0.1], [::ffff:10.0.0.1], …)
// - trailing-dot localhost / DNS rebinding tricks (localhost., 127.0.0.1.)
// - javascript:/data:/file: schemes
//
// Allowed hosts come from env (S3_PUBLIC_BASE_URL, APP_URL, CLIENT_URL, the
// AWS/S3 bucket+region, AWS_S3_ENDPOINT / S3_ENDPOINT) plus any hosts listed
// in MEDIA_URL_ALLOWED_HOSTS (comma-separated). Operators can extend the list
// without a code change.

const { AppError } = require('../middleware/errorHandler');

const MAX_URL_LENGTH = 2048;

function hostFromUrlString(value) {
  if (!value) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

function stripTrailingDot(host) {
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

function collectAllowedHosts() {
  const hosts = new Set();
  const add = (value) => {
    const host = hostFromUrlString(value);
    if (host) hosts.add(stripTrailingDot(host));
  };

  add(process.env.S3_PUBLIC_BASE_URL);
  add(process.env.APP_URL);
  add(process.env.CLIENT_URL);
  add(process.env.AWS_S3_ENDPOINT || process.env.S3_ENDPOINT);

  const bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || 'us-east-1';
  if (bucket) {
    add(`${bucket}.s3.${region}.amazonaws.com`);
    add(`${bucket}.s3.amazonaws.com`);
    // Virtual-hosted–style regional endpoints (dualstack / accelerate not used).
    add(`${bucket}.s3-${region}.amazonaws.com`);
  }

  for (const part of String(process.env.MEDIA_URL_ALLOWED_HOSTS || '').split(',')) {
    add(part.trim());
  }

  // The production app host serves local-storage uploads
  // (/api/storage/public/...) even if APP_URL is unset in a given process.
  add('oxsteed.com');
  add('www.oxsteed.com');

  return hosts;
}

let cachedHosts = null;
let cachedSignature = '';

function allowedHosts() {
  const signature = [
    process.env.S3_PUBLIC_BASE_URL,
    process.env.APP_URL,
    process.env.CLIENT_URL,
    process.env.AWS_S3_ENDPOINT,
    process.env.S3_ENDPOINT,
    process.env.AWS_S3_BUCKET,
    process.env.S3_BUCKET,
    process.env.AWS_REGION,
    process.env.MEDIA_URL_ALLOWED_HOSTS,
  ].join('|');
  if (cachedHosts && cachedSignature === signature) return cachedHosts;
  cachedHosts = collectAllowedHosts();
  cachedSignature = signature;
  return cachedHosts;
}

/** Reset the host cache (tests only). */
function _resetAllowedHostsCache() {
  cachedHosts = null;
  cachedSignature = '';
}

function isIpv4MappedIpv6(host) {
  return host.startsWith('::ffff:');
}

function isLocalStoragePath(pathname) {
  return pathname === '/api/storage/public' || pathname.startsWith('/api/storage/public/');
}

function isLoopbackOrLocalHost(host) {
  const bare = stripTrailingDot(host);
  return bare === 'localhost'
    || bare === '127.0.0.1'
    || bare === '::1'
    || bare === '0.0.0.0'
    || bare.startsWith('127.');
}

function validateMediaUrl(url, field) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new AppError(`Invalid ${field}: URL too long`, 400, 'validation_failed');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError(`Invalid ${field}: must be a valid URL`, 400, 'validation_failed');
  }

  const host = stripTrailingDot(parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''));
  const isLocalDevRoute = process.env.NODE_ENV !== 'production'
    && isLoopbackOrLocalHost(host)
    && isLocalStoragePath(parsed.pathname)
    && (parsed.protocol === 'http:' || parsed.protocol === 'https:');

  if (isLocalDevRoute) {
    // Local uploads in non-production: /api/storage/public/<key> on the app
    // itself. Never accept this shape in production.
    return trimmed.slice(0, MAX_URL_LENGTH);
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError(`Invalid ${field}: only https URLs are allowed`, 400, 'validation_failed');
  }

  if (!host || isIpv4MappedIpv6(host) || isLoopbackOrLocalHost(host)) {
    throw new AppError(`Invalid ${field}: host is not allowed`, 400, 'validation_failed');
  }

  if (!allowedHosts().has(host)) {
    throw new AppError(`Invalid ${field}: host is not on the media allowlist`, 400, 'validation_failed');
  }

  return trimmed.slice(0, MAX_URL_LENGTH);
}

/**
 * Review P3-6-F12: normalize a caller-supplied attachment reference to a safe
 * stored value. Exactly one policy, shared by every support-message creation
 * path so the rule cannot drift between call sites.
 *
 * Signed download URLs are bearer tokens: the signature is bound to the key
 * and expiry only, not to the conversation they were minted for. Storing one
 * verbatim as a support attachment launders it into a new context, where
 * every thread viewer can use it to fetch a private object from elsewhere.
 * This normalizer therefore never accepts a bearer token:
 *  - relative /api/storage/public/<key> references are accepted with any
 *    query string stripped (the public route ignores it; a signature there
 *    is either meaningless or smuggled);
 *  - relative /api/storage/files/<key> references are rejected outright: the
 *    files route requires a signature, so a reference without one is dead
 *    and a reference with one is a laundered bearer token. The supported
 *    path is uploading the file directly (multipart), after which the server
 *    mints its own scoped signed URL;
 *  - absolute https URLs go through validateMediaUrl, then bearer shapes are
 *    rejected: this app's own signed download route (/api/storage/files/ on
 *    an app host) and S3-style presigned URLs (X-Amz-Signature query).
 *
 * Returns { url, name } on success or { error } when the reference is unsafe.
 */
function normalizeAttachmentReference(attachmentUrl, attachmentName) {
  const rawUrl = String(attachmentUrl ?? '').trim();
  const rawName = String(attachmentName ?? '').trim();
  if (!rawUrl) return { url: null, name: rawName.slice(0, 255) || null };
  if (rawUrl.length > MAX_URL_LENGTH) return { error: 'Attachment URL is too long' };

  const name = rawName.slice(0, 255) || null;

  // Relative storage references minted by this app. Never accept an arbitrary
  // /api/storage path that could point at an unrelated object, and never
  // accept the signed (bearer) route.
  if (rawUrl.startsWith('/api/storage/')) {
    const pathOnly = rawUrl.split('?')[0].split('#')[0];
    const publicMatch = /^\/api\/storage\/public\/(.+)$/.exec(pathOnly);
    if (!publicMatch || !publicMatch[1]) {
      return { error: 'Signed download links cannot be attached. Upload the file directly instead.' };
    }
    return { url: pathOnly, name };
  }

  let validated;
  try {
    validated = validateMediaUrl(rawUrl, 'attachment URL');
  } catch (err) {
    return { error: err.message || 'Attachment URL is not allowed' };
  }

  // Bearer-token shapes over the absolute form: this app's own signed
  // download route, or an S3-style presigned URL. Both would launder private
  // object access into the support thread.
  let parsed;
  try {
    parsed = new URL(validated);
  } catch {
    return { error: 'Attachment URL is not allowed' };
  }
  const host = stripTrailingDot(parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''));
  if (appStorageHosts().has(host) && parsed.pathname.startsWith('/api/storage/files/')) {
    return { error: 'Signed download links cannot be attached. Upload the file directly instead.' };
  }
  for (const [param] of parsed.searchParams) {
    const lower = param.toLowerCase();
    if (lower === 'x-amz-signature' || lower === 'x-amz-credential') {
      return { error: 'Presigned storage links cannot be attached. Upload the file directly instead.' };
    }
  }

  return { url: validated, name };
}

// Hosts that serve this app's /api/storage routes: a signed download URL on
// any of them is a bearer token for a private object.
function appStorageHosts() {
  const hosts = new Set(['oxsteed.com', 'www.oxsteed.com']);
  for (const raw of [process.env.APP_URL, process.env.CLIENT_URL]) {
    const host = hostFromUrlString(raw);
    if (host) hosts.add(stripTrailingDot(host));
  }
  return hosts;
}

module.exports = {
  validateMediaUrl,
  normalizeAttachmentReference,
  MAX_URL_LENGTH,
  _resetAllowedHostsCache,
  _allowedHosts: allowedHosts,
};
