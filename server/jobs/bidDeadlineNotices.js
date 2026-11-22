// server/jobs/bidDeadlineNotices.js
// Group 4 Slice B (item 164): bid deadline reminders.
//
// Before this slice a bid's expiry was passive display only
// (BidDeadlineNotice on /my-bids): no worker, no notification, no sweep,
// so a helper who never opened /my-bids got no reminder and a stale
// pending bid sat forever (expiry was checked lazily at accept/reconfirm
// only). This job does both halves, hourly:
//
//   1. Expire lapsed bids: pending bids whose expires_at passed are
//      flipped to 'expired' (the status the bids table already admits).
//      Expiry itself sends no notification; /my-bids shows the status.
//   2. Remind once: pending bids on still-open jobs whose expires_at is
//      within 24 hours get one in-app notification (plus push/email per
//      the recipient's prefs) through sendNotification, then the
//      deadline_notice_sent_at stamp makes the job safe to re-run.
//
// Follows the quoteDeadlineNotices shape: hourly cron, batched sweep,
// exported runner for tests. The reminder type is registered in
// utils/notificationTypeCatalog.js with localized copy in utils/i18n.js
// (bid_deadline_reminder); without the catalog entry the title/body
// would be lost for non-English recipients.
'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');

const JOB_NAME = 'bid-deadline-notices';
const CRON_EXPRESSION = '37 * * * *'; // hourly, offset from quote-deadline-notices (23)
const BATCH_SIZE = 500;
const REMINDER_LEAD_HOURS = 24;

// Still-open jobs: a bid on a job that already moved on (accepted,
// cancelled, completed) is not worth a reminder.
const OPEN_JOB_STATUSES = ['published', 'matched', 'negotiating'];

async function expireLapsedBids(db) {
  const { rowCount } = await db.query(
    `UPDATE bids
        SET status = 'expired', updated_at = NOW()
      WHERE status = 'pending'
        AND expires_at <= NOW()`,
  );
  return rowCount;
}

async function sweepBidDeadlineNotices(db) {
  const expired = await expireLapsedBids(db);
  const { rows } = await db.query(
    `SELECT b.id, b.helper_id, b.expires_at, j.id AS job_id, j.title AS job_title
       FROM bids b
       JOIN jobs j ON j.id = b.job_id
      WHERE b.status = 'pending'
        AND b.expires_at > NOW()
        AND b.expires_at <= NOW() + INTERVAL '24 hours'
        AND b.deadline_notice_sent_at IS NULL
        AND j.deleted_at IS NULL
        AND j.status = ANY($2::job_status[])
      ORDER BY b.expires_at ASC
      LIMIT $1`,
    [BATCH_SIZE, OPEN_JOB_STATUSES],
  );
  let notified = 0;
  let failed = 0;
  for (const row of rows) {
    const hoursLeft = Math.max(
      1,
      Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 3600000),
    );
    try {
      await sendNotification({
        userId: row.helper_id,
        type: 'bid_deadline_reminder',
        title: 'Your bid expires soon',
        body: `Your bid on "${row.job_title || 'a job'}" expires in ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}.`,
        data: {
          params: { jobTitle: row.job_title || 'a job', hoursLeft },
          bidId: row.id,
          jobId: row.job_id,
        },
        action_url: '/my-bids',
      });
      await db.query(
        `UPDATE bids
            SET deadline_notice_sent_at = NOW()
          WHERE id = $1 AND deadline_notice_sent_at IS NULL`,
        [row.id],
      );
      notified += 1;
    } catch (err) {
      failed += 1;
      logger.warn('Bid deadline notice failed', { bidId: row.id, error: err.message });
    }
  }
  return { expired, notified, failed, examined: rows.length };
}

async function runBidDeadlineNoticesJob(dbClient) {
  const db = dbClient || pool;
  const result = await sweepBidDeadlineNotices(db);
  if (result.expired > 0 || result.notified > 0 || result.failed > 0) {
    logger.info('Bid deadline notice sweep completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startBidDeadlineNoticesJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runBidDeadlineNoticesJob();
    } catch (err) {
      logger.error('Bid deadline notices cron error', { error: err.message });
    }
  });
  logger.info('Bid deadline notices job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startBidDeadlineNoticesJob,
  runBidDeadlineNoticesJob,
  sweepBidDeadlineNotices,
  expireLapsedBids,
  cronExpression: CRON_EXPRESSION,
  reminderLeadHours: REMINDER_LEAD_HOURS,
};
