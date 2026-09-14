// Sentry must be initialized before any other requires so its OpenTelemetry
// instrumentation can hook into pg, http, and other modules as they load.
const Sentry = require('@sentry/node');

// Wizard defaults sendDefaultPii: true; we default false and opt in via env
// so production does not send automatic PII unless you explicitly enable it.
const sendDefaultPii = process.env.SENTRY_SEND_DEFAULT_PII === 'true';
const sentryEnabled = process.env.SENTRY_ENABLED !== 'false' && Boolean(process.env.SENTRY_DSN);

const parseSampleRate = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(Math.max(parsed, 0), 1);
};

const tracesSampleRate = parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.2);
const profilesSampleRate = parseSampleRate(process.env.SENTRY_PROFILES_SAMPLE_RATE, 0);

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: sentryEnabled,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
  release: process.env.SENTRY_RELEASE || process.env.COMMIT_SHA || process.env.SOURCE_COMMIT,
  sendDefaultPii,
  tracesSampleRate,
  profilesSampleRate,
});
