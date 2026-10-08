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

module.exports = {
  validateMediaUrl,
  MAX_URL_LENGTH,
  _resetAllowedHostsCache,
  _allowedHosts: allowedHosts,
};
