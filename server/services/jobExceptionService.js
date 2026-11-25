'use strict';
// Groups 5-6 item 265 (G5-5 HIGH): exception routing for OxSteed service
// jobs. The delivery exception-summary shape is the model: one timeline of
// reports per job, participant-scoped, manager-routed. Categories mirror
// the appointment exceptions (workJobsService KINDS) so the two surfaces
// read the same way; the store is separate because jobs have no business
// appointment to attach to.
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { sendNotification } = require('./notificationService');
const logger = require('../utils/logger');

const KINDS = {
  exception: ['customer_not_home', 'access_issue', 'scope_change', 'parts_missing', 'weather', 'other'],
  missing_instruction: ['address', 'scope', 'access_code', 'materials', 'customer_contact', 'other'],
  incident: ['injury', 'property_damage', 'vehicle', 'safety_hazard', 'customer_conduct', 'other'],
  access_denied: ['permission', 'location', 'document', 'other'],
  reassignment_request: ['schedule', 'skills', 'workload', 'personal', 'other'],
};

function text(value, max, { min = 1 } = {}) {
  if (typeof value !== 'string') throw new AppError('Invalid input', 400, 'validation_failed');
  const clean = value.trim();
  if (clean.length < min || clean.length > max) throw new AppError('Invalid input', 400, 'validation_failed');
  return clean;
}

async function loadJob(jobId) {
  const { rows: [job] } = await pool.query(
    `SELECT id, client_id, assigned_helper_id, status, title FROM jobs WHERE id = $1 AND deleted_at IS NULL`,
    [jobId],
  );
  if (!job) throw new AppError('Job not found', 404, 'job_not_found');
  return job;
}

function isParticipant(job, userId) {
  return String(job.client_id) === String(userId)
    || (job.assigned_helper_id && String(job.assigned_helper_id) === String(userId));
}

// D-459: the report routes to the helper's business owner when the raiser
// is the assigned helper and belongs to an active business (the crew
// manager); otherwise it routes to the job's client, who owns the job.
async function resolveRoutedTo(job, raiserId) {
  if (job.assigned_helper_id && String(job.assigned_helper_id) === String(raiserId)) {
    const { rows: [m] } = await pool.query(
      `SELECT b.user_id FROM business_members bm JOIN businesses b ON b.id = bm.business_id
        WHERE bm.member_id = $1 AND bm.status = 'active' AND b.deleted_at IS NULL AND b.is_active = TRUE
        ORDER BY bm.accepted_at ASC NULLS LAST, bm.id ASC LIMIT 1`,
      [raiserId],
    );
    if (m) return m.user_id;
  }
  return job.client_id;
}

async function notifySafe(userId, type, jobId, key) {
  if (!userId) return;
  try {
    await sendNotification({
      userId,
      type,
      data: { job_id: jobId },
      action_url: `/jobs/${jobId}`,
      idempotencyKey: key,
    });
  } catch (err) {
    logger.warn('Failed to send job exception notification', { type, jobId, error: err.message });
  }
}

async function raise(jobId, userId, body) {
  const job = await loadJob(jobId);
  if (!isParticipant(job, userId)) throw new AppError('Job not found', 404, 'job_not_found');
  const kind = body?.kind;
  if (!KINDS[kind]) throw new AppError('Invalid input', 400, 'validation_failed');
  if (!KINDS[kind].includes(body.category)) throw new AppError('Invalid input', 400, 'validation_failed');
  const severity = body.severity || (kind === 'incident' ? 'high' : 'normal');
  if (!['low', 'normal', 'high', 'critical'].includes(severity)) throw new AppError('Invalid input', 400, 'validation_failed');
  const description = text(body.description, 2000, { min: 5 });
  const requestId = typeof body.request_id === 'string' && body.request_id.length <= 80 && body.request_id.trim()
    ? body.request_id.trim() : null;
  if (!requestId) throw new AppError('Invalid input', 400, 'validation_failed');
  const routedTo = await resolveRoutedTo(job, userId);
  const { rows: [row] } = await pool.query(
    `INSERT INTO job_exceptions(job_id, raised_by, routed_to, kind, category, severity, description, request_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (job_id, raised_by, request_id) DO NOTHING RETURNING *`,
    [jobId, userId, routedTo, kind, body.category, severity, description, requestId],
  );
  if (row) {
    await notifySafe(routedTo, 'job_exception_raised', jobId, `job-exc:${row.id}`);
    if (String(job.client_id) !== String(routedTo)) {
      await notifySafe(job.client_id, 'job_exception_raised', jobId, `job-exc-client:${row.id}`);
    }
    return row;
  }
  const { rows: [dup] } = await pool.query(
    `SELECT * FROM job_exceptions WHERE job_id = $1 AND raised_by = $2 AND request_id = $3`,
    [jobId, userId, requestId],
  );
  if (!dup) throw new AppError('Conflict', 409, 'conflict');
  return dup;
}

