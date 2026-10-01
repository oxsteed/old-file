// server/utils/validateEnv.js
// Called once at startup. Exits the process if any REQUIRED var is missing
// so the container fails fast and loudly instead of silently misbehaving.

const logger = require('./logger');
const { parseDatabaseUrl } = require('./databaseConfig');

const REQUIRED = [
  'JWT_SECRET',
  'DATABASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ENCRYPTION_KEY',
];

// Missing these disables the corresponding feature, not the entire API.
const OPTIONAL = [
  ['SENTRY_DSN',               'Server error monitoring unavailable; Credit production activation disabled'],
  ['SECURITY_ALERT_EMAIL',     'Security incident email alerts use the default recipient'],
  ['SLACK_SECURITY_WEBHOOK',   'Slack security incident alerts disabled'],
  ['CLAMAV_HOST',              'ClamAV malware scanning unavailable unless static validation is approved'],
  ['AWS_ACCESS_KEY_ID',        'S3 file uploads disabled'],
  ['AWS_SECRET_ACCESS_KEY',    'S3 file uploads disabled'],
  ['AWS_REGION',               'Amazon Location and S3 region defaults are unavailable'],
  ['AWS_GEO_PLACES_ENABLED',   'Amazon Location Places v2 disabled'],
  ['AWS_GEO_ROUTES_ENABLED',   'Amazon Location Routes v2 disabled'],
  ['RESEND_API_KEY',           'Transactional emails disabled'],
  ['TWILIO_ACCOUNT_SID',       'SMS / OTP via Twilio disabled'],
  ['DIDIT_WEBHOOK_SECRET',     'Didit identity webhooks disabled'],
  ['CHECKR_API_KEY',           'Background checks disabled'],
  ['OPENAI_API_KEY',           'AI support chat disabled'],
  ['META_AI_API_KEY',          'Meta AI chat provider disabled; OpenRouter fallback used when configured'],
  ['GOOGLE_MAPS_API_KEY',      'Geocoding / distance features disabled'],
  ['STRIPE_PUBLISHABLE_KEY', 'Marketplace card checkout and mobile payment setup unavailable'],
  ['STRIPE_CONNECT_WEBHOOK_SECRET', 'Connected-account webhook reconciliation unavailable'],
  ['STRIPE_IDENTITY_WEBHOOK_SECRET', 'Stripe Identity webhook verification unavailable'],
  ['STRIPE_CLIENT_ID', 'Business Stripe OAuth onboarding unavailable; helper Express onboarding is separate'],
];

function looksLikePlaceholder(value) {
  if (!value) return false;
  const lowered = String(value).toLowerCase();
  return [
    'placeholder',
    'change-me',
    'change_this',
    'replace-me',
    'replace_this',
    'todo',
    'test_only',
    'dev-',
  ].some((token) => lowered.includes(token));
}

function warnIfSuspicious(key, note) {
  const value = process.env[key];
  if (!value) return;

  const lowered = String(value).toLowerCase();
  if (
    looksLikePlaceholder(lowered) ||
    (key === 'STRIPE_SECRET_KEY' && lowered.startsWith('sk_test_')) ||
    (key === 'STRIPE_WEBHOOK_SECRET' && lowered.startsWith('whsec_test_')) ||
    (key === 'JWT_SECRET' && lowered.length < 32)
  ) {
    logger.warn('Suspicious environment variable value detected', { key, impact: note });
  }
}

function getProductionConfigurationErrors(env = process.env) {
  if ((env.NODE_ENV || 'production') !== 'production') return [];

  const errors = [];
  const requiredProductionSecrets = [
    'JWT_SECRET',
    'DATABASE_URL',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'ENCRYPTION_KEY',
    'OXSTEED_CREDIT_LEDGER_HMAC_SECRET',
  ];
  requiredProductionSecrets.forEach((key) => {
    if (!env[key]) {
      errors.push(`${key} is required in production`);
    } else if (looksLikePlaceholder(env[key])) {
      errors.push(`${key} contains a placeholder value`);
    }
  });
  if (env.DATABASE_URL) {
    try {
      parseDatabaseUrl(env.DATABASE_URL);
    } catch (error) {
      errors.push(`DATABASE_URL is invalid: ${error.message}`);
    }
  }
  if (String(env.STRIPE_SECRET_KEY || '').toLowerCase().startsWith('sk_test_')) {
    errors.push('STRIPE_SECRET_KEY must use a live Stripe key in production');
  }
  if (String(env.STRIPE_WEBHOOK_SECRET || '').toLowerCase().startsWith('whsec_test_')) {
    errors.push('STRIPE_WEBHOOK_SECRET must use a live Stripe signing secret in production');
  }
  return errors;
}

module.exports = function validateEnv() {
  const missing = REQUIRED.filter(k => !process.env[k]);

  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missing });
    console.error('');
    console.error('╔══════════════════════════════════════════════════════╗');
    console.error('║  [FATAL] Missing required environment variables       ║');
    console.error('╠══════════════════════════════════════════════════════╣');
    missing.forEach(k => console.error(`║  ✗ ${k.padEnd(50)}║`));
    console.error('╚══════════════════════════════════════════════════════╝');
    console.error('');
    console.error('Set these variables and restart the server.');
    process.exit(1);
  }

  if (process.env.JWT_SECRET.length < 32) {
    logger.error('JWT_SECRET must be at least 32 characters');
    console.error('');
    console.error('╔══════════════════════════════════════════════════════╗');
    console.error('║  [FATAL] JWT_SECRET must be at least 32 characters   ║');
    console.error('╚══════════════════════════════════════════════════════╝');
    console.error('');
    process.exit(1);
  }

  if (!/^[a-fA-F0-9]{64}$/.test(process.env.ENCRYPTION_KEY || '')) {
    logger.error('ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes)');
    process.exit(1);
    return;
  }

  const productionConfigurationErrors = getProductionConfigurationErrors();
  if (productionConfigurationErrors.length > 0) {
    logger.error('Unsafe production environment configuration', {
      variables: productionConfigurationErrors,
    });
    console.error('Production startup blocked: replace placeholder or test credentials before accepting traffic.');
    process.exit(1);
    return;
  }

  OPTIONAL.forEach(([key, note]) => {
    if (!process.env[key]) {
      logger.warn('Optional environment variable not set', { key, impact: note });
    }
  });

  if ((process.env.NODE_ENV || 'production') === 'production' && process.env.SENTRY_ENABLED === 'false') {
    logger.warn('Server error monitoring is explicitly disabled', {
      impact: 'OxSteed Credit production activation disabled',
    });
  }

  warnIfSuspicious('JWT_SECRET', 'Auth tokens may be easy to guess');
  warnIfSuspicious('ENCRYPTION_KEY', 'Stored secrets may not be protected');
  warnIfSuspicious('STRIPE_SECRET_KEY', 'Payments may be using test or placeholder credentials');
  warnIfSuspicious('STRIPE_WEBHOOK_SECRET', 'Webhook verification may be using test or placeholder credentials');

  logger.info('All required environment variables present');
};

module.exports.getProductionConfigurationErrors = getProductionConfigurationErrors;
module.exports.looksLikePlaceholder = looksLikePlaceholder;
