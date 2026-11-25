'use strict';
// Group 4 rest (items 185, 190): job-linked support escalation and payment
// issue intake for the job's assigned helper. Files a support ticket that
// carries the job reference, alerts support staff after commit, and is
// retry-safe on clientRequestId. Filing a ticket changes nothing on the job
// or its money; support works it through the existing ticket tools.
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { notifySupportStaff } = require('./supportNotificationService');
const { requireHelper } = require('./helperReputationService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = {
  job_issue: { category: 'helper_job', priority: 'normal', sla: '24 hours' },
  safety: { category: 'helper_job', priority: 'urgent', sla: '1 hour' },
  payment_issue: { category: 'helper_payment', priority: 'high', sla: '4 hours' },
};

function present(row) {
  return {
    id: String(row.id), ticketNumber: row.ticket_number, subject: row.subject, kind: row.metadata?.kind || null,
    priority: row.priority, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function assignedJob(db, jobId, userId) {
  if (!UUID.test(jobId || '')) throw new AppError('Invalid job', 400, 'validation_failed');
  await requireHelper(db, userId);
  const { rows: [job] } = await db.query(
    'SELECT id, title FROM jobs WHERE id = $1 AND assigned_helper_id = $2 AND deleted_at IS NULL', [jobId, userId]);
  if (!job) throw new AppError('Job not found', 404, 'not_found');
  return job;
}

async function file(userId, jobId, body) {
  const kind = typeof body?.kind === 'string' ? body.kind : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const requestId = typeof body?.clientRequestId === 'string' ? body.clientRequestId.trim() : '';
  const fields = {};
  if (!KINDS[kind]) fields.kind = 'kind must be job_issue, safety, or payment_issue';
  if (!message || message.length > 5000) fields.message = 'Message is required (5000 characters max)';
  if (!UUID.test(requestId)) fields.clientRequestId = 'clientRequestId must be a UUID';
  if (Object.keys(fields).length) throw new AppError('Validation failed', 400, 'validation_failed', fields);
  const spec = KINDS[kind];
  const outcome = await withTransaction(pool, async (db) => {
    const job = await assignedJob(db, jobId, userId);
    const { rows: [user] } = await db.query('SELECT first_name, last_name, email FROM users WHERE id = $1', [userId]);
    const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || 'Helper';
    const subject = `${kind === 'payment_issue' ? 'Payment issue' : kind === 'safety' ? 'Safety concern' : 'Job issue'}: ${job.title || job.id}`.slice(0, 500);
    const { rows: [ticket] } = await db.query(
      `INSERT INTO support_tickets (user_id, name, email, subject, category, priority, status, source,
                                    client_request_id, metadata, sla_due_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', 'direct', $7, $8::jsonb, NOW() + ($9::text)::interval)
       ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [userId, name, (user?.email || '').toLowerCase(), subject, spec.category, spec.priority, requestId,
        JSON.stringify({ helper_job_support: true, job_id: job.id, kind }), spec.sla]);
    if (!ticket) {
      const { rows: [prior] } = await db.query('SELECT * FROM support_tickets WHERE client_request_id = $1', [requestId]);
      if (!prior || String(prior.user_id) !== String(userId) || prior.metadata?.job_id !== job.id || prior.metadata?.kind !== kind) {
        throw new AppError('Retry key already used', 409, 'idempotency_conflict');
      }
      return { ticket: prior, created: false };
    }
    await db.query(
      `INSERT INTO support_messages (ticket_id, sender_id, sender_name, sender_email, content, is_internal, is_from_admin)
       VALUES ($1, $2, $3, $4, $5, FALSE, FALSE)`,
      [ticket.id, userId, name, (user?.email || '').toLowerCase(), message]);
    return { ticket, created: true };
  }, 'helper_job_support_file');
  if (outcome.created) {
    try {
      await notifySupportStaff({
        type: 'helper_job_support_requested',
        title: kind === 'payment_issue' ? 'Helper reported a payment issue' : 'Helper escalated a job',
        body: outcome.ticket.subject,
        data: { ticketId: String(outcome.ticket.id), ticketNumber: outcome.ticket.ticket_number, jobId, kind },
        action_url: '/admin/support',
        idempotencyKeyPrefix: `helper-job-support-${outcome.ticket.id}`,
      });
    } catch (error) {
      logger.warn('Failed to notify staff of helper job support', { ticketId: outcome.ticket.id, error: error.message });
    }
  }
  return { ticket: present(outcome.ticket), duplicate: !outcome.created };
}

async function list(userId, jobId) {
  await assignedJob(pool, jobId, userId);
  const { rows } = await pool.query(
    `SELECT * FROM support_tickets
      WHERE user_id = $1 AND metadata->>'job_id' = $2 AND COALESCE((metadata->>'helper_job_support')::boolean, false)
      ORDER BY created_at DESC LIMIT 50`, [userId, jobId]);
  return rows.map(present);
}

module.exports = { file, list, KINDS };
