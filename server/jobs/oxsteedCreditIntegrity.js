'use strict';

const logger = require('../utils/logger');
const pool = require('../db');
const { verifyEntryHashes } = require('../scripts/verify-oxsteed-credit');
const incidentStore = require('../services/incidentStore');
const { withJobLock } = require('./jobLockingService');

const JOB_NAME = 'oxsteed-credit-integrity';
const CRON_EXPRESSION = '40 2 * * *';
const CRON_TIMEZONE = 'UTC';

async function verifyCreditLedger() {
  const [{ rows: entries }, { rows: accounts }] = await Promise.all([
    pool.query(
      `SELECT e.transaction_id, e.account_id, e.entry_side, e.amount_cents,
              e.balance_after_cents, e.sequence, e.previous_entry_hash,
              e.entry_hash, e.metadata, t.transaction_type, t.currency_code
         FROM oxsteed_credit_transaction_entries e
         JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
        WHERE t.status = 'posted'
        ORDER BY e.account_id, e.sequence, e.id`
    ),
    pool.query(`SELECT id, ledger_version, last_entry_hash FROM oxsteed_credit_accounts`),
  ]);

  const verification = verifyEntryHashes(entries, accounts);
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
  let result = { ok: false, verification: null, incident: null };
  let locked = false;
  try {
    await withJobLock(JOB_NAME, async () => {
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
  JOB_NAME,
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  verifyCreditLedger,
  runOxsteedCreditIntegrity,
  startOxsteedCreditIntegrityJob,
};
