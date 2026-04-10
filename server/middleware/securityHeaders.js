const helmet = require('helmet');

/**
 * Security headers middleware.
 * Wraps Helmet with a Permissions-Policy header appended after.
 * CSP, HSTS, X-Frame-Options, and all other security headers
 * appropriate for the OxSteed marketplace platform.
 */
const helmeted = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   [
        "'self'",
        'https://js.stripe.com',
        'https://www.googletagmanager.com',
        'https://www.google-analytics.com',
      ],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc:      ["'self'", 'data:', 'https:', 'blob:'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      connectSrc:  [
        "'self'",
        'https://api.stripe.com',
        'https://verify.didit.me',
        'https://api.didit.me',
        'https://www.google-analytics.com',
        process.env.CLIENT_URL || 'https://oxsteed.com',
      ],
      frameSrc:    ['https://js.stripe.com', 'https://hooks.stripe.com', 'https://verify.didit.me'],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  strictTransportSecurity: {
    maxAge:           31536000,
    includeSubDomains: true,
    preload:           true,
  },
  frameguard:                    { action: 'deny' },
  noSniff:                       true,
  xssFilter:                     true,
  referrerPolicy:                { policy: 'strict-origin-when-cross-origin' },
  hidePoweredBy:                 true,
  dnsPrefetchControl:            { allow: false },
  ieNoOpen:                      true,
  permittedCrossDomainPolicies:  { permittedPolicies: 'none' },
});

// Permissions-Policy: lock down browser features not used by the platform
function securityHeaders(req, res, next) {
  helmeted(req, res, () => {
    res.setHeader(
      'Permissions-Policy',
      [
        'camera=()',
        'microphone=()',
        'geolocation=(self)',
        'payment=(self "https://js.stripe.com")',
        'usb=()',
        'bluetooth=()',
      ].join(', ')
    );
    next();
  });
}

module.exports = securityHeaders;
