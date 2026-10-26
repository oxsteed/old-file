'use strict';
const pool = require('../db');
const crypto = require('crypto');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { sendEmail } = require('../utils/email');

const COMPLETION_COPY = {
  en: ['Your privacy request has been completed', 'Your privacy request #{{id}} has been completed. Financial and audit records subject to retention requirements are retained. Contact support@oxsteed.com with questions.'],
  es: ['Tu solicitud de privacidad se ha completado', 'Tu solicitud de privacidad n.º {{id}} se ha completado. Se conservan los registros financieros y de auditoría sujetos a requisitos de conservación. Si tienes preguntas, contacta con support@oxsteed.com.'],
  fr: ['Votre demande de confidentialité est terminée', 'Votre demande de confidentialité n° {{id}} est terminée. Les registres financiers et d’audit soumis aux obligations de conservation sont conservés. Pour toute question, contactez support@oxsteed.com.'],
  ht: ['Demann konfidansyalite ou a fini', 'Demann konfidansyalite ou a #{{id}} fini. Dosye finansye ak odit ki gen obligasyon konsèvasyon rete konsève. Kontakte support@oxsteed.com si ou gen kesyon.'],
  ar: ['اكتمل طلب الخصوصية الخاص بك', 'اكتمل طلب الخصوصية رقم {{id}}. تُحتفظ بالسجلات المالية وسجلات التدقيق الخاضعة لمتطلبات الاحتفاظ. للاستفسارات، تواصل مع support@oxsteed.com.'],
};
async function preferredLanguage(request) {
  let language = request.completion_language;
  if (!language && request.user_id) {
    const { rows } = await pool.query('SELECT preferred_language FROM users WHERE id=$1', [request.user_id]);
    language = rows[0]?.preferred_language;
  }
  return language || 'en';
}
async function notifyCompleted(request, send = sendEmail) {
  const language = await preferredLanguage(request);
  const copy = COMPLETION_COPY[language] || COMPLETION_COPY.en;
  const result = await send({ to: request.email, subject: copy[0],
    text: copy[1].replace('{{id}}', String(request.id)),
    idempotencyKey: `ccpa-completed:${request.id}` });
  if (!result?.success) throw new Error('CCPA completion email was not accepted');
}
async function notifyDenied(request, reason, send = sendEmail) {
  const language = await preferredLanguage(request);
  const copy = {
    en: ['Your privacy request could not be completed', 'Request #{{id}}. Contact support@oxsteed.com for details.'],
    es: ['Tu solicitud de privacidad no se pudo completar', 'Solicitud n.º {{id}}. Contacta con support@oxsteed.com para obtener más información.'],
    fr: ['Votre demande de confidentialité n’a pas pu être traitée', 'Demande n° {{id}}. Contactez support@oxsteed.com pour plus d’informations.'],
    ht: ['Nou pa t kapab fini demann konfidansyalite ou a', 'Demann #{{id}}. Kontakte support@oxsteed.com pou plis detay.'],
    ar: ['تعذر إكمال طلب الخصوصية الخاص بك', 'الطلب رقم {{id}}. تواصل مع support@oxsteed.com لمزيد من التفاصيل.'],
  };
  const text = copy[language] || copy.en;
  const result = await send({ to: request.email, subject: text[0],
    text: text[1].replace('{{id}}', String(request.id)) + (reason ? `\n\n${reason}` : ''),
    idempotencyKey: `ccpa-denied:${request.id}` });
  if (!result?.success) throw new Error('CCPA decision email was not accepted');
}
async function queueErasure(client, request, adminId) {
  if (!request.user_id) throw new AppError('Deletion request has no verified account. Review the subject before completing.', 409, 'ccpa_subject_required');
  await client.query(`INSERT INTO ccpa_erasure_jobs(request_id,subject_id,requested_by,language)
    VALUES($1,$2,$3,COALESCE((SELECT preferred_language FROM users WHERE id=$2),'en')) ON CONFLICT(request_id) DO UPDATE SET
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
    assertAccessDelivery(request);
    await client.query(`UPDATE ccpa_data_requests SET status='completed',completed_at=NOW(),
      fulfillment_date=$2,fulfilled_by_id=$3,updated_at=NOW() WHERE id=$1`, [request.id, fulfillmentDate || new Date(), adminId]);
    await client.query(`INSERT INTO legal_audit_log(action_type,actor_id,actor_role,resource_id,resource_type,status,metadata)
      VALUES('ccpa_completed',$2,'admin',$1,'ccpa_request','completed','{}'::jsonb)`, [String(request.id), adminId]);
    return { completed: true, request };
  }, 'ccpa_complete');
}
function assertAccessDelivery(request) {
  if (request.request_type !== 'access') return;
  const delivery = request.data_provided?.delivery;
  if (delivery?.status !== 'accepted' || !delivery.provider_reference ||
      !/^[a-f0-9]{64}$/.test(delivery.sha256 || '') || !Number.isFinite(Date.parse(delivery.accepted_at))) {
    throw new AppError('Record accepted data delivery before completing an access request', 409, 'ccpa_data_delivery_required');
  }
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
  const notifications = await db.query(`SELECT c.*,j.language AS completion_language FROM ccpa_erasure_jobs j JOIN ccpa_data_requests c ON c.id=j.request_id
    WHERE j.status='completed' AND j.notification_sent_at IS NULL ORDER BY j.completed_at LIMIT 25`);
  for (const request of notifications.rows) {
    try {
      await notifyCompleted(request);
      await db.query('UPDATE ccpa_erasure_jobs SET notification_sent_at=NOW() WHERE request_id=$1', [request.id]);
    } catch (err) { logger.error('CCPA completion notification pending', { requestId: request.id }); }
  }
  const review = await db.query("SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest FROM ccpa_erasure_jobs WHERE status='needs_review'");
  if (Number(review.rows[0]?.count) > 0) await require('./incidentStore').recordIncident({
    type: 'privacy_erasure_needs_review', severity: 'high',
    message: 'Privacy erasure requests require operator review', dedupeKey: 'privacy:erasure:needs-review',
    details: { count: Number(review.rows[0].count), oldest: review.rows[0].oldest, queue: '/api/legal/ccpa-erasure-review' },
  });
  return { examined: rows.length };
}
module.exports = { queueErasure, completeRequest, notifyCompleted, notifyDenied, processErasureJobs, assertAccessDelivery };
