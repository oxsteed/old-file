// Sentry must be initialized before any other requires so its OpenTelemetry
// instrumentation can hook into pg, http, and other modules as they load.
const Sentry = require('@sentry/node');

// Wizard defaults sendDefaultPii: true; we default false and opt in via env
// so production does not send automatic PII unless you explicitly enable it.
const sendDefaultPii = process.env.SENTRY_SEND_DEFAULT_PII === 'true';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'production',
  sendDefaultPii,
  tracesSampleRate: 0.2,
});
