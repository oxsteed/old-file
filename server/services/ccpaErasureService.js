'use strict';
const pool = require('../db');
const crypto = require('crypto');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { sendEmail } = require('../utils/email');

async function notifyCompleted(request, send = sendEmail) {
  const result = await send({ to: request.email, subject: 'Your privacy request has been completed',
    text: `Your ${request.request_type} request #${request.id} has been completed. Financial and audit records subject to retention requirements are retained. Contact support@oxsteed.com with questions.`,
    idempotencyKey: `ccpa-completed:${request.id}` });
  if (!result?.success) throw new Error('CCPA completion email was not accepted');
}
async function queueErasure(client, request, adminId) {
  if (!request.user_id) throw new AppError('Deletion request has no verified account. Review the subject before completing.', 409, 'ccpa_subject_required');
  await client.query(`INSERT INTO ccpa_erasure_jobs(request_id,subject_id,requested_by)
    VALUES($1,$2,$3) ON CONFLICT(request_id) DO UPDATE SET
      status=CASE WHEN ccpa_erasure_jobs.status='needs_review' THEN 'pending' ELSE ccpa_erasure_jobs.status END,
      next_attempt_at=NOW(),last_error=NULL`, [request.id, request.user_id, adminId]);
  await client.query(`UPDATE ccpa_data_requests SET status='processing',fulfilled_by_id=$2,updated_at=NOW()
    WHERE id=$1 AND status IN ('pending','processing')`, [request.id, adminId]);
  await client.query(`INSERT INTO legal_audit_log(action_type,actor_id,actor_role,resource_id,resource_type,status,metadata)
    VALUES('ccpa_request',$2,'admin',$1,'ccpa_request','processing',$3::jsonb)`,
    [String(request.id), adminId, JSON.stringify({ erasureQueued: true })]);
}
async function completeRequest(requestId, adminId, fulfillmentDate) {
  return withTransaction(pool, async client => {
    const { rows: [request] } = await client.query('SELECT * FROM ccpa_data_requests WHERE id=$1 FOR UPDATE', [requestId]);
    if (!request || !['pending','processing'].includes(request.status)) return { skipped: true, id: requestId };
    if (request.request_type === 'deletion') {
      await queueErasure(client, request, adminId);
      return { queued: true, request };
    }
    await client.query(`UPDATE ccpa_data_requests SET status='completed',completed_at=NOW(),
      fulfillment_date=$2,fulfilled_by_id=$3,updated_at=NOW() WHERE id=$1`, [request.id, fulfillmentDate || new Date(), adminId]);
    await client.query(`INSERT INTO legal_audit_log(action_type,actor_id,actor_role,resource_id,resource_type,status,metadata)
      VALUES('ccpa_completed',$2,'admin',$1,'ccpa_request','completed','{}'::jsonb)`, [String(request.id), adminId]);
    return { completed: true, request };
  }, 'ccpa_complete');
}
async function assertErasureSafe(userId) {
  const guard = require('./accountDeletionGuard');
  const blockers = await guard.findFinancialBlockers(userId);
  if (blockers.length) throw new AppError('Stored value or pending money requires review', 409, 'ccpa_financial_review');
  const { ACTIVE_JOB_STATUS_SQL_IN } = require('../utils/schemaProbe');
  const { rows } = await pool.query(`SELECT id FROM jobs WHERE (client_id=$1 OR assigned_helper_id=$1)
    AND status IN ${ACTIVE_JOB_STATUS_SQL_IN} LIMIT 1`, [userId]);
  if (rows.length) throw new AppError('Active jobs require review', 409, 'ccpa_active_jobs');
  const pending = await pool.query(`SELECT id FROM payments WHERE
    (payer_id=$1 AND status IN ('pending','authorized','processing')) OR
    (payee_id=$1 AND status IN ('pending','authorized','processing','captured')) LIMIT 1`, [userId]);
  if (pending.rows.length) throw new AppError('Pending payments require review', 409, 'ccpa_pending_payments');
  await guard.cancelSubscriptionsForDeletion(userId);
}
async function processErasureJobs({ db = pool, limit = 10 } = {}) {
  const token = crypto.randomUUID();
  const { rows } = await db.query(`WITH batch AS (SELECT request_id FROM ccpa_erasure_jobs
    WHERE status IN ('pending','processing') AND next_attempt_at<=NOW()
      AND (lease_until IS NULL OR lease_until<NOW()) ORDER BY created_at,request_id
    FOR UPDATE SKIP LOCKED LIMIT $1)
    UPDATE ccpa_erasure_jobs j SET status='processing',attempts=attempts+1,lease_token=$2,
      lease_until=NOW()+INTERVAL '15 minutes' FROM batch b WHERE j.request_id=b.request_id RETURNING j.*`,
  [Math.min(25, Math.max(1, parseInt(limit,10) || 10)), token]);
  for (const job of rows) {
    try {
      const { rows: [user] } = await pool.query('SELECT id,role FROM users WHERE id=$1', [job.subject_id]);
      if (user) {
        if (['admin','super_admin'].includes(user.role)) throw new AppError('Admin erasure requires review',409,'ccpa_admin_review');
        await assertErasureSafe(user.id);
        await require('../jobs/scheduledDeletionJob').hardDeleteUser(user, { throwOnError: true });
      }
      await withTransaction(pool, async client => {
        const done = await client.query(`UPDATE ccpa_erasure_jobs SET status='completed',completed_at=NOW(),lease_token=NULL,lease_until=NULL
          WHERE request_id=$1 AND lease_token=$2 RETURNING request_id`, [job.request_id, token]);
        if (!done.rows.length) throw new Error('Erasure lease lost');
        await client.query(`UPDATE ccpa_data_requests SET status='completed',completed_at=NOW(),fulfillment_date=NOW(),updated_at=NOW()
          WHERE id=$1 AND status='processing'`, [job.request_id]);
        await client.query(`INSERT INTO legal_audit_log(action_type,actor_id,actor_role,resource_id,resource_type,status,metadata)
          VALUES('ccpa_completed',$2,'admin',$1,'ccpa_request','completed',$3::jsonb)`,
        [String(job.request_id),job.requested_by,JSON.stringify({ erasureExecuted: true })]);
      }, 'ccpa_erasure_complete');
    } catch (err) {
      await db.query(`UPDATE ccpa_erasure_jobs SET status=$3,last_error=$4,lease_token=NULL,lease_until=NULL,
        next_attempt_at=NOW()+INTERVAL '1 hour' WHERE request_id=$1 AND lease_token=$2`,
      [job.request_id, token, err.statusCode === 409 || job.attempts >= 8 ? 'needs_review' : 'pending', err.code || 'erasure_failed']);
      logger.error('CCPA erasure incomplete', { requestId: job.request_id, code: err.code || 'erasure_failed' });
    }
  }
  // Keep delivery separate from execution: provider failure cannot re-run erasure.
  const notifications = await db.query(`SELECT c.* FROM ccpa_erasure_jobs j JOIN ccpa_data_requests c ON c.id=j.request_id
    WHERE j.status='completed' AND j.notification_sent_at IS NULL ORDER BY j.completed_at LIMIT 25`);
  for (const request of notifications.rows) {
    try {
      await notifyCompleted(request);
      await db.query('UPDATE ccpa_erasure_jobs SET notification_sent_at=NOW() WHERE request_id=$1', [request.id]);
    } catch (err) { logger.error('CCPA completion notification pending', { requestId: request.id }); }
  }
  return { examined: rows.length };
}
module.exports = { queueErasure, completeRequest, notifyCompleted, processErasureJobs };
