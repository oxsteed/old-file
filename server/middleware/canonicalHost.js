'use strict';

const { getPublicSiteUrl } = require('../utils/publicSiteUrl');

const CANONICAL_HOST = new URL(getPublicSiteUrl()).hostname.toLowerCase();

function getOriginalProtocol(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  if (forwardedProto) return forwardedProto;

  // cloudflared terminates TLS at Cloudflare and forwards the request over HTTP.
  // CF-Visitor preserves the scheme the customer actually used.
  if (req.get('cf-ray')) {
    try {
      const visitor = JSON.parse(req.get('cf-visitor'));
      if (visitor?.scheme) return String(visitor.scheme).toLowerCase();
    } catch {
      // Ignore malformed proxy metadata and use the secure tunnel default below.
    }
    // A Cloudflare tunnel may omit CF-Visitor on an already HTTPS request.
    // Treat that proxied request as secure rather than creating a loop.
    return 'https';
  }

  return req.protocol;
}

/**
 * Keep public URLs on the single HTTPS origin used by metadata and sitemaps.
 * The tunnel must still route alternate hostnames to the app for this to run.
 */
function canonicalHostRedirect(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();

  const host = String(req.hostname || '').toLowerCase();
  const isAlternateHost = host === `www.${CANONICAL_HOST}`;
  const isInsecureCanonicalHost = host === CANONICAL_HOST && getOriginalProtocol(req) !== 'https';

  if (!isAlternateHost && !isInsecureCanonicalHost) return next();

  return res.redirect(301, `${getPublicSiteUrl()}${req.originalUrl || '/'}`);
}

module.exports = canonicalHostRedirect;
