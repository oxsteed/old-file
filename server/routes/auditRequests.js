'use strict';

/**
 * Group 14 Slice 5d (716-720, D-430/D-431): audit-request intake workflow.
 *
 * Self-contained router factory, mounted by the coordinator as e.g.
 *   app.use('/api/audit-requests', require('./routes/auditRequests')());
 *
 * request -> approved evidence -> time-limited share -> follow-up -> receipt.
 *
 * Group 14 is READ-ONLY (D-408): nothing here moves money. These endpoints
 * only insert/read coordination rows; they never mutate amounts, journals,
 * holds, transactions, or statement documents.
 *
 * Scope fails closed (fail_closed_money_and_scope skill):
 * - A requester sees only their own requests; an admin sees all; an auditor
 *   sees only a request where they hold an active (unexpired, unrevoked)
 *   grant. A stranger gets 404 on detail and an empty list, never a
 *   distinguishable error — request existence cannot be probed.
 * - Evidence must belong to the requester (credit_statement_documents
 *   customer_id = the request's requested_by); an auditor never sees
 *   proposed/rejected evidence, only approved evidence under an active
 *   grant, and mints a fresh signed link per approved document through
 *   the same signed-link primitive as the archive (TTL 60..3600s).
 * - A receipt is recorded only by the reviewing auditor holding an active
 *   grant — the owner/admin cannot receipt on the reviewer's behalf.
 * - Every permission is checked server-side on every call; the grant is
 *   re-read fresh on every call so expiry or revocation closes access
 *   immediately.
 */

const express = require('express');

const pool = require('../db');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { authenticate } = require('../middleware/auth');
const { creditMutationLimiter } = require('../middleware/rateLimiter');
const { createSignedUrl } = require('../services/statementArtifactService');
const defaultStorage = require('../utils/statementStorage');
const { notifySupportStaff } = require('../services/supportNotificationService');

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUDIT_TYPES = new Set(['financial', 'compliance', 'tax', 'operational', 'other']);
const REQUEST_STATUSES = new Set(['open', 'in_review', 'closed']);
// D-431: grant TTL bounds. Default 7 days; at least 1 hour (a grant shorter
// than the signed-link window would be useless) and at most 30 days (the
// house file-expiry default, same shape as D-429).
const GRANT_TTL_DEFAULT_SECONDS = 7 * 24 * 60 * 60;
const GRANT_TTL_MIN_SECONDS = 60 * 60;
const GRANT_TTL_MAX_SECONDS = 30 * 24 * 60 * 60;
const MESSAGE_MAX_LENGTH = 5000;
const NOTE_MAX_LENGTH = 1000;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

function notFound() {
  throw new AppError('Audit request not found', 404, 'audit_request_not_found');
}

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, maxLength);
}

