'use strict';

/**
 * Scheduled licence-readiness oversight jobs. None of them is stopped by
 * the Credit rail kill switch (review bug 4): they reconcile, screen,
 * monitor, refresh official data and anchor audit evidence, which must
 * continue while money movement is suspended.
 *
 * Every task runs under a fenced distributed lock so several API
 * instances never run the same task twice, and records failures as
 * incidents instead of throwing.
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const pool = require('../db');
const { withFencedJobLock } = require('./jobLockingService');

const TIMEZONE = 'UTC';

// [jobName, cron, lockSeconds, () => Promise, complianceCritical]
// complianceCritical marks the sanctions/AML/SAR tasks (Oct 30 item 12):
// when their module is missing, optional() returns a silent skip and the
// task reports success-shaped results forever while no screening runs.
// Those skips raise a high-severity incident instead of passing quietly.
function tasks() {
  return [
    ['credit-fx-reference-refresh', process.env.CREDIT_FX_REFERENCE_CRON || '15 14,18,22 * * 1-5', 120,
      () => require('../services/fx/brhReferenceRate').refreshBrhReferenceRate(pool)],
    ['credit-sanctions-list-refresh', process.env.CREDIT_SANCTIONS_REFRESH_CRON || '20 */6 * * *', 1800,
      () => optional('../services/creditCompliance/sanctionsListService', 'refreshAllSources'), true],
    ['credit-sanctions-rescreen', process.env.CREDIT_SANCTIONS_RESCREEN_CRON || '50 */6 * * *', 3600,
      () => optional('../services/creditCompliance/sanctionsListService', 'rescreenAfterListChanges'), true],
    ['credit-sanctions-queue', process.env.CREDIT_SANCTIONS_QUEUE_CRON || '*/2 * * * *', 600,
      () => optional('../services/creditCompliance/sanctionsListService', 'processScreeningQueue'), true],
    ['credit-safeguarding-reconciliation', process.env.CREDIT_SAFEGUARDING_CRON || '30 3 * * *', 900,
      () => optional('../services/creditCompliance/safeguardingService', 'runDailyReconciliation')],
    ['credit-aml-monitor', process.env.CREDIT_AML_MONITOR_CRON || '10 * * * *', 900,
      () => optional('../services/creditCompliance/amlRules', 'runBatchRules'), true],
    ['credit-sar-deadlines', process.env.CREDIT_SAR_DEADLINE_CRON || '5 */2 * * *', 300,
      () => optional('../services/creditCompliance/sarService', 'checkDeadlines'), true],
    ['credit-dispute-sla', process.env.CREDIT_DISPUTE_SLA_CRON || '*/15 * * * *', 600,
      () => optional('../services/creditCompliance/disputeSlaService', 'runSlaSweep')],
    ['credit-dormancy', process.env.CREDIT_DORMANCY_CRON || '40 4 * * *', 1800,
      () => optional('../services/creditCompliance/dormancyService', 'runDormancySweep')],
    ['credit-access-review', process.env.CREDIT_ACCESS_REVIEW_CRON || '0 6 * * 1', 600,
      () => optional('../services/creditCompliance/accessReviewService', 'ensureCurrentReview')],
    ['credit-audit-anchor', process.env.CREDIT_AUDIT_ANCHOR_CRON || '55 23 * * *', 600,
      () => optional('../services/creditCompliance/auditAnchorService', 'anchorAuditChains')],
    ['credit-audit-anchor-verify', process.env.CREDIT_AUDIT_ANCHOR_VERIFY_CRON || '20 7 * * *', 600,
      () => optional('../services/creditCompliance/auditAnchorService', 'verifyAnchors')],
    ['credit-kyc-reverification', process.env.CREDIT_KYC_REVERIFICATION_CRON || '25 5 * * *', 900,
      () => optional('../services/creditCompliance/kycRequirementsService', 'runPeriodicTriggers')],
  ];
}

async function optional(modulePath, fnName) {
  let mod;
  try {
    mod = require(modulePath);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      // Notifications audit item 7 follow-up: the skip used to be silent,
      // so a deleted or renamed module left the job green while nothing
      // ran. Warn so the hole cannot silently reopen (runTask still
      // raises a high-severity incident for compliance-critical skips).
      logger.warn('credit_oversight.module_missing', { module: modulePath, fn: fnName, error: error.message });
      return { skipped: 'not_installed' };
    }
    throw error;
  }
  return mod[fnName]();
}

async function runTask(jobName, lockSeconds, fn, { critical = false } = {}) {
  try {
    let result = null;
    await withFencedJobLock(jobName, async (fence) => {
      fence.assertActive();
      result = await fn();
    }, lockSeconds, { throwOnLockError: false });
    // Oct 30 item 12: a missing compliance module returns
    // { skipped: 'not_installed' } and runTask used to return it as a
    // normal result, so a sanctions/AML/SAR task could report success
    // forever while no screening ran. For the compliance-critical tasks
    // a skipped module is a high-severity incident instead.
    if (result && result.skipped === 'not_installed' && critical) {
      logger.error('Credit oversight task skipped: compliance module not installed', { jobName });
      try {
        await require('../services/incidentStore').recordIncident({
          type: 'credit_oversight_module_missing',
          severity: 'high',
          message: `Credit oversight task ${jobName} skipped: its compliance module is not installed`,
          dedupeKey: `credit-oversight-missing:${jobName}`,
          details: { jobName, skipped: 'not_installed' },
        });
      } catch (incidentError) {
        logger.error('Credit oversight incident could not be recorded', { jobName, error: incidentError.message });
      }
    }
    return result;
  } catch (error) {
    logger.error('Credit oversight task failed', { jobName, error: error.message });
    try {
      await require('../services/incidentStore').recordIncident({
        type: 'credit_oversight_task_failed',
        severity: 'high',
        message: `Credit oversight task ${jobName} failed`,
        dedupeKey: `credit-oversight:${jobName}`,
        details: { error: error.message },
      });
    } catch (incidentError) {
      logger.error('Credit oversight incident could not be recorded', { jobName, error: incidentError.message });
    }
    return null;
  }
}

function startCreditLicenceOversightJobs() {
  for (const [jobName, expression, lockSeconds, fn, critical] of tasks()) {
    if (!cron.validate(expression)) throw new Error(`Invalid cron for ${jobName}: ${expression}`);
    cron.schedule(expression, () => { runTask(jobName, lockSeconds, fn, { critical: Boolean(critical) }); }, { timezone: TIMEZONE });
  }
  logger.info('Credit licence oversight jobs scheduled', { count: tasks().length });
}

module.exports = { tasks, runTask, startCreditLicenceOversightJobs, optional };
