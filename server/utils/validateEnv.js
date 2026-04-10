// server/utils/validateEnv.js
// Called once at startup. Exits the process if any REQUIRED var is missing
// so the container fails fast and loudly instead of silently misbehaving.

const REQUIRED = [
  'JWT_SECRET',
  'DATABASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ENCRYPTION_KEY',
];

// Missing these degrades features but doesn't break auth / payments
const OPTIONAL = [
  ['AWS_ACCESS_KEY_ID',        'S3 file uploads disabled'],
  ['AWS_SECRET_ACCESS_KEY',    'S3 file uploads disabled'],
  ['RESEND_API_KEY',           'Transactional emails disabled'],
  ['TWILIO_ACCOUNT_SID',       'SMS / OTP via Twilio disabled'],
  ['DIDIT_WEBHOOK_SECRET',     'Didit identity webhooks disabled'],
  ['CHECKR_API_KEY',           'Background checks disabled'],
  ['OPENAI_API_KEY',           'AI support chat disabled'],
  ['GOOGLE_MAPS_API_KEY',      'Geocoding / distance features disabled'],
  ['STRIPE_CONNECT_CLIENT_ID', 'Stripe Connect onboarding disabled'],
];

module.exports = function validateEnv() {
  const missing = REQUIRED.filter(k => !process.env[k]);

  if (missing.length > 0) {
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
    console.error('');
    console.error('╔══════════════════════════════════════════════════════╗');
    console.error('║  [FATAL] JWT_SECRET must be at least 32 characters   ║');
    console.error('╚══════════════════════════════════════════════════════╝');
    console.error('');
    process.exit(1);
  }

  OPTIONAL.forEach(([key, note]) => {
    if (!process.env[key]) {
      console.warn(`[env] ${key} not set — ${note}`);
    }
  });

  console.log('[env] All required environment variables present ✓');
};
