'use strict';

const logger = require('../utils/logger');
const pool = require('../db');
const { verifyEntryHashes } = require('../scripts/verify-oxsteed-credit');
const incidentStore = require('../services/incidentStore');
const { withFencedJobLock } = require('./jobLockingService');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');
const { skipOversightJobWhenIdle } = require('../services/oxsteedCreditService');

const JOB_NAME = 'oxsteed-credit-integrity';
const CRON_EXPRESSION = '40 2 * * *';
const CRON_TIMEZONE = 'UTC';

const ACCOUNT_BATCH_SIZE = Math.max(10, Number.parseInt(process.env.OXSTEED_CREDIT_INTEGRITY_ACCOUNT_BATCH || '200', 10) || 200);

/**
 * Verify the journal hash chains account by account in keyset batches, so
 * memory stays bounded by one batch of accounts instead of the whole
 * ledger (licence readiness: integrity must keep running at scale and
 * while the rail is off).
 */
async function verifyJournalInBatches() {
  const totals = { invalidEntryHashes: 0, invalidHashChains: 0, invalidAccountHashHeads: 0 };
  let entryCount = 0;
  let accountCount = 0;
  let afterId = 0;
  for (;;) {
    const { rows: accounts } = await pool.query(
      `SELECT id, ledger_version, last_entry_hash FROM oxsteed_credit_accounts
        WHERE id > $1 ORDER BY id LIMIT $2`,
      [afterId, ACCOUNT_BATCH_SIZE]
    );
    if (!accounts || !accounts.length) break;
    const ids = accounts.map((a) => Number(a.id));
    const { rows: entries } = await pool.query(
      `SELECT e.transaction_id, e.account_id, e.entry_side, e.amount_cents,
              e.balance_after_cents, e.sequence, e.previous_entry_hash,
              e.entry_hash, e.hash_key_version, e.metadata,
              t.transaction_type, t.currency_code
         FROM oxsteed_credit_transaction_entries e
         JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
        WHERE t.status = 'posted' AND e.account_id = ANY($1::bigint[])
        ORDER BY e.account_id, e.sequence, e.id`,
      [ids]
    );
    const result = verifyEntryHashes(entries || [], accounts);
    for (const key of Object.keys(totals)) totals[key] += Number(result?.[key] || 0);
    entryCount += (entries || []).length;
    accountCount += accounts.length;
    afterId = ids[ids.length - 1];
    if (accounts.length < ACCOUNT_BATCH_SIZE) break;
  }
  return { totals, entryCount, accountCount };
}

async function verifyCreditLedger() {
  const journal = await verifyJournalInBatches();
  const { rows: auditHashRows } = await pool.query(
    `SELECT COUNT(*)::int AS invalid_count
       FROM (
         SELECT e.id,
                e.previous_event_hash,
                e.event_hash,
                LAG(e.event_hash) OVER (ORDER BY e.created_at ASC, e.id ASC) AS expected_previous_event_hash,
                compute_oxsteed_credit_audit_event_hash(e.previous_event_hash, e) AS expected_event_hash
           FROM oxsteed_credit_audit_events e
       ) chain
      WHERE chain.previous_event_hash IS DISTINCT FROM chain.expected_previous_event_hash
         OR chain.event_hash IS DISTINCT FROM chain.expected_event_hash`
  );
  const entries = { length: journal.entryCount };
  const accounts = { length: journal.accountCount };

  const verification = {
    ...journal.totals,
    invalidAuditHashEvents: Number(auditHashRows[0]?.invalid_count || 0),
  };
  const invalidCount = Object.values(verification).reduce((sum, value) => sum + Number(value || 0), 0);
  if (invalidCount > 0) {
    const incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_integrity_failure',
      severity: 'critical',
      message: 'OxSteed Credit journal integrity verification found invalid hash data',
      dedupeKey: 'oxsteed-credit-integrity:hash-chain',
      details: {
        ...verification,
        postedEntryCount: entries.length,
        accountCount: accounts.length,
      },
    });
    logger.error('OxSteed Credit integrity verification failed', {
      ...verification,
      postedEntryCount: entries.length,
      accountCount: accounts.length,
    });
    return { ok: false, verification, incident };
  }

  logger.info('OxSteed Credit integrity verification passed', {
    postedEntryCount: entries.length,
    accountCount: accounts.length,
  });
  return { ok: true, verification, incident: null };
}

async function runOxsteedCreditIntegrity() {
  // Review bug 4: oversight keeps running while the rail is off.
  if (await skipOversightJobWhenIdle(JOB_NAME)) {
    return { skipped: 'rail_disabled_idle' };
  }
  let result = { ok: false, verification: null, incident: null };
  let locked = false;
  try {
    await withFencedJobLock(JOB_NAME, async (fence) => {
      fence.assertActive(); // E03: abort the run if the job lease was lost
      locked = true;
      result = await verifyCreditLedger();
    }, 900, { throwOnLockError: true });
  } catch (error) {
    const incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_integrity_check_failed',
      severity: 'critical',
      message: 'OxSteed Credit journal integrity verification could not complete',
      dedupeKey: 'oxsteed-credit-integrity:check-failed',
      details: { error: error.message },
    });
    logger.error('OxSteed Credit integrity worker failed', { error: error.message });
    result = { ok: false, verification: null, incident };
  }
  if (locked) {
    await recordOxsteedCreditWorkerRun({
      jobName: JOB_NAME,
      result: result.ok ? { ok: true } : {},
      error: result.ok ? null : new Error('Credit integrity verification did not pass'),
    });
  }
  return { locked, ...result };
}

function startOxsteedCreditIntegrityJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditIntegrity().catch((error) => {
      logger.error('OxSteed Credit integrity worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('OxSteed Credit integrity job scheduled', {
    cron: CRON_EXPRESSION,
    timezone: CRON_TIMEZONE,
  });
}

module.exports = {
  ACCOUNT_BATCH_SIZE,
  JOB_NAME,
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  verifyCreditLedger,
  runOxsteedCreditIntegrity,
  startOxsteedCreditIntegrityJob,
};
