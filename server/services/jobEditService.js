'use strict';

/**
 * Posted-job editing: one transactional path for owner edits, admin edits,
 * and admin rollbacks.
 *
 *  1. lock the job row (FOR UPDATE; lock order is always jobs → bids)
 *  2. ownership, optimistic-concurrency precondition, idempotency replay
 *  3. status gate (services/jobStatusPolicy) and post-acceptance field locks
 *  4. shared schema validation (validation/jobSchema) → 422 field codes
 *  5. material edits with pending bids start a new revision, flag every
 *     pending bid for reconfirmation, and shorten its expiry
 *  6. append-only job_revisions row + outbox events in the same transaction
 *
 * See docs/job-editing.md.
 */

const crypto = require('crypto');
const Sentry = require('@sentry/node');
const pool = require('../db');
const logger = require('../utils/logger');
const metrics = require('./metricsService');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');
const policy = require('./jobStatusPolicy');
const schema = require('../validation/jobSchema');
const { enqueueJobEvent, EVENT_TYPES } = require('./jobEventOutbox');
const { jobEtag } = require('./jobSerializer');

const RECONFIRM_WINDOW_HOURS = () => Math.max(1, Number(process.env.JOB_RECONFIRM_WINDOW_HOURS || 48));
const MAX_MATERIAL_EDITS_PER_DAY = () => Math.max(1, Number(process.env.JOB_MAX_MATERIAL_EDITS_PER_DAY || 5));
const TOLERATED_KEYS = new Set(['expected_version', 'reason', 'currency_code', 'id', 'version', 'revision', 'status']);

// Fields helpers never see in revision history.
const PRIVATE_REVISION_FIELDS = new Set(['private_notes', 'location_address', 'location_lat', 'location_lng', 'location_zip']);