function parsePage(req) {
  const page = Number.parseInt(String(req.query.page ?? '1'), 10);
  const pageSize = Number.parseInt(String(req.query.pageSize ?? String(DEFAULT_PAGE_SIZE)), 10);
  return {
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
    pageSize: Number.isSafeInteger(pageSize) && pageSize >= 1
      ? Math.min(pageSize, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE,
  };
}

function requestView(row, extra = {}) {
  return {
    id: row.id,
    title: row.title,
    auditType: row.audit_type,
    scope: row.scope,
    auditorEmail: row.auditor_email,
    status: row.status,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

function countsView(row) {
  return {
    evidenceCount: Number(row.evidence_count || 0),
    approvedCount: Number(row.approved_count || 0),
    shareCount: Number(row.share_count || 0),
    messageCount: Number(row.message_count || 0),
    receiptCount: Number(row.receipt_count || 0),
  };
}

function evidenceView(row) {
  return {
    id: row.id,
    auditRequestId: row.audit_request_id,
    documentId: row.document_id,
    status: row.status,
    proposedBy: row.proposed_by,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

function shareView(row) {
  const active = !row.revoked_at && new Date(row.expires_at).getTime() > Date.now();
  return {
    id: row.id,
    auditRequestId: row.audit_request_id,
    auditorUserId: row.auditor_user_id,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    createdAt: row.created_at,
    active,
  };
}

function messageView(row) {
  return {
    id: row.id,
    auditRequestId: row.audit_request_id,
    authorId: row.author_id,
    authorRole: row.author_role,
    message: row.message,
    createdAt: row.created_at,
  };
}

function receiptView(row) {
  return {
    id: row.id,
    auditRequestId: row.audit_request_id,
    receivedBy: row.received_by,
    package: row.package,
    note: row.note,
    createdAt: row.created_at,
  };
}

const REQUEST_COUNTS = `
  (SELECT COUNT(*)::int FROM audit_request_evidence e WHERE e.audit_request_id = r.id) AS evidence_count,
  (SELECT COUNT(*)::int FROM audit_request_evidence e WHERE e.audit_request_id = r.id AND e.status = 'approved') AS approved_count,
  (SELECT COUNT(*)::int FROM audit_request_shares s WHERE s.audit_request_id = r.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS share_count,
  (SELECT COUNT(*)::int FROM audit_request_messages m WHERE m.audit_request_id = r.id) AS message_count,
  (SELECT COUNT(*)::int FROM audit_request_receipts p WHERE p.audit_request_id = r.id) AS receipt_count`;

// An auditor's standing on a request is a live, active grant — re-read on
// every call so expiry or revocation closes access immediately.
async function hasActiveGrant(client, requestId, userId) {
  const { rows } = await client.query(
    `SELECT 1 FROM audit_request_shares
      WHERE audit_request_id = $1 AND auditor_user_id = $2
        AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`,
    [requestId, userId],
  );
  return rows.length > 0;
}

// Load the request and enforce viewer standing. 404 for unknown, malformed,
// and unauthorized ids alike — existence cannot be probed.
async function loadRequestForViewer(requestId, user) {
  if (!UUID_RE.test(String(requestId || ''))) notFound();
  const { rows: [row] } = await pool.query(
    `SELECT r.*, ${REQUEST_COUNTS} FROM audit_requests r WHERE r.id = $1`,
    [String(requestId).toLowerCase()],
  );
  if (!row) notFound();
  if (isAdminRole(user.role)) return { request: row, access: 'admin' };
  if (String(row.requested_by) === String(user.id)) return { request: row, access: 'owner' };
  if (await hasActiveGrant(pool, row.id, user.id)) return { request: row, access: 'auditor' };
  notFound();
  return null;
}

async function loadRequestForOwnerOrAdmin(requestId, user) {
  const { request, access } = await loadRequestForViewer(requestId, user);
  if (access !== 'owner' && access !== 'admin') {
    throw new AppError('Only the requester or an admin can do that', 403, 'audit_request_forbidden');
  }
  return request;
}

function createAuditRequestsRouter({ storage = defaultStorage, notifyStaff = notifySupportStaff } = {}) {
  const router = express.Router();

  router.use(authenticate, (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // ── 716: audit request intake ──────────────────────────────────────
  // POST / — create a request. The request is the entity 717-720 hang off.
  router.post('/', creditMutationLimiter, async (req, res, next) => {
    try {
      const rawTitle = req.body?.title;
      if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
        throw new AppError('A title is required', 400, 'audit_request_title_required');
      }
      if (rawTitle.length > 200) {
        throw new AppError('The title is too long', 400, 'audit_request_title_too_long');
      }
      const title = sanitizeText(rawTitle, 200);
      if (!title) throw new AppError('A title is required', 400, 'audit_request_title_required');
      const auditType = String(req.body?.auditType || req.body?.audit_type || '');
      if (!AUDIT_TYPES.has(auditType)) {
        throw new AppError('Unsupported audit type', 400, 'audit_request_type_invalid');
      }
      const rawScope = req.body?.scope;
      if (typeof rawScope !== 'string' || !rawScope.trim()) {
        throw new AppError('A scope is required', 400, 'audit_request_scope_required');
      }
      if (rawScope.length > 2000) {
        throw new AppError('The scope is too long', 400, 'audit_request_scope_too_long');
      }
      const scope = sanitizeText(rawScope, 2000);
      if (!scope) throw new AppError('A scope is required', 400, 'audit_request_scope_required');
      let auditorEmail = null;
      const rawAuditorEmail = req.body?.auditorEmail ?? req.body?.auditor_email;
      if (rawAuditorEmail !== undefined && rawAuditorEmail !== null && String(rawAuditorEmail).trim() !== '') {
        if (typeof rawAuditorEmail !== 'string' || !EMAIL_RE.test(rawAuditorEmail.trim())) {
          throw new AppError('Invalid auditor email', 400, 'audit_request_auditor_email_invalid');
        }
        auditorEmail = rawAuditorEmail.trim().toLowerCase();
      }
      const { rows: [row] } = await pool.query(
        `INSERT INTO audit_requests (requested_by, title, audit_type, scope, auditor_email)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [req.user.id, title, auditType, scope, auditorEmail],
      );
      // After the insert commits, never inside it: tell the bookkeeper /
      // admin queue, best-effort. A notification failure never fails the
      // intake itself — the request is already stored and queued.
      try {
        await notifyStaff({
          type: 'audit_request_received',
          title: 'New audit request',
          body: `A new ${auditType} audit request was filed: ${title}`,
          data: { auditRequestId: row.id, title, auditType },
          action_url: '/admin/super/oxsteed-credit/audit-requests',
          idempotencyKeyPrefix: `audit-request-${row.id}`,
        });
      } catch (error) {
        logger.warn('Failed to notify staff of audit request', { auditRequestId: row.id, error: error.message });
      }
      res.status(201).json({ request: requestView(row, { ...countsView({}), access: 'owner' }) });
    } catch (error) { next(error); }
  });

  // GET / — the queue. Admins see all requests; anyone else sees their own
  // plus requests where they hold an active grant. A stranger sees an
  // empty list.
  router.get('/', async (req, res, next) => {
    try {
      const { page, pageSize } = parsePage(req);
      const offset = (page - 1) * pageSize;
      const admin = isAdminRole(req.user.role);
      const where = admin
        ? ''
        : `WHERE r.requested_by = $1 OR EXISTS (
             SELECT 1 FROM audit_request_shares s
              WHERE s.audit_request_id = r.id AND s.auditor_user_id = $1
                AND s.revoked_at IS NULL AND s.expires_at > NOW())`;
      const params = admin ? [] : [req.user.id];
      const { rows: [totalRow] } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM audit_requests r ${where}`, params);
      const { rows } = await pool.query(
        `SELECT r.*, ${REQUEST_COUNTS},
                CASE WHEN r.requested_by = $${params.length + 1} THEN FALSE
                     ELSE EXISTS (
                       SELECT 1 FROM audit_request_shares s
                        WHERE s.audit_request_id = r.id AND s.auditor_user_id = $${params.length + 1}
                          AND s.revoked_at IS NULL AND s.expires_at > NOW())
                END AS via_grant
           FROM audit_requests r ${where}
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT $${params.length + 2} OFFSET $${params.length + 3}`,
        [...params, req.user.id, pageSize, offset],
      );
      res.json({
        requests: rows.map((row) => requestView(row, {
          ...countsView(row),
          access: admin ? 'admin' : (String(row.requested_by) === String(req.user.id) ? 'owner' : 'auditor'),
          viaGrant: Boolean(row.via_grant),
        })),
        page,
        pageSize,
        total: totalRow.total,
      });
    } catch (error) { next(error); }
  });

  // GET /:id — detail. Same standing as the list; a stranger gets 404.
  router.get('/:id', async (req, res, next) => {
    try {
      const { request, access } = await loadRequestForViewer(req.params.id, req.user);
      res.json({ request: requestView(request, { ...countsView(request), access }) });
    } catch (error) { next(error); }
  });

  // PATCH /:id/status — open -> in_review -> closed; closed is terminal.
  // Owner or admin only.
  router.patch('/:id/status', creditMutationLimiter, async (req, res, next) => {
    try {
      const request = await loadRequestForOwnerOrAdmin(req.params.id, req.user);
      const status = String(req.body?.status || '');
      if (!REQUEST_STATUSES.has(status)) {
        throw new AppError('Unsupported status', 400, 'audit_request_status_invalid');
      }
      const allowed = { open: ['in_review', 'closed'], in_review: ['closed'], closed: [] }[request.status];
      if (!allowed.includes(status)) {
        throw new AppError(`Cannot move an audit request from ${request.status} to ${status}`, 409, 'audit_request_status_transition');
      }
      const { rows: [row] } = await pool.query(
        `UPDATE audit_requests SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [request.id, status],
      );
      res.json({ request: requestView(row, { ...countsView(request) }) });
    } catch (error) { next(error); }
  });

  // ── 717: approved evidence selection ───────────────────────────────
  // Evidence is the requester's own statement documents: the document must
  // exist in credit_statement_documents with customer_id = requested_by.
  // Unknown or someone else's documents are 404, same as the archive.
  async function loadOwnedDocument(request, documentId) {
    if (!UUID_RE.test(String(documentId || ''))) {
      throw new AppError('Statement document not found', 404, 'statement_document_not_found');
    }
    const { rows: [document] } = await pool.query(
      `SELECT id, customer_id, product FROM credit_statement_documents WHERE id = $1`,
      [String(documentId).toLowerCase()],
    );
    if (!document || String(document.customer_id) !== String(request.requested_by)) {
      throw new AppError('Statement document not found', 404, 'statement_document_not_found');
    }
    return document;
  }

  // POST /:id/evidence — propose a document (owner/admin). Re-proposing
  // the same document replays the existing row instead of duplicating it.
  router.post('/:id/evidence', creditMutationLimiter, async (req, res, next) => {
    try {
      const request = await loadRequestForOwnerOrAdmin(req.params.id, req.user);
      await loadOwnedDocument(request, req.body?.documentId ?? req.body?.document_id);
      const documentId = String(req.body.documentId || req.body.document_id).toLowerCase();
      const { rows } = await pool.query(
        `INSERT INTO audit_request_evidence (audit_request_id, document_id, proposed_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (audit_request_id, document_id) DO NOTHING
         RETURNING *`,
        [request.id, documentId, req.user.id],
      );
      if (rows[0]) return res.status(201).json({ evidence: evidenceView(rows[0]), replayed: false });
      const { rows: [existing] } = await pool.query(
        `SELECT * FROM audit_request_evidence WHERE audit_request_id = $1 AND document_id = $2`,
        [request.id, documentId],
      );
      res.json({ evidence: evidenceView(existing), replayed: true });
    } catch (error) { next(error); }
  });

  // GET /:id/evidence — owner/admin see every row; an auditor under an
  // active grant sees approved evidence only (the audit-scoped selection).
  router.get('/:id/evidence', async (req, res, next) => {
    try {
      const { request, access } = await loadRequestForViewer(req.params.id, req.user);
      const { rows } = await pool.query(
        `SELECT * FROM audit_request_evidence
          WHERE audit_request_id = $1 ${access === 'auditor' ? `AND status = 'approved'` : ''}
          ORDER BY created_at ASC, id ASC`,
        [request.id],
      );
      res.json({ evidence: rows.map(evidenceView), access });
    } catch (error) { next(error); }
  });

  async function decideEvidence(req, res, next, status) {
    try {
      const request = await loadRequestForOwnerOrAdmin(req.params.id, req.user);
      if (!UUID_RE.test(String(req.params.evidenceId || ''))) {
        throw new AppError('Evidence not found', 404, 'audit_evidence_not_found');
      }
      const { rows: [row] } = await pool.query(
        `UPDATE audit_request_evidence
            SET status = $3, decided_by = $4, decided_at = NOW()
          WHERE id = $1 AND audit_request_id = $2 AND status = 'proposed'
          RETURNING *`,
        [String(req.params.evidenceId).toLowerCase(), request.id, status, req.user.id],
      );
      if (!row) {
        const { rows: [existing] } = await pool.query(
          `SELECT id FROM audit_request_evidence WHERE id = $1 AND audit_request_id = $2`,
          [String(req.params.evidenceId).toLowerCase(), request.id],
        );
        if (!existing) throw new AppError('Evidence not found', 404, 'audit_evidence_not_found');
      throw new AppError('Evidence is already decided', 409, 'audit_evidence_already_decided');
      }
      res.json({ evidence: evidenceView(row) });
    } catch (error) { next(error); }
  }

  // POST /:id/evidence/:evidenceId/approve — mark evidence approved-for-audit.
  router.post('/:id/evidence/:evidenceId/approve', creditMutationLimiter, (req, res, next) => decideEvidence(req, res, next, 'approved'));
  // POST /:id/evidence/:evidenceId/reject — mark evidence rejected.
  router.post('/:id/evidence/:evidenceId/reject', creditMutationLimiter, (req, res, next) => decideEvidence(req, res, next, 'rejected'));

  // ── 718: time-limited evidence share ───────────────────────────────
  // POST /:id/shares — grant an auditor time-limited access (owner/admin).
  // The grant IS the D-410 auditor-share grant: who the auditor is, what
  // evidence (the request's approved set), expiry, revocation.
  router.post('/:id/shares', creditMutationLimiter, async (req, res, next) => {
    try {
      const request = await loadRequestForOwnerOrAdmin(req.params.id, req.user);
      const auditorUserId = req.body?.auditorUserId ?? req.body?.auditor_user_id;
      if (!UUID_RE.test(String(auditorUserId || ''))) {
        throw new AppError('A valid auditor is required', 400, 'audit_share_auditor_invalid');
      }
      if (String(auditorUserId).toLowerCase() === String(request.requested_by)) {
        throw new AppError('The requester cannot be their own auditor', 400, 'audit_share_auditor_self');
      }
      const { rows: [auditor] } = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
        [String(auditorUserId).toLowerCase()],
      );
      if (!auditor) throw new AppError('Auditor not found', 404, 'audit_share_auditor_not_found');
      const rawTtl = req.body?.expiresInSeconds ?? req.body?.expires_in_seconds;
      const ttl = rawTtl === undefined || rawTtl === null ? GRANT_TTL_DEFAULT_SECONDS : Number(rawTtl);
      if (!Number.isSafeInteger(ttl) || ttl < GRANT_TTL_MIN_SECONDS || ttl > GRANT_TTL_MAX_SECONDS) {
        throw new AppError(
          `Share expiry must be between ${GRANT_TTL_MIN_SECONDS} and ${GRANT_TTL_MAX_SECONDS} seconds`,
          400, 'audit_share_ttl_invalid',
        );
      }
      let row;
      try {
        ({ rows: [row] } = await pool.query(
          `INSERT INTO audit_request_shares (audit_request_id, auditor_user_id, created_by, expires_at)
           VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval)
           RETURNING *`,
          [request.id, String(auditorUserId).toLowerCase(), req.user.id, String(ttl)],
        ));
      } catch (error) {
        if (error.code === '23505') {
          throw new AppError('This auditor already holds an active share for this request', 409, 'audit_share_active_exists');
        }
        throw error;
      }
      res.status(201).json({ share: shareView(row) });
    } catch (error) { next(error); }
  });

  // GET /:id/shares — owner/admin only (an auditor must not enumerate
  // other auditors' grants).
  router.get('/:id/shares', async (req, res, next) => {
    try {
      const request = await loadRequestForOwnerOrAdmin(req.params.id, req.user);
      const { rows } = await pool.query(
        `SELECT * FROM audit_request_shares WHERE audit_request_id = $1 ORDER BY created_at DESC, id DESC`,
        [request.id],
      );
      res.json({ shares: rows.map(shareView) });
    } catch (error) { next(error); }
  });

  // POST /:id/shares/:shareId/revoke — revocation closes the grant
  // immediately; the auditor's next call re-reads the grant and fails.
  router.post('/:id/shares/:shareId/revoke', creditMutationLimiter, async (req, res, next) => {
    try {
      const request = await loadRequestForOwnerOrAdmin(req.params.id, req.user);
      if (!UUID_RE.test(String(req.params.shareId || ''))) {
        throw new AppError('Share not found', 404, 'audit_share_not_found');
      }
      const { rows: [row] } = await pool.query(
        `UPDATE audit_request_shares
            SET revoked_at = NOW(), revoked_by = $3
          WHERE id = $1 AND audit_request_id = $2 AND revoked_at IS NULL
          RETURNING *`,
        [String(req.params.shareId).toLowerCase(), request.id, req.user.id],
      );
      if (!row) {
        const { rows: [existing] } = await pool.query(
          `SELECT id FROM audit_request_shares WHERE id = $1 AND audit_request_id = $2`,
          [String(req.params.shareId).toLowerCase(), request.id],
        );
        if (!existing) throw new AppError('Share not found', 404, 'audit_share_not_found');
        throw new AppError('Share is already revoked', 409, 'audit_share_already_revoked');
      }
      res.json({ share: shareView(row) });
    } catch (error) { next(error); }
  });

  // GET /:id/evidence/:documentId/link — mint a fresh signed link for an
  // approved document. The caller must be the owner, an admin, or an
  // auditor holding an active grant; the document must be approved
  // evidence on this request; only a ready original artifact is served.
  // The link TTL is the archive primitive's 60..3600s, independent of the
  // grant expiry — a link minted after the grant expires or is revoked
  // is refused here, and the signed URL itself still expires on its own.
  router.get('/:id/evidence/:documentId/link', async (req, res, next) => {
    try {
      const { request } = await loadRequestForViewer(req.params.id, req.user);
      if (!UUID_RE.test(String(req.params.documentId || ''))) {
        throw new AppError('Statement document not found', 404, 'statement_document_not_found');
      }
      const documentId = String(req.params.documentId).toLowerCase();
      const { rows: [evidence] } = await pool.query(
        `SELECT id FROM audit_request_evidence
          WHERE audit_request_id = $1 AND document_id = $2 AND status = 'approved'`,
        [request.id, documentId],
      );
      if (!evidence) {
        throw new AppError('Approved evidence not found', 404, 'audit_evidence_not_found');
      }
      const { rows: [artifact] } = await pool.query(
        `SELECT id FROM statement_artifacts
          WHERE document_id = $1 AND kind = 'original' AND state = 'ready'
          ORDER BY created_at DESC, id DESC LIMIT 1`,
        [documentId],
      );
      if (!artifact) {
        throw new AppError(
          'This statement file is not ready for download yet.',
          409, 'statement_artifact_not_ready',
        );
      }
      const requestedTtl = req.query.ttlSeconds === undefined ? undefined : Number(req.query.ttlSeconds);
      const signed = await createSignedUrl({
        artifactId: artifact.id,
        actor: req.user,
        ...(requestedTtl === undefined ? {} : { ttlSeconds: requestedTtl }),
        storage,
      });
      res.json({
        url: signed.url,
        ttlSeconds: signed.ttlSeconds,
        expiresAt: signed.expiresAt,
        documentId,
        note: `This download link expires at ${signed.expiresAt} and must not be stored or shared.`,
      });
    } catch (error) { next(error); }
  });

  // ── 719: reviewer follow-up ────────────────────────────────────────
  // A message thread on the request itself. Participants: the requester,
  // admins, and auditors holding an active grant. Mirrors the dispute
  // message pattern: idempotency key, 5000-char cap, author role recorded.
  router.get('/:id/messages', async (req, res, next) => {
    try {
      const { request } = await loadRequestForViewer(req.params.id, req.user);
      const { rows } = await pool.query(
        `SELECT * FROM audit_request_messages
          WHERE audit_request_id = $1 ORDER BY created_at ASC, id ASC`,
        [request.id],
      );
      res.json({ messages: rows.map(messageView) });
    } catch (error) { next(error); }
  });

  router.post('/:id/messages', creditMutationLimiter, async (req, res, next) => {
    try {
      const { request } = await loadRequestForViewer(req.params.id, req.user);
      const rawMessage = req.body?.message;
      if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
        throw new AppError('A message is required', 400, 'audit_message_required');
      }
      if (rawMessage.length > MESSAGE_MAX_LENGTH) {
        throw new AppError('The message is too long', 400, 'audit_message_too_long');
      }
      const message = sanitizeText(rawMessage, MESSAGE_MAX_LENGTH);
      if (!message) throw new AppError('A message is required', 400, 'audit_message_required');
      const rawKey = req.body?.idempotencyKey ?? req.body?.idempotency_key;
      if (typeof rawKey !== 'string' || !UUID_RE.test(rawKey.trim())) {
        throw new AppError('A valid idempotency key is required', 400, 'audit_message_idempotency_key_invalid');
      }
      const idempotencyKey = rawKey.trim().toLowerCase();
      const authorRole = req.user.role === 'super_admin' ? 'admin' : String(req.user.role);
      const { rows } = await pool.query(
        `INSERT INTO audit_request_messages (audit_request_id, author_id, author_role, message, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (audit_request_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [request.id, req.user.id, authorRole, message, idempotencyKey],
      );
      if (rows[0]) return res.status(201).json({ message: messageView(rows[0]), replayed: false });
      const { rows: [existing] } = await pool.query(
        `SELECT * FROM audit_request_messages WHERE audit_request_id = $1 AND idempotency_key = $2`,
        [request.id, idempotencyKey],
      );
      if (!existing
        || String(existing.author_id) !== String(req.user.id)
        || existing.message !== message) {
        throw new AppError('Idempotency key was already used for different details', 409, 'audit_message_idempotency_conflict');
      }
      res.json({ message: messageView(existing), replayed: true });
    } catch (error) { next(error); }
  });

  // ── 720: evidence package receipt ──────────────────────────────────
  // POST /:id/receipts — the reviewing auditor acknowledges receipt of
  // the approved-evidence package. Auditor with an active grant ONLY;
  // the package is a snapshot of the approved document ids at receipt
  // time. Append-only: every receipt is a separate acknowledgment event.
  router.post('/:id/receipts', creditMutationLimiter, async (req, res, next) => {
    try {
      const { request, access } = await loadRequestForViewer(req.params.id, req.user);
      if (access !== 'auditor') {
        throw new AppError('Only the reviewing auditor can record receipt', 403, 'audit_receipt_forbidden');
      }
      let note = null;
      const rawNote = req.body?.note;
      if (rawNote !== undefined && rawNote !== null && String(rawNote).trim() !== '') {
        if (typeof rawNote !== 'string') {
          throw new AppError('Invalid note', 400, 'audit_receipt_note_invalid');
        }
        if (rawNote.length > NOTE_MAX_LENGTH) {
          throw new AppError('The note is too long', 400, 'audit_receipt_note_too_long');
        }
        note = sanitizeText(rawNote, NOTE_MAX_LENGTH) || null;
      }
      const { rows: [approved] } = await pool.query(
        `SELECT COALESCE(json_agg(document_id ORDER BY created_at ASC, id ASC), '[]'::json) AS package
           FROM audit_request_evidence WHERE audit_request_id = $1 AND status = 'approved'`,
        [request.id],
      );
      const { rows: [row] } = await pool.query(
        `INSERT INTO audit_request_receipts (audit_request_id, received_by, package, note)
         VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
        [request.id, req.user.id, JSON.stringify(approved.package), note],
      );
      res.status(201).json({ receipt: receiptView(row) });
    } catch (error) { next(error); }
  });

  // GET /:id/receipts — requester, admins, and auditors with an active
  // grant can read the receipt record.
  router.get('/:id/receipts', async (req, res, next) => {
    try {
      const { request } = await loadRequestForViewer(req.params.id, req.user);
      const { rows } = await pool.query(
        `SELECT * FROM audit_request_receipts WHERE audit_request_id = $1 ORDER BY created_at DESC, id DESC`,
        [request.id],
      );
      res.json({ receipts: rows.map(receiptView) });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = createAuditRequestsRouter;
module.exports.createAuditRequestsRouter = createAuditRequestsRouter;
module.exports.GRANT_TTL_DEFAULT_SECONDS = GRANT_TTL_DEFAULT_SECONDS;
module.exports.GRANT_TTL_MIN_SECONDS = GRANT_TTL_MIN_SECONDS;
module.exports.GRANT_TTL_MAX_SECONDS = GRANT_TTL_MAX_SECONDS;
