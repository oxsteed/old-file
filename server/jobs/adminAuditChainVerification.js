'use strict';

/**
 * server/jobs/adminAuditChainVerification.js
 *
 * Daily scheduled verification of the admin_audit_log hash chain
 * (migration 407: verify_admin_audit_hash_chain()).
 *
 * The credit chain has a daily integrity job; the admin chain was previously
 * verified on demand only (/api/monitoring/audit-integrity, release gate),
 * so a quiet break could sit unnoticed. This job closes that gap: on any
 * broken entry it records a critical incident (deduplicated) so ops are
 * paged through the normal incident flow.
 *
 * Scope note: this verifies each stored entry's hash links correctly. Full
 * protection against a tail rewrite (an attacker recomputing the whole chain
 * with valid-looking hashes) requires external anchoring — e.g. publishing
 * the daily chain head to an append-only external store. That anchoring is
 * future work, not built here.
 */

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const incidentStore = require('../services/incidentStore');
const { withFencedJobLock } = require('./jobLockingService');

const JOB_NAME = 'admin-audit-chain-verification';
const CRON_EXPRESSION = '25 3 * * *'; // 03:25 UTC daily (after the deletion job's 03:00 slot)
const CRON_TIMEZONE = 'UTC';

async function verifyAdminAuditChain() {
  const { rows } = await pool.query('SELECT * FROM verify_admin_audit_hash_chain()');
  const result = rows[0] || {
    valid: true,
    checked_count: 0,
    broken_count: 0,
    first_broken_id: null,
    first_broken_sequence: null,
  };
  const checkedCount = Number(result.checked_count || 0);
  const brokenCount = Number(result.broken_count || 0);

  if (!result.valid || brokenCount > 0) {
    const incident = await incidentStore.recordIncident({
      type: 'admin_audit_chain_integrity_failure',
      severity: 'critical',
      message: `${brokenCount} admin audit chain ${brokenCount === 1 ? 'entry is' : 'entries are'} invalid`,
      dedupeKey: 'admin-audit-chain:integrity',
      details: {
        checkedCount,
        brokenCount,
        firstBrokenId: result.first_broken_id || null,
        firstBrokenSequence: result.first_broken_sequence == null
          ? null
          : Number(result.first_broken_sequence),
      },
    });
    logger.error('Admin audit chain verification failed', {
      checkedCount,
      brokenCount,
      incidentId: incident && incident.id,
    });
    return { ok: false, checkedCount, brokenCount };
  }

  logger.info('Admin audit chain verification passed', { checkedCount });
  return { ok: true, checkedCount, brokenCount: 0 };
}

async function runAdminAuditChainVerification() {
  const { locked, result } = await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive(); // E03: abort the run if the job lease was lost
    try {
      const verification = await verifyAdminAuditChain();
      return { locked: true, result: verification };
    } catch (error) {
      // Verification unavailable (e.g. function missing on a very old
      // database): alert once per incident window, do not crash the worker.
      logger.error('Admin audit chain verification error', { error: error.message });
      const incident = await incidentStore.recordIncident({
        type: 'admin_audit_chain_verification_unavailable',
        severity: 'critical',
        message: 'Admin audit chain verification could not run',
        dedupeKey: 'admin-audit-chain:unavailable',
        details: { error: error.message },
      });
      return { locked: true, result: { ok: false, error: error.message, incidentId: incident && incident.id } };
    }
  });
  return { locked, ...result };
}

function startAdminAuditChainVerificationJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runAdminAuditChainVerification().catch((error) => {
      logger.error('Admin audit chain verification worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('Admin audit chain verification job scheduled', {
    cron: CRON_EXPRESSION,
    timezone: CRON_TIMEZONE,
  });
}

module.exports = {
  JOB_NAME,
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  verifyAdminAuditChain,
  runAdminAuditChainVerification,
  startAdminAuditChainVerificationJob,
};
