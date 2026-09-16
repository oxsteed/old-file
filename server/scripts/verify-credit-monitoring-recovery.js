#!/usr/bin/env node
'use strict';

const fs = require('fs');

if (process.env.NODE_ENV === 'production'
  || process.env.MONITORING_RECOVERY_TEST_MODE !== 'true'
  || !/^oxsteed-credit-test-[a-z0-9-]+$/.test(String(process.env.CREDIT_TEST_PROJECT || ''))) {
  console.error('Refusing to run the Credit monitoring recovery test outside the isolated harness.');
  process.exit(1);
}

const captureFile = String(process.env.SENTRY_CAPTURE_FILE || '').trim();
if (!captureFile) {
  console.error('SENTRY_CAPTURE_FILE is required for the Credit monitoring recovery test.');
  process.exit(1);
}

process.env.SENTRY_DSN = process.env.SENTRY_DSN || 'https://0123456789abcdef0123456789abcdef@example.com/1';
process.env.SENTRY_ENABLED = 'true';

const Sentry = require('@sentry/node');
require('../instrument');
const db = require('../db');
const {
  WORKER_CONFIG,
  runOxsteedCreditWorkerWatchdog,
} = require('../jobs/oxsteedCreditWorkerWatchdog');

async function main() {
  fs.rmSync(captureFile, { force: true });
  const staleAt = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000));
  const ageHeartbeats = async () => {
    for (const worker of WORKER_CONFIG) {
      await db.query(
        `INSERT INTO oxsteed_credit_worker_heartbeats
           (job_name, last_run_at, last_success_at, last_error, last_result,
            run_count, consecutive_failures, updated_at)
         VALUES ($1, $2, $2, $3, '{}'::jsonb, 1, 1, NOW())
         ON CONFLICT (job_name) DO UPDATE SET
           last_run_at = EXCLUDED.last_run_at,
           last_success_at = EXCLUDED.last_success_at,
           last_error = EXCLUDED.last_error,
           consecutive_failures = EXCLUDED.consecutive_failures,
           updated_at = NOW()`,
        [worker.jobName, staleAt, 'Synthetic monitoring recovery failure'],
      );
    }
  };

  const eventId = Sentry.captureException(new Error('Synthetic Credit watchdog stale capture'));
  let stale;
  // Live fixture workers may update one heartbeat during failure injection.
  // Re-age and retry briefly instead of making the synthetic check flaky.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await ageHeartbeats();
    stale = await runOxsteedCreditWorkerWatchdog();
    if (stale.status === 'stale' && stale.incidents.length >= WORKER_CONFIG.length) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (stale.status !== 'stale' || stale.incidents.length < WORKER_CONFIG.length) {
    throw new Error(`Watchdog did not detect all stale workers: ${stale.status}/${stale.incidents.length}`);
  }

  await db.query(
    `UPDATE oxsteed_credit_worker_heartbeats
        SET last_run_at = NOW(), last_success_at = NOW(), last_error = NULL,
            consecutive_failures = 0, updated_at = NOW()
      WHERE job_name = ANY($1::text[])`,
    [WORKER_CONFIG.map(({ jobName }) => jobName)],
  );
  const recovered = await runOxsteedCreditWorkerWatchdog();
  if (recovered.status !== 'healthy' || recovered.recoveredIncidents.length < WORKER_CONFIG.length) {
    throw new Error(`Watchdog did not resolve recovered workers: ${recovered.status}/${recovered.recoveredIncidents.length}`);
  }

  const flushed = await Sentry.flush(5000);
  const lines = fs.existsSync(captureFile)
    ? fs.readFileSync(captureFile, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  const captured = lines.map((line) => JSON.parse(line));
  if (!flushed || !captured.some((event) => event.message === 'Synthetic Credit watchdog stale capture')) {
    throw new Error('The watchdog monitoring event was not captured locally.');
  }

  console.log(JSON.stringify({
    ok: true,
    detectedStatus: stale.status,
    recoveredStatus: recovered.status,
    staleIncidents: stale.incidents.length,
    recoveredIncidents: recovered.recoveredIncidents.length,
    monitoringEvents: lines.length,
    eventId,
  }));
}

main()
  .catch((error) => {
    console.error(`Credit monitoring recovery failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.end().catch(() => {}));
