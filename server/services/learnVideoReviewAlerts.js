'use strict';
const pool = require('../db');
const { sendNotification } = require('./notificationService');
const { hasGlobalGrant } = require('../middleware/adminAuth');
const logger = require('../utils/logger');

async function enqueueLearnReviewNotice(client, submissionId, kind) {
  await client.query(`INSERT INTO learn_video_review_notice_jobs(submission_id, recipient_id, kind)
    SELECT $1, id, $2 FROM users
    WHERE role IN ('admin','super_admin') AND is_active = TRUE
      AND COALESCE(is_banned,FALSE) = FALSE AND COALESCE(totp_enabled,FALSE) = TRUE
    ON CONFLICT (submission_id, recipient_id, kind) DO NOTHING`, [submissionId, kind]);
}

async function processLearnVideoReviewAlerts({ limit = 100, submissionId = null } = {}, db = pool) {
  const batch = Math.max(1, Math.min(Number(limit) || 100, 500));
  // This also covers failed publication passes and new reviewers. Publication
  // itself records an overdue job transactionally before the pending row leaves.
  await db.query(`INSERT INTO learn_video_review_notice_jobs(submission_id,recipient_id,kind)
    SELECT s.id, u.id, 'overdue' FROM learn_guide_video_submissions s CROSS JOIN users u
    WHERE s.status = 'pending' AND s.created_at <= NOW() - INTERVAL '24 hours'
      AND u.role IN ('admin','super_admin') AND u.is_active = TRUE
      AND COALESCE(u.is_banned,FALSE) = FALSE AND COALESCE(u.totp_enabled,FALSE) = TRUE
      AND NOT EXISTS (SELECT 1 FROM learn_video_review_notice_jobs j
        WHERE j.submission_id=s.id AND j.recipient_id=u.id AND j.kind='overdue')
    ORDER BY s.created_at,s.id,u.id LIMIT $1
    ON CONFLICT (submission_id,recipient_id,kind) DO NOTHING`, [batch]);
  const { rows } = await db.query(`SELECT j.id,j.submission_id,j.recipient_id,j.kind,u.role
    FROM learn_video_review_notice_jobs j JOIN users u ON u.id=j.recipient_id
    WHERE j.delivered_at IS NULL AND j.next_attempt_at <= NOW()
      AND u.is_active = TRUE AND COALESCE(u.is_banned,FALSE) = FALSE
      AND COALESCE(u.totp_enabled,FALSE) = TRUE AND u.role IN ('admin','super_admin')
      ${submissionId ? 'AND j.submission_id=$2::uuid' : ''}
    ORDER BY j.created_at,j.id LIMIT $1`, submissionId ? [batch,submissionId] : [batch]);
  let notified = 0, deferred = 0;
  for (const job of rows) {
    try {
      if (job.role !== 'super_admin' && !(await hasGlobalGrant(job.recipient_id,'moderate_content'))) {
        await db.query("UPDATE learn_video_review_notice_jobs SET next_attempt_at=NOW()+INTERVAL '1 hour' WHERE id=$1 AND delivered_at IS NULL", [job.id]);
        deferred += 1; continue;
      }
      const result = await sendNotification({
        userId: job.recipient_id, type: job.kind === 'submitted' ? 'learn_video_review_received' : 'learn_video_review_overdue',
        data: { submission_id: job.submission_id }, action_url: '/admin/learn/submissions',
        idempotencyKey: `learn-video:${job.kind}:${job.submission_id}:${job.recipient_id}`,
      });
      if (!result?.success) throw new Error('Review notice delivery unavailable');
      await db.query('UPDATE learn_video_review_notice_jobs SET delivered_at=NOW(),attempts=attempts+1 WHERE id=$1 AND delivered_at IS NULL', [job.id]);
      notified += 1;
    } catch (error) {
      await db.query("UPDATE learn_video_review_notice_jobs SET attempts=attempts+1,next_attempt_at=NOW()+INTERVAL '5 minutes' WHERE id=$1 AND delivered_at IS NULL", [job.id]);
      logger.warn('Learn review notice deferred', { jobId: job.id, error: error.message });
      deferred += 1;
    }
  }
  return { notified, deferred };
}

module.exports = { enqueueLearnReviewNotice, processLearnVideoReviewAlerts };
