// Sentry must be initialized before any other requires so its OpenTelemetry
// instrumentation can hook into pg, http, and other modules as they load.
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'production',
  sendDefaultPii: false,
  tracesSampleRate: 0.2,
});
