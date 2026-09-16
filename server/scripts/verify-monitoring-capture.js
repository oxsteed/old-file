#!/usr/bin/env node
'use strict';

const fs = require('fs');

if (process.env.NODE_ENV === 'production' || process.env.MONITORING_CAPTURE_TEST_MODE !== 'true') {
  console.error('Refusing to run the local monitoring capture outside the test harness.');
  process.exit(1);
}

const captureFile = String(process.env.SENTRY_CAPTURE_FILE || '').trim();
if (!captureFile) {
  console.error('SENTRY_CAPTURE_FILE is required for the local monitoring capture.');
  process.exit(1);
}

try {
  fs.rmSync(captureFile, { force: true });
  process.env.SENTRY_DSN = process.env.SENTRY_DSN || 'https://0123456789abcdef0123456789abcdef@example.com/1';
  process.env.SENTRY_ENABLED = 'true';
  require('../instrument');
  const Sentry = require('@sentry/node');
  const eventId = Sentry.captureException(new Error('Synthetic Credit monitoring capture'));

  Promise.resolve(Sentry.flush(5000)).then((flushed) => {
    const lines = fs.existsSync(captureFile)
      ? fs.readFileSync(captureFile, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    if (!flushed || !lines.length) throw new Error('Sentry did not flush a captured event');
    const captured = JSON.parse(lines[lines.length - 1]);
    if (captured.message !== 'Synthetic Credit monitoring capture') {
      throw new Error(`Unexpected captured message: ${captured.message}`);
    }
    console.log(JSON.stringify({ ok: true, flushed: true, events: lines.length, eventId }));
  }).catch((error) => {
    console.error(`Monitoring capture verification failed: ${error.message}`);
    process.exitCode = 1;
  });
} catch (error) {
  console.error(`Monitoring capture verification failed: ${error.message}`);
  process.exitCode = 1;
}
