'use strict';

/**
 * Compliance case lifecycle for the OxSteed Credit compliance perimeter
 * (Phase 5, gap 8).
 *
 * Transaction-monitoring rule hits (and confirmed sanctions hits) become
 * cases here. Lifecycle: open -> investigating -> resolved | escalated.
 * Cases NEVER auto-resolve: only a super-admin transitions them, every
 * transition records an audit event with actor + reason, and SLA breaches
 * raise incidents via the monitoring job.
 *
 * SLA: OXSTEED_CREDIT_COMPLIANCE_CASE_SLA_HOURS (default 72).
 */

const pool = require('../db');
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');
const { insertAudit } = require('./oxsteedCreditAdminService');

const CASE_SLA_HOURS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_COMPLIANCE_CASE_SLA_HOURS || '72', 10) || 72
);

const CASE_TYPES = Object.freeze([
  'structuring',
  'velocity_spike',
  'rapid_fund_out',
  'new_destination_payout',
  'sanctions_hit',
  'manual',
]);

const CASE_STATUSES = Object.freeze(['open', 'investigating', 'resolved', 'escalated']);

// Allowed transitions; terminal states (resolved) have no outgoing edge.
const CASE_TRANSITIONS = Object.freeze({
  open: ['investigating', 'resolved', 'escalated'],
  investigating: ['resolved', 'escalated'],
  escalated: ['investigating', 'resolved'],
  resolved: [],
});

function normalizeString(value, max = 1000) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text.slice(0, max);
}

function formatCase(row) {
  if (!row) return null;
  const now = Date.now();
  const slaDue = row.sla_due_at ? new Date(row.sla_due_at).getTime() : null;
  const terminal = row.status === 'resolved';
  return {
    id: String(row.id),
    caseType: row.case_type,
    subjectType: row.subject_type,
    subjectId: String(row.subject_id),
    severity: row.severity,
    status: row.status,
    evidence: row.evidence || {},
    slaDueAt: row.sla_due_at,
    slaBreached: !terminal && slaDue !== null && slaDue < now,
    slaHoursRemaining: terminal || slaDue === null ? null : (slaDue - now) / (60 * 60 * 1000),
    assignedTo: row.assigned_to ? String(row.assigned_to) : null,
    resolvedBy: row.resolved_by ? String(row.resolved_by) : null,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Open a case. Idempotent per dedupe_key: the monitoring job re-runs the
 * same period without duplicating cases (ON CONFLICT DO NOTHING).
 */
async function openComplianceCase(client, {
  caseType,
  subjectType,
  subjectId,
  severity = 'medium',
  evidence = {},
  slaHours = CASE_SLA_HOURS,
  dedupeKey,
  assignedTo = null,
}) {
  if (!CASE_TYPES.includes(caseType)) throw new AppError(`Unknown compliance case type '${caseType}'`, 400, 'credit_case_type_invalid');
  if (subjectType !== 'customer' && subjectType !== 'partner') {
    throw new AppError('Case subject type must be customer or partner', 400, 'credit_case_subject_invalid');
  }
  if (!subjectId) throw new AppError('Case subject is required', 400, 'credit_case_subject_required');
  const key = normalizeString(dedupeKey, 200);
  if (!key) throw new AppError('Case dedupe key is required', 400, 'credit_case_dedupe_required');
  const slaDueAt = new Date(Date.now() + Math.max(1, Number(slaHours) || CASE_SLA_HOURS) * 60 * 60 * 1000).toISOString();
  const { rows } = await client.query(
    `INSERT INTO oxsteed_credit_compliance_cases
       (case_type, subject_type, subject_id, severity, status, evidence, sla_due_at, assigned_to, dedupe_key)
     VALUES ($1, $2, $3, $4, 'open', $5::jsonb, $6, $7, $8)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING *`,
    [caseType, subjectType, String(subjectId), severity, JSON.stringify(evidence || {}), slaDueAt, assignedTo, key]
  );
  if (!rows[0]) {
    const { rows: existing } = await client.query(
      `SELECT * FROM oxsteed_credit_compliance_cases WHERE dedupe_key = $1`,
      [key]
    );
    return { case: formatCase(existing[0]), replayed: true };
  }
  return { case: formatCase(rows[0]), replayed: false };
}

/**
 * Admin-only transition. Resolving requires a resolution note; the note,
 * actor, and timestamp are the audit evidence. Terminal 'resolved' cases
 * cannot be reopened (a new case must be opened instead), which keeps the
 * trail unambiguous.
 */
async function transitionComplianceCase({ caseId, toStatus, actorUserId, reason, assignedTo = null, requestIp = null }) {
  if (!caseId) throw new AppError('Case id is required', 400, 'credit_case_id_required');
  if (!CASE_STATUSES.includes(toStatus)) throw new AppError(`Unknown case status '${toStatus}'`, 400, 'credit_case_status_invalid');
  const normalizedReason = normalizeString(reason, 2000);
  if (!normalizedReason) throw new AppError('A transition reason is required', 400, 'credit_case_reason_required');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_compliance_cases WHERE id = $1 FOR UPDATE`,
      [caseId]
    );
    const current = rows[0];
    if (!current) throw new AppError('Compliance case not found', 404, 'credit_case_not_found');
    const allowed = CASE_TRANSITIONS[current.status] || [];
    if (!allowed.includes(toStatus)) {
      throw new AppError(
        `Cannot transition a ${current.status} case to ${toStatus}`,
        409,
        'credit_case_transition_invalid',
        { caseId: String(caseId), fromStatus: current.status, toStatus }
      );
    }
    const resolving = toStatus === 'resolved';
    const { rows: updated } = await client.query(
      `UPDATE oxsteed_credit_compliance_cases
          SET status = $2,
              assigned_to = COALESCE($3, assigned_to),
              resolved_by = CASE WHEN $4 THEN $5 ELSE resolved_by END,
              resolved_at = CASE WHEN $4 THEN NOW() ELSE resolved_at END,
              resolution_note = CASE WHEN $4 THEN $6 ELSE resolution_note END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [caseId, toStatus, assignedTo, resolving, actorUserId, resolving ? normalizedReason : null]
    );
    await insertAudit(client, {
      actionType: 'credit.compliance.case_transitioned',
      actorUserId,
      resourceType: 'credit_compliance_case',
      resourceId: caseId,
      reason: normalizedReason,
      requestIp,
      beforeState: { status: current.status },
      afterState: { status: toStatus, assignedTo: updated[0].assigned_to },
      metadata: { caseType: current.case_type, subjectType: current.subject_type, subjectId: String(current.subject_id) },
    });
    return { case: formatCase(updated[0]) };
  }, 'credit_case_transition');
}

