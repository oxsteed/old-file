'use strict';

const { getPublicSiteUrl } = require('../utils/publicSiteUrl');

const CANONICAL_HOST = new URL(getPublicSiteUrl()).hostname.toLowerCase();

/**
 * Keep public URLs on the single HTTPS origin used by metadata and sitemaps.
 * The tunnel must still route alternate hostnames to the app for this to run.
 */
function canonicalHostRedirect(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();

  const host = String(req.hostname || '').toLowerCase();
  const isAlternateHost = host === `www.${CANONICAL_HOST}`;
  const isInsecureCanonicalHost = host === CANONICAL_HOST && req.protocol !== 'https';

  if (!isAlternateHost && !isInsecureCanonicalHost) return next();

  return res.redirect(301, `${getPublicSiteUrl()}${req.originalUrl || '/'}`);
}

module.exports = canonicalHostRedirect;
