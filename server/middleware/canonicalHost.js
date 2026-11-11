'use strict';

const { getPublicSiteUrl } = require('../utils/publicSiteUrl');

const CANONICAL_HOST = new URL(getPublicSiteUrl()).hostname.toLowerCase();

// Apple fetches each associated domain's file directly. Do not redirect the
// association endpoints from the alternate host: Apple's association
// service does not reliably follow redirects, and native builds may still
// declare both oxsteed.com and www.oxsteed.com.
const APPLE_ASSOCIATION_PATHS = new Set([
  '/.well-known/apple-app-site-association',
  '/apple-app-site-association',
]);

/**
 * Keep public URLs on the single HTTPS origin used by metadata and sitemaps.
 * The tunnel must still route alternate hostnames to the app for this to run.
 */
function canonicalHostRedirect(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();

  const host = String(req.hostname || '').toLowerCase();
  const isAlternateHost = host === `www.${CANONICAL_HOST}`;

  if (!isAlternateHost || APPLE_ASSOCIATION_PATHS.has(req.path)) return next();

  return res.redirect(301, `${getPublicSiteUrl()}${req.originalUrl || '/'}`);
}

module.exports = canonicalHostRedirect;