class JobEditError extends AppError {
  constructor(message, status, code, fields, extra = {}) {
    super(message, status, code, fields);
    Object.assign(this, extra);
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

/** Canonical editable view of a jobs row (the shape the schema validates). */
function canonicalJob(row) {
  return {
    title: row.title ?? null,
    description: row.description ?? null,
    category_name: row.category_name ?? null,
    budget_type: row.budget_type ?? 'open',
    budget_min_cents: row.budget_min_cents ?? (row.budget_min != null ? Math.round(Number(row.budget_min) * 100) : null),
    budget_max_cents: row.budget_max_cents ?? (row.budget_max != null ? Math.round(Number(row.budget_max) * 100) : null),
    urgency: row.urgency ?? 'flexible',
    site_access: row.site_access ?? 'easy',
    recurrence: row.recurrence ?? 'none',
    notes: row.notes ?? null,
    private_notes: row.private_notes ?? null,
    location_address: row.location_address ?? null,
    location_city: row.location_city ?? null,
    location_state: row.location_state ?? null,
    location_zip: row.location_zip ?? null,
    location_country: row.location_country ?? null,
    location_lat: toNumber(row.location_lat),
    location_lng: toNumber(row.location_lng),
    scheduled_start_at: toIso(row.scheduled_start_at),
    scheduled_precision: row.scheduled_precision ?? null,
    requirements: toArray(row.requirements),
    required_skills: toArray(row.required_skills),
  };
}

const JSONB_FIELDS = new Set(['requirements', 'required_skills']);

function skillIdsLiteral(skills) {
  const ids = toArray(skills)
    .map((s) => s && (s.id ?? s.skill_id))
    .filter((id) => id !== undefined && id !== null && String(id).trim() !== '' && Number.isFinite(Number(id)))
    .map((id) => Math.trunc(Number(id)));
  return `{${ids.join(',')}}`;
}

/** Compact snapshot stored on bids so a hire always matches what was bid on. */
function bidJobSnapshot(row) {
  const c = canonicalJob(row);
  return {
    version: row.version,
    revision: row.revision,
    title: c.title,
    category_name: c.category_name,
    budget_type: c.budget_type,
    budget_min_cents: c.budget_min_cents,
    budget_max_cents: c.budget_max_cents,
    scheduled_start_at: c.scheduled_start_at,
    scheduled_precision: c.scheduled_precision,
    location_city: c.location_city,
    location_state: c.location_state,
    description_sha256: crypto.createHash('sha256').update(String(c.description || '')).digest('hex'),
  };
}

function filterRevisionForViewer(revision, role) {
  if (role === 'owner' || role === 'admin') return revision;
  const changes = {};
  for (const [key, value] of Object.entries(revision.changes || {})) {
    if (!PRIVATE_REVISION_FIELDS.has(key)) changes[key] = value;
  }
  return {
    id: revision.id, version: revision.version, revision: revision.revision, is_material: revision.is_material,
    source: revision.source, created_at: revision.created_at, changes,
  };
}

function preconditionError(kind, job) {
  const etag = jobEtag(job);
  if (kind === 'if-match') {
    return new JobEditError('The job changed since you loaded it.', 412, 'precondition_failed',
      { version: 'version_conflict' }, { etag, currentVersion: job.version });
  }
  return new JobEditError('The job changed since you loaded it.', 409, 'version_conflict',
    { version: 'version_conflict' }, { etag, currentVersion: job.version });
}

async function lockJob(client, jobId) {
  const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
  return rows[0] || null;
}

/**
 * @param {object} args
 * @param {string} args.jobId
 * @param {{id:string, role:string}} args.actor
 * @param {object} args.input               request body
 * @param {'merge'|'legacy'} [args.mode]    PATCH merge-patch vs legacy PUT
 * @param {number|'*'|null} [args.expectedVersion]
 * @param {'if-match'|'body'|null} [args.preconditionSource]
 * @param {'owner'|'admin'|'rollback'} [args.source]
 * @param {string|null} [args.reason]
 * @param {string|null} [args.idempotencyKey]
 * @param {string|null} [args.requestId]
 * @param {boolean} [args.allowPastSchedule]
 */
async function applyJobEdit(args) {
  return Sentry.startSpan({ name: 'job.edit', op: 'job.edit', attributes: { source: args.source || 'owner' } },
    () => applyJobEditInner(args));
}

async function applyJobEditInner({
  jobId, actor, input, mode = 'merge', expectedVersion = null, preconditionSource = null,
  source = 'owner', reason = null, idempotencyKey = null, requestId = null, allowPastSchedule = false,
}) {
  const started = Date.now();
  const isAdminSource = source === 'admin' || source === 'rollback';
  const { patch, unknown } = schema.normalizeJobInput(input, { mode });
  const rejected = unknown.filter((key) => !TOLERATED_KEYS.has(key));
  if (mode === 'merge' && rejected.length) {
    metrics.incrementCounter('job_edit.rejected', 1, { reason: 'not_editable' });
    throw new JobEditError('Some fields cannot be edited.', 422, 'validation_failed',
      Object.fromEntries(rejected.map((key) => [key, 'not_editable'])));
  }
  if (isAdminSource && (!reason || String(reason).trim().length < 5)) {
    throw new JobEditError('A reason is required for admin edits.', 422, 'validation_failed', { reason: 'required' });
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      const job = await lockJob(client, jobId);
      if (!job || job.deleted_at) throw new JobEditError('Job not found', 404, 'job_not_found');
      if (!isAdminSource && String(job.client_id) !== String(actor.id)) {
        // Same response as a missing job: no ownership enumeration.
        throw new JobEditError('Job not found', 404, 'job_not_found');
      }

      if (idempotencyKey) {
        const { rows: replay } = await client.query(
          `SELECT id FROM job_revisions WHERE job_id = $1 AND actor_id = $2 AND idempotency_key = $3 LIMIT 1`,
          [job.id, actor.id, idempotencyKey]
        );
        if (replay[0]) return { job, changes: {}, replayed: true, material: false, bidsFlagged: 0 };
      }

      if (expectedVersion !== null && expectedVersion !== undefined && expectedVersion !== '*'
          && Number(job.version) !== Number(expectedVersion)) {
        throw preconditionError(preconditionSource || 'body', job);
      }

      const editable = isAdminSource ? policy.isAdminEditable(job.status) : policy.isOwnerEditable(job.status);
      if (!editable) {
        throw new JobEditError(`Jobs in '${job.status}' status cannot be edited.`, 409, 'job_not_editable',
          { status: 'job_not_editable' }, { etag: jobEtag(job) });
      }
      if (policy.isAccepted(job.status)) {
        const locked = Object.keys(patch).filter((key) => schema.LOCKED_AFTER_ACCEPTANCE.includes(key));
        if (locked.length) {
          throw new JobEditError('Price and scope are fixed after a helper is hired. Use a change order.', 422,
            'validation_failed', Object.fromEntries(locked.map((key) => [key, 'locked_after_acceptance'])));
        }
      }

      const current = canonicalJob(job);
      const errors = schema.validateJobFields(patch, { mode: 'edit', current });
      if (allowPastSchedule && errors.scheduled_start_at === 'in_past') delete errors.scheduled_start_at;
      if (Object.keys(errors).length) {
        metrics.incrementCounter('job_edit.rejected', 1, { reason: 'validation' });
        throw new JobEditError('Validation failed', 422, 'validation_failed', errors);
      }

      const changes = schema.diffJobFields(current, patch);
      if (!Object.keys(changes).length) {
        return { job, changes, replayed: false, material: false, bidsFlagged: 0 };
      }
      const material = schema.isMaterialChange(changes);

      const { rows: pendingRows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM bids WHERE job_id = $1 AND status = 'pending'`,
        [job.id]
      );
      const pendingBids = Number(pendingRows[0]?.n || 0);
      const newRevision = material && pendingBids > 0;

      if (newRevision && source === 'owner') {
        const { rows: recent } = await client.query(
          `SELECT COUNT(*)::int AS n FROM job_revisions
            WHERE job_id = $1 AND is_material = TRUE AND source = 'owner'
              AND created_at >= NOW() - INTERVAL '24 hours'`,
          [job.id]
        );
        if (Number(recent[0]?.n || 0) >= MAX_MATERIAL_EDITS_PER_DAY()) {
          metrics.incrementCounter('job_edit.rejected', 1, { reason: 'material_limit' });
          throw new JobEditError('This job has been changed too often while helpers are bidding. Try again tomorrow.',
            429, 'material_edit_limit');
        }
      }

      const sets = [];
      const params = [];
      const push = (sql, value) => { params.push(value); sets.push(sql.replace('?', `$${params.length}`)); };
      for (const key of Object.keys(changes)) {
        const value = patch[key];
        if (JSONB_FIELDS.has(key)) push(`${key} = ?::jsonb`, JSON.stringify(value ?? []));
        else if (key === 'scheduled_start_at') push(`${key} = ?::timestamptz`, value);
        else push(`${key} = ?`, value);
      }
      if (changes.required_skills) push('skill_ids = ?::int[]', skillIdsLiteral(patch.required_skills));
      if (changes.urgency) push('is_urgent = ?', patch.urgency === 'asap');
      if (changes.scheduled_start_at && !changes.scheduled_precision && patch.scheduled_start_at !== null) {
        push('scheduled_precision = ?', patch.scheduled_precision || current.scheduled_precision || 'datetime');
      }
      if (material) sets.push('material_edit_count = material_edit_count + 1', 'last_material_edit_at = NOW()');
      if (newRevision) sets.push('revision = revision + 1');
      sets.push('updated_at = NOW()');
      params.push(job.id);
      const { rows: updatedRows } = await client.query(
        `UPDATE jobs SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );
      const updated = updatedRows[0];

      let bidsFlagged = 0;
      if (newRevision) {
        const flagged = await client.query(
          `UPDATE bids
              SET needs_reconfirm = TRUE,
                  reconfirm_requested_at = NOW(),
                  expires_at = LEAST(expires_at, NOW() + ($3::integer * INTERVAL '1 hour')),
                  updated_at = NOW()
            WHERE job_id = $1 AND status = 'pending'
              AND (job_revision IS NULL OR job_revision < $2)`,
          [job.id, updated.revision, RECONFIRM_WINDOW_HOURS()]
        );
        bidsFlagged = flagged.rowCount || 0;
      }

      const keepSnapshot = pendingBids > 0 || isAdminSource || policy.isAccepted(job.status);
      await client.query(
        `INSERT INTO job_revisions
           (job_id, version, revision, is_material, source, actor_id, actor_role, reason, changes, snapshot,
            request_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
        [
          job.id, updated.version, updated.revision, material, source, actor.id || null, actor.role || null,
          reason ? String(reason).trim().slice(0, 1000) : null,
          JSON.stringify(changes), keepSnapshot ? JSON.stringify(current) : null,
          requestId ? String(requestId).slice(0, 120) : null, idempotencyKey || null,
        ]
      );

      const changedFields = Object.keys(changes);
      await enqueueJobEvent(client, {
        jobId: job.id,
        eventType: EVENT_TYPES.UPDATED,
        payload: { version: updated.version, changed_fields: changedFields },
        coalesce: false,
      });
      if (material) {
        await enqueueJobEvent(client, {
          jobId: job.id,
          eventType: EVENT_TYPES.MATERIAL_CHANGE,
          payload: { revision: updated.revision, changed_fields: changedFields },
        });
      }
      return { job: updated, changes, replayed: false, material, newRevision, bidsFlagged };
    }, 'job_edit');

    const duration = Date.now() - started;
    metrics.incrementCounter('job_edit.applied', 1, { source, material: String(Boolean(result.material)) });
    metrics.recordHistogram('job_edit.duration_ms', duration, { source });
    if (result.bidsFlagged) metrics.incrementCounter('job_edit.bids_flagged', result.bidsFlagged);
    logger.info('job_edit.applied', {
      jobId, actorId: actor.id, source, material: Boolean(result.material), newRevision: Boolean(result.newRevision),
      bidsFlagged: result.bidsFlagged, changedFields: Object.keys(result.changes), replayed: result.replayed,
      version: result.job?.version, durationMs: duration, requestId,
    });
    return result;
  } catch (err) {
    if (err instanceof AppError && err.status === 409 && err.code === 'version_conflict') metrics.incrementCounter('job_edit.conflict');
    if (err instanceof AppError && err.status === 412) metrics.incrementCounter('job_edit.conflict');
    if (!(err instanceof AppError)) {
      metrics.incrementCounter('job_edit.error');
      logger.error('job_edit.failed', { jobId, actorId: actor?.id, source, error: err.message, code: err.code });
    }
    throw err;
  }
}

async function listJobRevisions({ jobId, viewer, limit = 50, before = null }) {
  const { rows: jobs } = await pool.query('SELECT id, client_id, deleted_at FROM jobs WHERE id = $1', [jobId]);
  const job = jobs[0];
  if (!job || job.deleted_at) throw new JobEditError('Job not found', 404, 'job_not_found');
  const isAdmin = ['admin', 'super_admin'].includes(viewer?.role);
  let role = isAdmin ? 'admin' : String(job.client_id) === String(viewer?.id) ? 'owner' : null;
  if (!role) {
    const { rows } = await pool.query('SELECT 1 FROM bids WHERE job_id = $1 AND helper_id = $2 LIMIT 1', [jobId, viewer?.id]);
    if (rows[0]) role = 'bidder';
  }
  if (!role) throw new JobEditError('Job not found', 404, 'job_not_found');
  const bounded = Math.min(100, Math.max(1, Number(limit) || 50));
  const params = [jobId, bounded];
  let cursor = '';
  if (before && /^\d+$/.test(String(before))) { params.push(String(before)); cursor = 'AND id < $3'; }
  const { rows } = await pool.query(
    `SELECT id, job_id, version, revision, is_material, source, actor_id, actor_role, reason, changes, snapshot, created_at
       FROM job_revisions
      WHERE job_id = $1 ${cursor} ${role === 'bidder' ? 'AND is_material = TRUE' : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    params
  );
  const revisions = rows.map((r) => {
    const base = filterRevisionForViewer(r, role);
    if (role !== 'admin') delete base.snapshot;
    if (role !== 'admin') delete base.actor_id;
    // Support notes are internal; bidders only see what changed.
    if (role === 'bidder') { delete base.reason; delete base.actor_role; }
    return base;
  });
  return { revisions, next_before: rows.length === bounded ? String(rows[rows.length - 1].id) : null, role };
}

/** Admin rollback: re-apply the "from" values of one revision as a new revision. */
async function rollbackJobRevision({ jobId, revisionId, actor, reason, requestId = null, expectedVersion = null, preconditionSource = null }) {
  if (!reason || String(reason).trim().length < 5) {
    throw new JobEditError('A reason is required for admin edits.', 422, 'validation_failed', { reason: 'required' });
  }
  if (!/^\d+$/.test(String(revisionId))) throw new JobEditError('Revision not found', 404, 'revision_not_found');
  const { rows } = await pool.query(
    'SELECT id, changes FROM job_revisions WHERE job_id = $1 AND id = $2 LIMIT 1',
    [jobId, revisionId]
  );
  if (!rows[0]) throw new JobEditError('Revision not found', 404, 'revision_not_found');
  const changes = typeof rows[0].changes === 'string' ? JSON.parse(rows[0].changes) : (rows[0].changes || {});
  const input = {};
  for (const [key, value] of Object.entries(changes)) {
    if (schema.EDITABLE_FIELDS.includes(key)) input[key] = value?.from ?? null;
  }
  return applyJobEdit({
    jobId, actor, input, mode: 'merge', source: 'rollback', expectedVersion, preconditionSource,
    reason: `Rollback of revision ${revisionId}: ${String(reason || '').trim()}`, requestId, allowPastSchedule: true,
  });
}

module.exports = {
  applyJobEdit,
  listJobRevisions,
  rollbackJobRevision,
  canonicalJob,
  bidJobSnapshot,
  lockJob,
  JobEditError,
  PRIVATE_REVISION_FIELDS,
};