const EXC_SELECT = `SELECT e.*, TRIM(CONCAT(r.first_name, ' ', r.last_name)) AS raised_by_name,
    TRIM(CONCAT(t.first_name, ' ', t.last_name)) AS routed_to_name
  FROM job_exceptions e LEFT JOIN users r ON r.id = e.raised_by LEFT JOIN users t ON t.id = e.routed_to`;

// Delivery exception-summary shape, per job: the job, one timeline of
// reports newest first, and the open count.
async function summary(jobId, userId) {
  const job = await loadJob(jobId);
  const { rows } = await pool.query(
    `${EXC_SELECT} WHERE e.job_id = $1 ORDER BY e.created_at DESC, e.id DESC`, [jobId],
  );
  const visible = rows.filter((e) => isParticipant(job, userId) || String(e.routed_to) === String(userId));
  if (!isParticipant(job, userId) && !visible.length) throw new AppError('Job not found', 404, 'job_not_found');
  const isClient = String(job.client_id) === String(userId);
  return {
    job: { id: job.id, title: job.title, status: job.status },
    exceptions: visible.map((e) => ({
      ...e,
      can_decide: isClient || String(e.routed_to) === String(userId),
    })),
    open_count: visible.filter((e) => ['open', 'acknowledged'].includes(e.status)).length,
  };
}

async function update(jobId, exceptionId, userId, body) {
  const job = await loadJob(jobId);
  if (!['acknowledged', 'resolved', 'dismissed'].includes(body?.status)) {
    throw new AppError('Invalid input', 400, 'validation_failed');
  }
  const resolution = body.status === 'acknowledged'
    ? (typeof body.resolution === 'string' ? body.resolution.trim().slice(0, 1000) || null : null)
    : text(body.resolution, 1000);
  const { withTransaction } = require('../utils/transaction');
  const row = await withTransaction(pool, async (db) => {
    const { rows: [e] } = await db.query(
      `SELECT * FROM job_exceptions WHERE id = $1 AND job_id = $2 FOR UPDATE`, [exceptionId, jobId],
    );
    if (!e) throw new AppError('Exception not found', 404, 'job_exception_not_found');
    const canDecide = String(job.client_id) === String(userId) || String(e.routed_to) === String(userId);
    if (!canDecide) throw new AppError('You do not have access to this exception', 403, 'access_required');
    if (String(e.raised_by) === String(userId) && body.status !== 'acknowledged') {
      throw new AppError('You cannot resolve your own report', 403, 'self_review');
    }
    if (body.expectedVersion != null && Number(body.expectedVersion) !== e.version) {
      throw new AppError('This exception changed; reload and retry', 409, 'conflict');
    }
    if (['resolved', 'dismissed'].includes(e.status)) throw new AppError('Invalid transition', 409, 'invalid_transition');
    const { rows: [r] } = await db.query(
      `UPDATE job_exceptions SET status = $2, version = version + 1, updated_at = NOW(),
          acknowledged_at = COALESCE(acknowledged_at, NOW()),
          resolved_at = CASE WHEN $2 IN ('resolved', 'dismissed') THEN NOW() END,
          resolution = COALESCE($3, resolution)
        WHERE id = $1 RETURNING *`,
      [e.id, body.status, resolution],
    );
    return r;
  }, 'job_exception_update');
  await notifySafe(row.raised_by, 'job_exception_updated', jobId, `job-exc-upd:${row.id}:${row.version}`);
  return row;
}

module.exports = { KINDS, raise, summary, update };
