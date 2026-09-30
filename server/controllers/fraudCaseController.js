'use strict';

/**
 * Fraud case controller (admin-only).
 *
 * Case creation for manual reports goes through the sibling-owned
 * `fraudCaseService.createFraudCase` (dedupe + insert logic lives there and
 * must not be duplicated here). This controller owns listing, assignment,
 * and the open -> investigating -> resolved/dismissed workflow, plus
 * dispute linking. Every mutation writes an admin_audit_log row via
 * logAdminAction, fail-closed (throwOnError).
 */

const db = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { logAdminAction } = require('../services/auditService');
const {
  createFraudCase,
  listFraudCases: listFraudCasesQuery,
} = require('../services/fraudCaseService');
const logger = require('../utils/logger');

const SUBJECT_TYPES = Object.freeze(['user', 'business']);
const CATEGORIES = Object.freeze([
  'affiliate_fraud',
  'collusion',
  'account_takeover',
  'chargeback',
  'abuse_report',
  'other',
]);
const SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
const STATUSES = Object.freeze(['open', 'investigating', 'resolved', 'dismissed']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

async function audit(adminId, action, kase, req, extra = {}) {
  await logAdminAction({
    adminId,
    action,
    targetType: 'fraud_case',
    targetId: kase?.id || null,
    req,
    throwOnError: true,
    ...extra,
  });
}

async function loadCaseOr404(id) {
  if (!isUuid(id)) {
    throw new AppError('Fraud case not found', 404, 'fraud_case_not_found');
  }
  const { rows } = await db.query('SELECT * FROM fraud_cases WHERE id = $1', [id]);
  if (!rows.length) {
    throw new AppError('Fraud case not found', 404, 'fraud_case_not_found');
  }
  return rows[0];
}

function requireTransition(kase, allowedFrom, actionLabel) {
  if (!allowedFrom.includes(kase.status)) {
    throw new AppError(
      `Cannot ${actionLabel} a fraud case with status '${kase.status}'`,
      400,
      'invalid_transition',
      { status: kase.status, allowedFrom }
    );
  }
}

// ─── GET /cases ───────────────────────────────────────────────────
// Admin list with filters and pagination.
exports.listFraudCases = async (req, res, next) => {
  try {
    const data = await listFraudCasesQuery(req.query || {});
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// ─── POST /cases ──────────────────────────────────────────────────
// Manual creation; dedupe/insert logic lives in fraudCaseService.
exports.createFraudCase = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const { subject_type, subject_id, category, summary, severity } = req.body || {};

    const fields = {};
    if (!SUBJECT_TYPES.includes(subject_type)) {
      fields.subject_type = `Invalid subject_type. Must be one of: ${SUBJECT_TYPES.join(', ')}`;
    }
    if (!subject_id || !String(subject_id).trim()) {
      fields.subject_id = 'subject_id is required';
    }
    if (!CATEGORIES.includes(category)) {
      fields.category = `Invalid category. Must be one of: ${CATEGORIES.join(', ')}`;
    }
    if (severity !== undefined && !SEVERITIES.includes(severity)) {
      fields.severity = `Invalid severity. Must be one of: ${SEVERITIES.join(', ')}`;
    }
    if (!summary || !String(summary).trim()) {
      fields.summary = 'summary is required';
    }
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    const kase = await createFraudCase({
      subjectType: subject_type,
      subjectId: String(subject_id).trim(),
      category,
      severity: severity || 'medium',
      source: 'manual',
      sourceRef: null,
      summary: String(summary).trim(),
      evidence: {},
      db,
    });

    await audit(adminId, 'fraud_case_create', kase, req, {
      description: `Manually created fraud case (${category}, ${severity || 'medium'}) for ${subject_type} ${subject_id}`,
      after: { id: kase.id, category, severity: kase.severity, status: kase.status },
    });

    res.status(201).json({ success: true, data: kase });
  } catch (err) {
    next(err);
  }
};

// ─── POST /cases/:id/assign ────────────────────────────────────────
exports.assignFraudCase = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const { id } = req.params;
    const { admin_id: assigneeId } = req.body || {};

    if (!isUuid(assigneeId)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        admin_id: 'admin_id must be a valid UUID',
      });
    }

    const kase = await loadCaseOr404(id);

    const { rows: adminRows } = await db.query(
      'SELECT id, role FROM users WHERE id = $1',
      [assigneeId.trim()]
    );
    if (!adminRows.length) {
      throw new AppError('Admin user not found', 404, 'admin_not_found');
    }
    if (!['admin', 'super_admin'].includes(adminRows[0].role)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        admin_id: 'admin_id must belong to an admin user',
      });
    }

    const { rows: updatedRows } = await db.query(
      `UPDATE fraud_cases
          SET owner_admin_id = $1, updated_at = NOW()
        WHERE id = $2
      RETURNING *`,
      [assigneeId.trim(), id]
    );

    const updated = updatedRows[0];
    await audit(adminId, 'fraud_case_assign', updated, req, {
      description: `Assigned fraud case ${id} to admin ${assigneeId}`,
      before: { owner_admin_id: kase.owner_admin_id },
      after: { owner_admin_id: updated.owner_admin_id },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

async function transitionCase(id, adminId, allowedFrom, toStatus, actionLabel, req) {
  const kase = await loadCaseOr404(id);
  requireTransition(kase, allowedFrom, actionLabel);

  const terminal = toStatus === 'resolved' || toStatus === 'dismissed';
  const { rows: updatedRows } = await db.query(
    `UPDATE fraud_cases
        SET status = $1,
            resolved_at = ${terminal ? 'NOW()' : 'resolved_at'},
            updated_at = NOW()
      WHERE id = $2
    RETURNING *`,
    [toStatus, id]
  );

  const updated = updatedRows[0];
  await audit(adminId, `fraud_case_${actionLabel}`, updated, req, {
    description: `Fraud case ${id} ${actionLabel}d (${kase.status} -> ${toStatus})`,
    before: { status: kase.status },
    after: { status: updated.status, resolved_at: updated.resolved_at },
  });

  return updated;
}

// ─── POST /cases/:id/investigate ───────────────────────────────────
exports.investigateFraudCase = async (req, res, next) => {
  try {
    const updated = await transitionCase(
      req.params.id, req.user.id, ['open'], 'investigating', 'investigate', req
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

// ─── POST /cases/:id/resolve ───────────────────────────────────────
exports.resolveFraudCase = async (req, res, next) => {
  try {
    const updated = await transitionCase(
      req.params.id, req.user.id, ['open', 'investigating'], 'resolved', 'resolve', req
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

// ─── POST /cases/:id/dismiss ───────────────────────────────────────
exports.dismissFraudCase = async (req, res, next) => {
  try {
    const updated = await transitionCase(
      req.params.id, req.user.id, ['open', 'investigating'], 'dismissed', 'dismiss', req
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

// ─── POST /cases/:id/link-dispute ──────────────────────────────────
exports.linkDispute = async (req, res, next) => {
  const { id } = req.params;
  const { dispute_id } = req.body || {};
  try {
    const adminId = req.user.id;

    const disputeId = Number(dispute_id);
    if (!Number.isInteger(disputeId) || disputeId <= 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        dispute_id: 'dispute_id must be a positive integer',
      });
    }

    const { rows: disputeRows } = await db.query(
      'SELECT id FROM disputes WHERE id = $1',
      [disputeId]
    );
    if (!disputeRows.length) {
      throw new AppError('Dispute not found', 404, 'dispute_not_found');
    }

    const kase = await loadCaseOr404(id);

    const evidence = (kase.evidence && typeof kase.evidence === 'object') ? kase.evidence : {};
    const linked = Array.isArray(evidence.disputes) ? [...evidence.disputes] : [];
    if (!linked.includes(disputeId)) linked.push(disputeId);
    const nextEvidence = { ...evidence, disputes: linked };

    const { rows: updatedRows } = await db.query(
      `UPDATE fraud_cases
          SET evidence = $1::jsonb, updated_at = NOW()
        WHERE id = $2
      RETURNING *`,
      [JSON.stringify(nextEvidence), id]
    );

    const updated = updatedRows[0];
    await audit(adminId, 'fraud_case_link_dispute', updated, req, {
      description: `Linked dispute ${disputeId} to fraud case ${id}`,
      after: { dispute_id: disputeId, disputes: linked },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('Failed to link dispute to fraud case', { caseId: id, disputeId: dispute_id, error: err.message });
    next(err);
  }
};

module.exports = {
  listFraudCases: exports.listFraudCases,
  createFraudCase: exports.createFraudCase,
  assignFraudCase: exports.assignFraudCase,
  investigateFraudCase: exports.investigateFraudCase,
  resolveFraudCase: exports.resolveFraudCase,
  dismissFraudCase: exports.dismissFraudCase,
  linkDispute: exports.linkDispute,
};
