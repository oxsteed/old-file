// server/jobs/quoteDeadlineNotices.js
// Group 1 (Customer), item 10: quote expiration notice.
//
// A customer who sets a response deadline on a quote request is told
// once when that deadline passes with the request still unquoted
// (status new/reviewing). The notice is an in-app notification (plus
// push/email per the recipient's prefs) through sendNotification; the
// deadline itself never closes the request, and the notice is sent at
// most once per request (deadline_notice_sent_at), so the job is safe
// to re-run. Guest requests (no user_id) have nobody to notify and are
// skipped. Follows the chatQuoteExpiryJob shape: hourly cron, batched
// sweep, exported runner for tests.
'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');

const JOB_NAME = 'quote-deadline-notices';
const CRON_EXPRESSION = '23 * * * *'; // hourly, offset from other jobs
const BATCH_SIZE = 500;

async function sweepQuoteDeadlineNotices(db) {
  const { rows } = await db.query(
    `SELECT id, user_id, service_category, response_deadline
       FROM quote_requests
      WHERE response_deadline IS NOT NULL
        AND response_deadline <= NOW()
        AND deadline_notice_sent_at IS NULL
        AND status IN ('new', 'reviewing')
        AND user_id IS NOT NULL
      ORDER BY response_deadline ASC
      LIMIT $1`,
    [BATCH_SIZE],
  );
  let notified = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await sendNotification({
        userId: row.user_id,
        type: 'quote_deadline_passed',
        title: 'Quote deadline passed',
        body: `${row.service_category || 'Service'} quote request: the response deadline has passed with no quote yet.`,
        data: { quoteRequestId: row.id },
        action_url: '/my-quotes',
      });
      await db.query(
        `UPDATE quote_requests
            SET deadline_notice_sent_at = NOW()
          WHERE id = $1 AND deadline_notice_sent_at IS NULL`,
        [row.id],
      );
      notified += 1;
    } catch (err) {
      failed += 1;
      logger.warn('Quote deadline notice failed', { quoteRequestId: row.id, error: err.message });
    }
  }
  return { notified, failed, examined: rows.length };
}

async function runQuoteDeadlineNoticesJob(dbClient) {
  const db = dbClient || pool;
  const result = await sweepQuoteDeadlineNotices(db);
  if (result.notified > 0 || result.failed > 0) {
    logger.info('Quote deadline notice sweep completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startQuoteDeadlineNoticesJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runQuoteDeadlineNoticesJob();
    } catch (err) {
      logger.error('Quote deadline notices cron error', { error: err.message });
    }
  });
  logger.info('Quote deadline notices job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startQuoteDeadlineNoticesJob,
  runQuoteDeadlineNoticesJob,
  sweepQuoteDeadlineNotices,
  cronExpression: CRON_EXPRESSION,
};
