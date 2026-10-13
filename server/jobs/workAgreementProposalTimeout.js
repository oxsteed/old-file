'use strict';

// Review P1-3-F07: the proposal-sign timeout, enforced on a schedule.
// Authorship is assent: when the current version of a pending_signatures
// agreement was written by party X and the counterparty signed those exact
// terms, X cannot stall activation forever on their own proposal. After
// PROPOSAL_SIGN_TIMEOUT_DAYS with notice (sent when the counterparty signs)
// and no action from X, the agreement activates on the terms X wrote.
// This never forges consent — both parties manifested assent to the same
// content (X by authoring, the counterparty by signing).
//
// The same rule is enforced inline in createVersion (same lock) so a
// stalling author cannot beat this worker by re-versioning just after the
// deadline.
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');

const JOB_NAME = 'work-agreement-proposal-timeout';
const CRON_EXPRESSION = '23 * * * *';

async function runWorkAgreementProposalTimeout({ days } = {}) {
  // Lazy require: the controller pulls in services this worker does not need
  // at load time.
  const { PROPOSAL_SIGN_TIMEOUT_DAYS } = require('../controllers/workAgreementController');
  const effectiveDays = days ?? PROPOSAL_SIGN_TIMEOUT_DAYS;
  let result = { locked: false };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result = { locked: true, ...(await activateTimedOutProposals(effectiveDays)) };
  }, 900, { throwOnError: true });
  return result;
}

async function activateTimedOutProposals(days) {
  const pool = require('../db');
  const { sendNotification } = require('../services/notificationService');
  const { rows } = await pool.query(
    `SELECT a.id, a.job_id, a.helper_id, a.customer_id, v.id AS version_id, v.created_by
       FROM work_agreements a
       JOIN work_agreement_versions v ON v.agreement_id = a.id
      WHERE a.status = 'pending_signatures'
        AND v.version_number = (
          SELECT MAX(version_number) FROM work_agreement_versions WHERE agreement_id = a.id
        )
        -- the counterparty signed the author's exact terms ...
        AND EXISTS (
          SELECT 1 FROM work_agreement_signatures s
           WHERE s.version_id = v.id AND s.signer_id <> v.created_by
             AND s.signed_at <= NOW() - make_interval(days => $1)
        )
        -- ... and the author never signed them
        AND NOT EXISTS (
          SELECT 1 FROM work_agreement_signatures s2
           WHERE s2.version_id = v.id AND s2.signer_id = v.created_by
        )
      LIMIT 50`,
    [days]
  );
  let activated = 0;
  for (const row of rows) {
    try {
      const { rowCount } = await pool.query(
        `UPDATE work_agreements SET status = 'active', updated_at = NOW()
          WHERE id = $1::uuid AND status = 'pending_signatures'`,
        [row.id]
      );
      if (!rowCount) continue;
      activated += 1;
      logger.info('work agreement auto-activated on stale proposal', { agreementId: row.id, jobId: row.job_id });
      for (const userId of [row.helper_id, row.customer_id].filter(Boolean)) {
        try {
          await sendNotification({
            userId,
            type: 'work_agreement_auto_activated',
            data: { agreement_id: row.id, job_id: row.job_id },
            action_url: `/agreements/${row.id}`,
            idempotencyKey: `wa-auto-activated:${row.id}`,
          });
        } catch (notifyErr) {
          logger.warn('work agreement auto-activation notification failed', { agreementId: row.id, error: notifyErr.message });
        }
      }
    } catch (err) {
      logger.error('work agreement proposal timeout failed', { agreementId: row.id, error: err.message });
    }
  }
  return { checked: rows.length, activated };
}

function startWorkAgreementProposalTimeoutJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, () => {
    runWorkAgreementProposalTimeout().catch((err) =>
      logger.error('work agreement proposal timeout cron error', { error: err.message }));
  });
  logger.info('work agreement proposal timeout scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  runWorkAgreementProposalTimeout,
  activateTimedOutProposals,
  startWorkAgreementProposalTimeoutJob,
  JOB_NAME,
  CRON_EXPRESSION,
};
