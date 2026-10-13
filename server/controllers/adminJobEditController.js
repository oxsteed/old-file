'use strict';

/**
 * Admin/support tooling for posted jobs: edit with a required reason, view
 * the full revision history, and roll back a revision. Every write goes
 * through services/jobEditService (same validation, revisions, bid
 * reconfirmation, outbox) and is also recorded in admin_audit_log.
 */

const { applyJobEdit, listJobRevisions, rollbackJobRevision } = require('../services/jobEditService');
const { serializeJob, jobEtag, parseIfMatch } = require('../services/jobSerializer');
const { logAdminAction } = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// The edit is already committed with actor + reason in job_revisions, so a
// failed admin_audit_log write must not turn a successful edit into a 500.
async function audit(entry) {
  try { await logAdminAction(entry); } catch (err) {
    logger.error('admin_job_edit.audit_failed', { action: entry.action, jobId: entry.targetId, error: err.message });
  }
}

function precondition(req) {
  const ifMatch = parseIfMatch(req.get('If-Match'), req.params.jobId);
  if (Number.isNaN(ifMatch)) throw new AppError('If-Match header is malformed', 400, 'invalid_precondition');
  if (ifMatch !== null) return { expectedVersion: ifMatch, preconditionSource: 'if-match' };
  const v = req.body?.expected_version;
  if (v !== undefined && v !== null && v !== '') return { expectedVersion: Number(v), preconditionSource: 'body' };
  throw new AppError('Send If-Match or expected_version with admin job edits.', 428, 'precondition_required', { version: 'required' });
}

function respond(res, result) {
  const etag = jobEtag(result.job);
  if (etag) res.set('ETag', etag);
  return res.json({
    job: serializeJob(result.job, { role: 'admin' }),
    changed_fields: Object.keys(result.changes || {}),
    material_change: Boolean(result.material),
    bids_flagged_for_reconfirm: result.bidsFlagged || 0,
  });
}

exports.editJob = async (req, res, next) => {
  try {
    const { expectedVersion, preconditionSource } = precondition(req);
    const { reason, expected_version: _ignored, ...input } = req.body || {};
    const result = await applyJobEdit({
      jobId: req.params.jobId,
      actor: { id: req.user.id, role: req.user.role },
      input,
      mode: 'merge',
      expectedVersion,
      preconditionSource,
      source: 'admin',
      reason,
      requestId: req.id || null,
    });
    await audit({
      adminId: req.user.id, action: 'job_edit', targetType: 'job', targetId: req.params.jobId,
      description: String(reason || '').slice(0, 1000),
      before: Object.fromEntries(Object.entries(result.changes || {}).map(([k, v]) => [k, v.from])),
      after: Object.fromEntries(Object.entries(result.changes || {}).map(([k, v]) => [k, v.to])),
      req,
    });
    return respond(res, result);
  } catch (err) {
    if (err?.etag) res.set('ETag', err.etag);
    return next(err);
  }
};

exports.listRevisions = async (req, res, next) => {
  try {
    const result = await listJobRevisions({
      jobId: req.params.jobId, viewer: req.user, limit: req.query.limit, before: req.query.before,
    });
    return res.json({ revisions: result.revisions, next_before: result.next_before });
  } catch (err) {
    return next(err);
  }
};

exports.rollbackRevision = async (req, res, next) => {
  try {
    const { expectedVersion, preconditionSource } = precondition(req);
    const result = await rollbackJobRevision({
      jobId: req.params.jobId,
      revisionId: req.params.revisionId,
      actor: { id: req.user.id, role: req.user.role },
      reason: req.body?.reason,
      expectedVersion,
      preconditionSource,
      requestId: req.id || null,
    });
    await audit({
      adminId: req.user.id, action: 'job_revision_rollback', targetType: 'job', targetId: req.params.jobId,
      description: `revision ${req.params.revisionId}: ${String(req.body?.reason || '').slice(0, 900)}`,
      before: Object.fromEntries(Object.entries(result.changes || {}).map(([k, v]) => [k, v.from])),
      after: Object.fromEntries(Object.entries(result.changes || {}).map(([k, v]) => [k, v.to])),
      req,
    });
    return respond(res, result);
  } catch (err) {
    if (err?.etag) res.set('ETag', err.etag);
    return next(err);
  }
};
