'use strict';

// Review P3-814: chargeback evidence deadlines. Stages evidence for disputes
// whose staging failed and auto-submits before the deadline when nobody has.
const cron = require('node-cron');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const svc = require('../services/chargebackEvidenceService');
const { recordException } = require('../services/reconciliationExceptions');

const CRON_EXPRESSION = '*/15 * * * *';
const JOB_NAME = 'chargeback-evidence-deadline';
const BATCH_SIZE = 25;

async function runChargebackEvidenceDeadline({ limit = BATCH_SIZE } = {}) {
  const result = { locked: false, staged: 0, submitted: 0, failed: 0 };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result.locked = true;
    const lead = svc.autoSubmitLeadHours();
    const { rows } = await fence.db.query(
      `SELECT * FROM stripe_chargebacks
        WHERE evidence_submitted_at IS NULL
          AND stripe_status IN ('needs_response', 'warning_needs_response')
          AND (evidence_staged_at IS NULL
               OR (evidence_due_by IS NOT NULL AND evidence_due_by <= NOW() + make_interval(hours => $2::int)))
        ORDER BY evidence_due_by ASC NULLS FIRST
        LIMIT $1`,
      [Math.min(BATCH_SIZE, Math.max(1, Number(limit) || BATCH_SIZE)), Math.round(lead)]
    );
    for (const row of rows) {
      const due = row.evidence_due_by ? new Date(row.evidence_due_by) : null;
      const nearDeadline = due && due.getTime() <= Date.now() + lead * 3600000;
      const submit = Boolean(nearDeadline && svc.autoSubmitEnabled());
      try {
        await svc.pushEvidence(row, { submit, auto: submit }, fence.db);
        if (submit) result.submitted += 1; else result.staged += 1;
      } catch (err) {
        result.failed += 1;
        logger.error('Chargeback evidence job failed for dispute', { disputeId: row.stripe_dispute_id, error: err.message });
        await recordException({
          domain: 'chargeback_evidence',
          referenceId: String(row.id),
          severity: nearDeadline ? 'critical' : 'warning',
          summary: `Chargeback evidence ${submit ? 'submission' : 'staging'} failed for ${row.stripe_dispute_id}`,
          details: { error: String(err.message || '').slice(0, 500), dueBy: row.evidence_due_by },
          sourceRunId: JOB_NAME,
        }).catch(() => {});
      }
    }
  }, 600, { throwOnLockError: false });
  return result;
}

function startChargebackEvidenceDeadlineJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runChargebackEvidenceDeadline().catch((error) => {
      logger.error('Chargeback evidence deadline worker failed', { error: error.message });
    });
  }, { timezone: 'UTC' });
  logger.info('Chargeback evidence deadline job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = { CRON_EXPRESSION, JOB_NAME, runChargebackEvidenceDeadline, startChargebackEvidenceDeadlineJob };
