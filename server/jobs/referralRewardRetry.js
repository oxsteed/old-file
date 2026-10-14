'use strict';

/**
 * Referral reward retry (P2-6-F11).
 *
 * grantReferralReward is called from the first-job value event (P2-6-F12:
 * registration no longer grants), so a transient failure (DB blip, deadlock)
 * must not silently drop the reward. Failures are recorded as reconciliation
 * exceptions (domain 'credit', reference `referral-reward:<newUserId>`);
 * this worker retries them. Reward postings are idempotent per referred
 * user, so a retry can never double-grant.
 *
 * After MAX_ATTEMPTS the exception is escalated to critical and left open
 * for a manual grant; the worker stops picking it up.
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');

/**
 * System-actor status move. transitionException() is admin-oriented (it
 * writes admin_audit_log.admin_id, which is NOT NULL), so the worker moves
 * its own retry queue directly and records the reason in details.
 */
async function moveException(db, id, toStatus, note) {
  const to = toStatus === 'resolved' ? 'resolved' : 'acknowledged';
  await db.query(
    `UPDATE reconciliation_exceptions
        SET status = $2,
            resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE resolved_at END,
            updated_at = NOW(),
            details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('resolution_notes', $3)
      WHERE id = $1 AND status = 'open'`,
    [id, to, note]
  );
}

const CRON_EXPRESSION = '*/5 * * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'referral-reward-retry';
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 10;
const SETTLE_MINUTES = 5;

async function runReferralRewardRetry({ limit = BATCH_SIZE } = {}) {
  const boundedLimit = Math.min(BATCH_SIZE, Math.max(1, Number(limit) || BATCH_SIZE));
  const result = { locked: false, inspected: 0, granted: 0, failed: 0, escalated: 0 };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive(); // abort the run if the job lease was lost
    result.locked = true;
    const { rows: pending } = await fence.db.query(
      `SELECT id, reference_id, details, severity
         FROM reconciliation_exceptions
        WHERE domain = 'credit'
          AND status = 'open'
          AND reference_id LIKE 'referral-reward:%'
          AND COALESCE((details->>'retry_attempts')::int, 0) < $1
          AND updated_at < NOW() - make_interval(mins => $2)
        ORDER BY updated_at ASC
        LIMIT $3`,
      [MAX_ATTEMPTS, SETTLE_MINUTES, boundedLimit]
    );
    // Required lazily so the worker file stays dependency-light for tests.
    const { grantReferralReward } = require('../controllers/referralController');
    for (const row of pending) {
      result.inspected += 1;
      const details = row.details || {};
      const newUserId = details.new_user_id || String(row.reference_id).replace(/^referral-reward:/, '');
      const referrerId = details.referrer_id || null;
      if (!referrerId || !newUserId) {
        await moveException(fence.db, row.id, 'acknowledged',
          'Retry impossible: referrer or referred user unknown; grant manually')
          .catch((err) => logger.warn('referral-reward-retry acknowledge failed', { exceptionId: row.id, error: err.message }));
        result.escalated += 1;
        continue;
      }
      let granted = false;
      try {
        granted = await grantReferralReward(referrerId, newUserId);
      } catch (err) {
        logger.warn('referral-reward-retry grant threw', { referrerId, newUserId, error: err.message });
      }
      // grantReferralReward returns false both when the reward already
      // existed (idempotent no-op) and when it just failed, so check the
      // ledger directly: the posting key is per referred user.
      const { rows: posted } = await fence.db.query(
        `SELECT 1 FROM platform_ledger WHERE idempotency_key = $1 LIMIT 1`,
        [`referral:referrer:${newUserId}`]
      );
      if (posted.length > 0) {
        await moveException(fence.db, row.id, 'resolved',
          granted ? 'Reward granted on retry' : 'Reward already posted; nothing to retry')
          .catch((err) => logger.warn('referral-reward-retry resolve failed', { exceptionId: row.id, error: err.message }));
        result.granted += 1;
        continue;
      }
      result.failed += 1;
      const attempts = Number(details.retry_attempts || 0) + 1;
      await fence.db.query(
        `UPDATE reconciliation_exceptions
            SET details = COALESCE(details, '{}'::jsonb)
                          || jsonb_build_object('retry_attempts', $2::int,
                                                'last_retry_at', NOW()::text),
                severity = CASE WHEN $2::int >= $3 THEN 'critical' ELSE severity END,
                updated_at = NOW()
          WHERE id = $1`,
        [row.id, attempts, MAX_ATTEMPTS]
      );
      if (attempts >= MAX_ATTEMPTS) {
        logger.error('referral-reward-retry exhausted; manual grant needed', { referrerId, newUserId, exceptionId: row.id });
        result.escalated += 1;
      }
    }
  }, 300, { throwOnLockError: true });
  return result;
}

function startReferralRewardRetryJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runReferralRewardRetry().catch((error) => {
      logger.error('Referral reward retry worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('Referral reward retry job scheduled', {
    cron: CRON_EXPRESSION,
    timezone: CRON_TIMEZONE,
    batchSize: BATCH_SIZE,
  });
}

module.exports = {
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  JOB_NAME,
  BATCH_SIZE,
  MAX_ATTEMPTS,
  runReferralRewardRetry,
  startReferralRewardRetryJob,
};
