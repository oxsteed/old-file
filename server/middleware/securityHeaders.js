const helmet = require('helmet');

/** Allowed external script origins — mirrored on script-src and script-src-elem for consistent browser behavior */
const SCRIPT_SOURCES = [
  "'self'",
  'https://js.stripe.com',
  'https://www.googletagmanager.com',
  'https://www.google-analytics.com',
  // Cloudflare Web Analytics beacon when proxied via CF
  'https://static.cloudflareinsights.com',
];
const AWS_LOCATION_REGION = process.env.AWS_REGION || 'us-east-1';

function imageSourceList(env = process.env) {
  const region = /^[a-z0-9-]+$/.test(String(env.AWS_REGION || ''))
    ? String(env.AWS_REGION)
    : 'us-east-1';
  const sources = [
    "'self'",
    'data:',
    'blob:',
    `https://tiles.geo.${region}.amazonaws.com`,
    `https://maps.geo.${region}.amazonaws.com`,
    'https://images.unsplash.com',
  ];
  const bucket = String(env.AWS_S3_BUCKET || env.S3_BUCKET || '').trim();
  if (/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    sources.push(
      `https://${bucket}.s3.${region}.amazonaws.com`,
      `https://${bucket}.s3.amazonaws.com`,
      `https://${bucket}.s3-${region}.amazonaws.com`,
    );
  }
  const publicBase = String(env.S3_PUBLIC_BASE_URL || '').trim();
  if (publicBase) {
    try {
      const url = new URL(publicBase);
      if (url.protocol === 'https:' && url.hostname) sources.push(url.origin);
    } catch {
      // An unparsable public base does not widen img-src.
    }
  }
  return [...new Set(sources)];
}

/**
 * Security headers middleware using Helmet.js.
 * Configures CSP, HSTS, X-Frame-Options, and other security headers
 * appropriate for the OxSteed marketplace platform.
 *
 * Usage in app.js:
 *   const securityHeaders = require('./middleware/securityHeaders');
 *   app.use(securityHeaders);
 */
const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: SCRIPT_SOURCES,
      scriptSrcElem: SCRIPT_SOURCES,
      workerSrc: ["'self'", 'blob:'],
      // NOTE: styleSrc still carries 'unsafe-inline' because the SPA
      // renders 5,292 inline style={} attributes across 269 client files
      // (baseline pinned by client/scripts/noNewInlineStyles.mjs, which
      // fails the build if the count grows). Inline style attributes
      // cannot carry nonces, so they must become CSS classes before this
      // allowance can drop; converting them en masse is unsafe without a
      // visual harness because inline styles outrank classes in the
      // cascade. What this track did complete: all client <style> tags
      // except StatusPage's (unscoped #main-content rule, see the baseline
      // file) were extracted to CSS files, and server-rendered documents
      // with their own <style> block use a per-response nonce (see
      // server/utils/cspNonce.js, first consumer: gift-card print).
      // imgSrc drops the 'https:' wildcard. Retained hosts are
      // same-origin media, data: and blob: URLs, AWS Location map tiles,
      // the Unsplash sample gallery, and, when configured, this app's S3
      // bucket plus the https origin of S3_PUBLIC_BASE_URL.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: imageSourceList(),
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: [
        "'self'",
        'ws:',
        'wss:',
        'https://api.stripe.com',
        'https://verify.didit.me',
        'https://api.didit.me',
        'https://www.google-analytics.com',
        // Public helper profile: geocode city/state when lat/lng missing (LocationSection)
        'https://nominatim.openstreetmap.org',
        'https://static.cloudflareinsights.com',
        `https://maps.geo.${AWS_LOCATION_REGION}.amazonaws.com`,
        `https://tiles.geo.${AWS_LOCATION_REGION}.amazonaws.com`,
        process.env.CLIENT_URL || 'https://oxsteed.com',
        'https://o4511157112471552.ingest.us.sentry.io',
      ],
      frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com', 'https://verify.didit.me'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  // Strict Transport Security: 1 year, include subdomains
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  // Prevent clickjacking
  frameguard: { action: 'deny' },
  // Prevent MIME type sniffing
  noSniff: true,
  // XSS filter (legacy browsers)
  xssFilter: true,
  // Referrer policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Hide X-Powered-By header
  hidePoweredBy: true,
  // DNS prefetch control
  dnsPrefetchControl: { allow: false },
  // Isolate the document from cross-origin opener and resource contexts.
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  originAgentCluster: true,
  // IE no-open
  ieNoOpen: true,
  // Permissions policy
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
});

module.exports = securityHeaders;
module.exports.imageSourceList = imageSourceList;