async function listComplianceCases(client, { status = null, limit = 50, offset = 0 } = {}) {
  const params = [];
  let where = '';
  if (status) {
    if (!CASE_STATUSES.includes(status)) throw new AppError(`Unknown case status '${status}'`, 400, 'credit_case_status_invalid');
    params.push(status);
    where = `WHERE c.status = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await client.query(
    `SELECT c.*,
            CASE WHEN c.subject_type = 'customer' THEN u.email ELSE NULL END AS subject_email
       FROM oxsteed_credit_compliance_cases c
       LEFT JOIN users u ON u.id::text = c.subject_id AND c.subject_type = 'customer'
      ${where}
      ORDER BY c.sla_due_at ASC, c.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map((row) => ({ ...formatCase(row), subjectEmail: row.subject_email || null }));
}

/**
 * Cases past their SLA that are still actionable. The monitoring job turns
 * these into incidents; the job never resolves them.
 */
async function findSlaBreachedCases(client, now = new Date()) {
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_compliance_cases
      WHERE status IN ('open', 'investigating')
        AND sla_due_at < $1
      ORDER BY sla_due_at ASC
      LIMIT 200`,
    [now.toISOString()]
  );
  return rows.map(formatCase);
}

async function getComplianceQueue(client, { limit = 50, offset = 0 } = {}) {
  const { listPendingVerifications } = require('./identityVerificationService');
  const { listPendingSanctionHits } = require('./sanctionsScreeningService');
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const [verifications, sanctions, cases, counts] = await Promise.all([
    listPendingVerifications(client, { limit: lim, offset: off }),
    listPendingSanctionHits(client, { limit: lim, offset: off }),
    listComplianceCases(client, { limit: lim, offset: off }),
    // T38-F02: totals, not page lengths, so operators can navigate the full queue.
    client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM oxsteed_credit_identity_verifications WHERE status = 'pending') AS pending_verifications,
         (SELECT COUNT(*)::int FROM oxsteed_credit_sanctions_screenings WHERE result = 'hit' AND cleared_at IS NULL) AS pending_sanctions,
         (SELECT COUNT(*)::int FROM oxsteed_credit_compliance_cases WHERE status IN ('open', 'investigating', 'escalated')) AS open_cases`
    ),
  ]);
  const openCases = cases.filter((c) => c.status === 'open' || c.status === 'investigating' || c.status === 'escalated');
  const totals = counts.rows[0] || {};
  return {
    verifications,
    sanctions,
    cases: openCases,
    counts: {
      pendingVerifications: Number(totals.pending_verifications || 0),
      pendingSanctions: Number(totals.pending_sanctions || 0),
      openCases: Number(totals.open_cases || 0),
      slaBreachedCases: openCases.filter((c) => c.slaBreached).length,
    },
    pagination: { limit: lim, offset: off },
  };
}

module.exports = {
  CASE_SLA_HOURS,
  CASE_TYPES,
  CASE_STATUSES,
  CASE_TRANSITIONS,
  openComplianceCase,
  transitionComplianceCase,
  listComplianceCases,
  findSlaBreachedCases,
  getComplianceQueue,
  formatCase,
};
