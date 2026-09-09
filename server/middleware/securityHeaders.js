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
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
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
