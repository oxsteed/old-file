'use strict';

/**
 * job_revisions storage lifecycle:
 *  - keeps monthly partitions created ahead of time (ensure_job_revision_partitions)
 *  - detaches and drops partitions older than JOB_REVISION_RETENTION_MONTHS
 *    (default 36; dispute and chargeback windows are well inside that)
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const db = require('../db');
const { withFencedJobLock } = require('./jobLockingService');

const JOB_NAME = 'job-revision-maintenance';
const CRON_EXPRESSION = '23 2 * * *';
const MONTHS_AHEAD = 3;

function retentionMonths() {
  const value = Number(process.env.JOB_REVISION_RETENTION_MONTHS || 36);
  return Number.isInteger(value) && value >= 12 ? value : 36;
}

function partitionMonth(name) {
  const match = /^job_revisions_(\d{4})_(\d{2})$/.exec(name);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : null;
}

async function maintainJobRevisionPartitions(now = new Date()) {
  const { rows: created } = await db.query('SELECT ensure_job_revision_partitions($1) AS created', [MONTHS_AHEAD]);
  const { rows } = await db.query(
    `SELECT c.relname
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'job_revisions'`
  );
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - retentionMonths(), 1));
  const dropped = [];
  for (const { relname } of rows) {
    const month = partitionMonth(relname);
    if (!month || month >= cutoff) continue;
    await db.query(`ALTER TABLE job_revisions DETACH PARTITION ${JSON.stringify(relname)}`);
    await db.query(`DROP TABLE IF EXISTS ${JSON.stringify(relname)}`);
    dropped.push(relname);
  }
  const result = { created: Number(created[0]?.created || 0), dropped };
  if (result.created || dropped.length) logger.info('Job revision partitions maintained', result);
  return result;
}

function startJobRevisionMaintenanceJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    withFencedJobLock(JOB_NAME, async (fence) => {
      fence.assertActive();
      await maintainJobRevisionPartitions();
    }, 600).catch((error) => logger.error('Job revision maintenance failed', { error: error.message }));
  });
  logger.info('Job revision maintenance job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = { maintainJobRevisionPartitions, startJobRevisionMaintenanceJob, partitionMonth, retentionMonths };
