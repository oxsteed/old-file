'use strict';

// Review P3-888: receipts stuck in 'processing' (process crashed mid-handler)
// are released to 'failed' so the provider's next retry reprocesses them, and
// each one is raised in the reconciliation-exceptions queue for operators.
const cron = require('node-cron');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { recordException } = require('../services/reconciliationExceptions');

const CRON_EXPRESSION = '*/10 * * * *';
const JOB_NAME = 'webhook-receipt-recovery';
const STALE_MINUTES = 15;

async function runWebhookReceiptRecovery({ limit = 200 } = {}) {
  const result = { locked: false, released: 0 };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result.locked = true;
    const { rows } = await fence.db.query(
      `UPDATE webhook_event_receipts
          SET status = 'failed',
              last_error = LEFT(COALESCE(last_error || ' | ', '') || 'released: processing stalled (crash or timeout)', 1000),
              last_seen_at = NOW()
        WHERE id IN (
          SELECT id FROM webhook_event_receipts
           WHERE status = 'processing'
             AND last_seen_at < NOW() - make_interval(mins => $2::int)
           ORDER BY last_seen_at ASC
           LIMIT $1
        )
        RETURNING id, provider, event_id, event_type`,
      [Math.min(1000, Math.max(1, Number(limit) || 200)), STALE_MINUTES]
    );
    result.released = rows.length;
    for (const row of rows) {
      await recordException({
        domain: 'webhook_receipt',
        referenceId: `${row.provider}:${row.event_id}`,
        severity: 'warning',
        summary: `Webhook ${row.provider} ${row.event_type || ''} ${row.event_id} stalled while processing; awaiting provider retry`,
        details: { receiptId: row.id },
        sourceRunId: JOB_NAME,
      });
    }
    if (rows.length) logger.warn('Released stalled webhook receipts', { count: rows.length });
  }, 300, { throwOnLockError: false });
  return result;
}

function startWebhookReceiptRecoveryJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runWebhookReceiptRecovery().catch((error) => {
      logger.error('Webhook receipt recovery failed', { error: error.message });
    });
  }, { timezone: 'UTC' });
}

module.exports = { JOB_NAME, STALE_MINUTES, runWebhookReceiptRecovery, startWebhookReceiptRecoveryJob };
