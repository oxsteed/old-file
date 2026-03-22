const helmet = require('helmet');

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
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Required for React inline scripts
        'https://js.stripe.com',
        'https://www.googletagmanager.com',
        'https://www.google-analytics.com',
      ],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: [
        "'self'",
        'https://api.stripe.com',
        'https://api.checkr.com',
        'https://www.google-analytics.com',
        process.env.CLIENT_URL || 'https://oxsteed.com',
      ],
      frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com'],
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
  // IE no-open
  ieNoOpen: true,
  // Permissions policy
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
});

module.exports = securityHeaders;
