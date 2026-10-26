// Legal Documents Routes
// Acceptance recording + history for user-facing legal flows

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');
const legalController = require('../controllers/legalDocumentsController');
const ccpaController = require('../controllers/ccpaController');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');
const db = require('../db');

const TERMS_DOCUMENT_TYPE = 'terms_of_service';

// User-facing CCPA/CPRA intake. Guests may submit an opt-out request by
// email; authenticated users are bound to their account by the controller.
router.post('/ccpa-requests', strictLimiter, ccpaController.createCCPARequest);

// T56-F04: legal drafts are persisted in the database, not a process-local
// Map, so restarts and multi-node deployments share the same state.

async function getDraft(id) {
  const { rows } = await db.query('SELECT * FROM legal_document_drafts WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listDrafts() {
  // Seed the terms document from the bundled locale content if absent.
  const existing = await getDraft(TERMS_DOCUMENT_TYPE);
  if (!existing) {
    const sections = loadBundledTermsDocument({ query: {} }).sections;
    await db.query(
      `INSERT INTO legal_document_drafts (id, title, category, description, version, status, sections, updated_at)
       VALUES ($1, $2, $3, $4, 1, 'live', $5::jsonb, '2026-06-02T00:00:00.000Z')
       ON CONFLICT (id) DO NOTHING`,
      [TERMS_DOCUMENT_TYPE, 'Terms of Service', TERMS_DOCUMENT_TYPE, 'Current public OxSteed terms.', JSON.stringify(sections)]
    );
  }
  const { rows } = await db.query('SELECT * FROM legal_document_drafts ORDER BY updated_at DESC');
  return rows;
}

function adminDocumentFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description || '',
    version: row.version,
    status: row.status,
    updatedAt: row.updated_at,
    changeSummary: row.change_summary || '',
    // ADM-036: surface the maker/checker chain so the UI can show who
    // requested approval and who published, and warn a maker away from
    // approving their own document.
    approvalRequestedBy: row.approval_requested_by || null,
    approvalRequestedAt: row.approval_requested_at || null,
    approvedBy: row.approved_by || null,
    approvedAt: row.approved_at || null,
    updatedBy: row.updated_by || null,
  };
}

function termsSectionHtml(blocks = []) {
  return blocks.map((block) => {
    const text = block.text || '';
    if (block.type === 'h2') return `<h2>${text}</h2>`;
    if (block.type === 'note') return `<p><strong>${block.strong || ''}</strong>${text}</p>`;
    if (block.type === 'li') return `<li>${text}</li>`;
    return `<p>${text}</p>`;
  }).join('\n');
}

function loadBundledTermsDocument(req) {
  const language = String(req.query.language || 'en').slice(0, 2);
  let content;
  try {
    content = require(`../client/src/locales/terms/${language}.content.json`);
  } catch {
    content = require('../../client/src/locales/terms/en.content.json');
  }
  const sections = Object.entries(content.sections || {}).map(([key, section]) => {
    const titleBlock = (section.blocks || []).find((block) => block.type === 'h2');
    return {
      key,
      title: titleBlock?.text || `Section ${key}`,
      content: termsSectionHtml(section.blocks),
      isCritical: ['2', '5', '8', '12'].includes(key),
    };
  });
  return {
    document: {
      id: TERMS_DOCUMENT_TYPE,
      title: 'Terms of Service',
      category: TERMS_DOCUMENT_TYPE,
      version: 1,
      status: 'live',
      lastUpdated: '2026-06-02T00:00:00.000Z',
      userAccepted: false,
    },
    sections,
  };
}

async function loadPublishedTermsDocument(req) {
  const bundled = loadBundledTermsDocument(req);
  const draft = await getDraft(TERMS_DOCUMENT_TYPE);
  if (!draft || draft.status !== 'live') return bundled;
  const sections = (Array.isArray(draft.sections) ? draft.sections : []).map((section, index) => ({
    key: section.key || `section_${index + 1}`,
    title: section.title || `Section ${index + 1}`,
    content: section.content || termsSectionHtml(section.blocks || []),
    isCritical: ['2', '5', '8', '12'].includes(String(section.key || index + 1)),
  }));
  return {
    document: {
      ...bundled.document,
      title: draft.title || bundled.document.title,
      category: draft.category || bundled.document.category,
      version: draft.version,
      status: draft.status,
      lastUpdated: draft.updated_at,
      userAccepted: false,
    },
    sections: sections.length ? sections : bundled.sections,
  };
}


function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

// ── User-facing routes ────────────────────────────────────────────────────────

router.get('/documents/:documentType',
  generalLimiter,
  async (req, res, next) => {
    if (req.baseUrl.includes('/admin/legal')) return next();
    if (req.params.documentType !== TERMS_DOCUMENT_TYPE) {
      return res.status(404).json({ error: 'Document not found' });
    }
    try {
      return res.json(await loadPublishedTermsDocument(req));
    } catch (err) {
      logger.error('Published legal document unavailable', { error: err.message, documentType: req.params.documentType });
      return res.status(503).json({ error: 'Legal document temporarily unavailable', retryable: true });
    }
  }
);

router.get('/documents/:documentType/history',
  authenticate,
  generalLimiter,
  (req, res, next) => {
    if (req.baseUrl.includes('/admin/legal')) return next();
    req.params.documentType = req.params.documentType === TERMS_DOCUMENT_TYPE
      ? TERMS_DOCUMENT_TYPE
      : req.params.documentType;
    return legalController.getAcceptanceHistory(req, res, next);
  }
);

router.post('/documents/:documentType/accept',
  authenticate,
  strictLimiter,
  (req, res, next) => {
    if (req.baseUrl.includes('/admin/legal')) return next();
    req.params.documentType = req.params.documentType === TERMS_DOCUMENT_TYPE
      ? TERMS_DOCUMENT_TYPE
      : req.params.documentType;
    req.body = { ...req.body, versionNumber: req.body.versionNumber || 1 };
    return legalController.recordAcceptance(req, res, next);
  }
);

router.get('/documents',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  async (req, res) => {
    const { status } = req.query;
    const rows = await listDrafts();
    const documents = rows.map(adminDocumentFromRow).filter((doc) => !status || doc.status === status);
    return res.json({ documents });
  }
);

router.post('/documents',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  async (req, res) => {
    const id = `${req.body.category || 'document'}_${Date.now()}`;
    const sections = String(req.body.content || '')
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((content, index) => ({ key: `section_${index + 1}`, title: `Section ${index + 1}`, content }));
    const { rows } = await db.query(
      `INSERT INTO legal_document_drafts (id, title, category, description, version, status, sections, change_summary, updated_by)
       VALUES ($1, $2, $3, $4, 1, 'draft', $5::jsonb, $6, $7)
       RETURNING *`,
      [id, req.body.title || 'Untitled legal document', req.body.category || 'terms_of_service',
       req.body.description || '', JSON.stringify(sections), req.body.changeSummary || '', req.user.id]
    );
    // ADM-036: audit the document lifecycle in admin_audit_log.
    await logAdminAction({
      adminId: req.user.id,
      action: 'legal_document_create',
      targetType: 'legal_document',
      targetKey: id,
      description: `Created legal document draft "${req.body.title || 'Untitled legal document'}"`,
      after: { status: 'draft', version: 1 },
      req,
    });
    return res.status(201).json({ document: adminDocumentFromRow(rows[0]) });
  }
);

router.get('/documents/:id',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  async (req, res) => {
    const draft = await getDraft(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Document not found' });
    return res.json({ document: adminDocumentFromRow(draft), sections: draft.sections || [] });
  }
);

router.put('/documents/:id',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  async (req, res) => {
    const draft = await getDraft(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Document not found' });
    const sections = req.body.content
      ? String(req.body.content).split(/\n{2,}/).filter(Boolean).map((content, index) => ({
          key: `section_${index + 1}`,
          title: `Section ${index + 1}`,
          content,
        }))
      : draft.sections;
    const { rows } = await db.query(
      `UPDATE legal_document_drafts
          SET title = $2, description = $3, change_summary = $4, sections = $5::jsonb,
              updated_at = NOW(), updated_by = $6
        WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.title ?? draft.title, req.body.description ?? draft.description,
       req.body.changeSummary ?? draft.change_summary, JSON.stringify(sections), req.user.id]
    );
    // ADM-036: audit the document lifecycle in admin_audit_log.
    await logAdminAction({
      adminId: req.user.id,
      action: 'legal_document_edit',
      targetType: 'legal_document',
      targetKey: req.params.id,
      description: `Edited legal document "${rows[0].title}" (v${rows[0].version}, ${rows[0].status})`,
      before: { title: draft.title, description: draft.description, status: draft.status },
      after: { title: rows[0].title, description: rows[0].description, status: rows[0].status },
      req,
    });
    return res.json({ document: adminDocumentFromRow(rows[0]), sections: rows[0].sections || [] });
  }
);

router.post('/documents/:id/request-approval',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  async (req, res) => {
    const draft = await getDraft(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Document not found' });
    const { rows } = await db.query(
      `UPDATE legal_document_drafts
          SET status = 'pending_review', change_summary = $2, updated_at = NOW(), updated_by = $3,
              approval_requested_by = $3, approval_requested_at = NOW(),
              approved_by = NULL, approved_at = NULL
        WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.changeSummary || draft.change_summary || '', req.user.id]
    );
    // ADM-036: audit the document lifecycle in admin_audit_log.
    await logAdminAction({
      adminId: req.user.id,
      action: 'legal_document_request_approval',
      targetType: 'legal_document',
      targetKey: req.params.id,
      description: `Requested approval to publish legal document "${rows[0].title}" (v${rows[0].version})`,
      before: { status: draft.status },
      after: { status: 'pending_review', approval_requested_by: req.user.id },
      req,
    });
    return res.json({ document: adminDocumentFromRow(rows[0]) });
  }
);

router.post('/documents/:id/approve',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  async (req, res) => {
    const draft = await getDraft(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Document not found' });
    // ADM-036: a document can only go live through the review flow — a draft
    // must be submitted for approval first.
    if (draft.status !== 'pending_review') {
      return res.status(409).json({
        error: 'Document must be in pending_review before it can be approved. Submit it for approval first.',
        status: draft.status,
      });
    }
    // ADM-036: separation of duties — the admin who drafted/requested the
    // document (the maker) cannot be the one who publishes it (the checker).
    // Fall back to updated_by for documents requested before migration 866.
    const maker = draft.approval_requested_by || draft.updated_by || null;
    if (maker && maker === req.user.id) {
      return res.status(403).json({
        error: 'Separation of duties: the admin who requested approval cannot also publish the document. Ask a different admin to approve it.',
      });
    }
    const status = req.body.scheduledPublishDate ? 'scheduled' : 'live';
    const { rows } = await db.query(
      `UPDATE legal_document_drafts
          SET status = $2, version = version + 1, updated_at = NOW(), updated_by = $3,
              approved_by = $3, approved_at = NOW()
        WHERE id = $1 RETURNING *`,
      [req.params.id, status, req.user.id]
    );
    // ADM-036: audit the publication in admin_audit_log.
    await logAdminAction({
      adminId: req.user.id,
      action: 'legal_document_publish',
      targetType: 'legal_document',
      targetKey: req.params.id,
      description: `Published legal document "${rows[0].title}" (v${rows[0].version}, ${status}); approved after request by ${maker || 'unknown'}`,
      before: { status: draft.status, version: draft.version },
      after: { status, version: rows[0].version, approved_by: req.user.id },
      req,
    });
    return res.json({ document: adminDocumentFromRow(rows[0]) });
  }
);

// GET  /api/legal/:documentType/history
// e.g. GET /api/legal/account_termination/history
router.get('/:documentType/history',
  authenticate,
  generalLimiter,
  legalController.getAcceptanceHistory
);

// POST /api/legal/:documentType/accept
// e.g. POST /api/legal/account_termination/accept
router.post('/:documentType/accept',
  authenticate,
  strictLimiter,
  legalController.recordAcceptance
);

// GET  /api/legal/my-acceptances  — all accepted docs for current user
router.get('/my-acceptances',
  authenticate,
  generalLimiter,
  legalController.getUserAcceptances
);

// ── Admin routes ──────────────────────────────────────────────────────────────

router.get('/acceptances',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  legalController.listAllAcceptances
);

router.get('/acceptances/export/csv',
  authenticate,
  requireAdmin, requirePermission('export_data'),
  async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT ula.id, ula.document_type, ula.version_number, ula.accepted_at,
                u.email, u.first_name, u.last_name
         FROM user_legal_acceptances ula
         JOIN users u ON u.id = ula.user_id
         WHERE ula.deleted_at IS NULL
         ORDER BY ula.accepted_at DESC
         LIMIT 5000`
      );
      const lines = [
        ['id', 'document_type', 'version_number', 'accepted_at', 'email', 'first_name', 'last_name'].join(','),
        ...rows.map((row) => [
          row.id, row.document_type, row.version_number, row.accepted_at,
          row.email, row.first_name, row.last_name,
        ].map(csvEscape).join(',')),
      ];
      res.type('text/csv').send(lines.join('\n'));
    } catch (err) {
      next(err);
    }
  }
);

router.get('/compliance-metrics',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  legalController.getComplianceMetrics
);

router.get('/audit-log',
  authenticate,
  requireAdmin, requirePermission('view_audit_log'),
  legalController.getAuditLog
);

router.get('/audit-log/export/csv',
  authenticate,
  requireAdmin, requirePermission('export_data'),
  async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT id, action_type, document_type, actor_id, actor_role,
                resource_id, resource_type, status, created_at
         FROM legal_audit_log
         ORDER BY created_at DESC
         LIMIT 5000`
      );
      const lines = [
        ['id', 'action_type', 'document_type', 'actor_id', 'actor_role', 'resource_id', 'resource_type', 'status', 'created_at'].join(','),
        ...rows.map((row) => [
          row.id, row.action_type, row.document_type, row.actor_id, row.actor_role,
          row.resource_id, row.resource_type, row.status, row.created_at,
        ].map(csvEscape).join(',')),
      ];
      res.type('text/csv').send(lines.join('\n'));
    } catch (err) {
      next(err);
    }
  }
);

router.get('/ccpa-erasure-review', authenticate, requireAdmin, requirePermission('manage_operations'), async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const { rows } = await require('../db').query(`SELECT request_id,status,attempts,last_error,created_at,
      COUNT(*) OVER()::int AS total FROM ccpa_erasure_jobs WHERE status='needs_review'
      ORDER BY created_at,request_id LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({ rows, pagination: { limit, offset, total: rows[0]?.total || 0, hasMore: offset + rows.length < Number(rows[0]?.total || 0) } });
  } catch (err) { next(err); }
});

router.get('/ccpa-requests',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  (req, res, next) => {
    req.query.requestType = req.query.requestType || req.query.type;
    return ccpaController.listCCPARequests(req, res, next);
  }
);

// Single-request detail. Authenticated users may read their own requests;
// admins may read any (the handler enforces the split).
router.get('/ccpa-requests/:requestId',
  authenticate,
  ccpaController.getCCPARequest
);

// Bulk completion for the privacy admin queue. Registered before any
// :requestId POST route so '/bulk/mark-completed' is never captured as an id.
router.post('/ccpa-requests/bulk/mark-completed',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  ccpaController.bulkMarkCCPACompleted
);

router.put('/ccpa-requests/:requestId',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  ccpaController.updateCCPARequest
);

router.post('/ccpa-requests/:requestId/send-notification',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  ccpaController.sendCCPANotification
);

router.delete('/acceptances/:id/revoke',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  (req, res, next) => {
    req.params.acceptanceId = req.params.id;
    return legalController.revokeAcceptance(req, res, next);
  }
);

router.post('/acceptances/:id/revoke',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  (req, res, next) => {
    req.params.acceptanceId = req.params.id;
    return legalController.revokeAcceptance(req, res, next);
  }
);

// GET  /api/legal/admin/acceptances
router.get('/admin/acceptances',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  legalController.listAllAcceptances
);

// GET  /api/legal/admin/compliance
router.get('/admin/compliance',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  legalController.getComplianceMetrics
);

// GET  /api/legal/admin/audit-log
router.get('/admin/audit-log',
  authenticate,
  requireAdmin, requirePermission('view_audit_log'),
  legalController.getAuditLog
);

// DELETE /api/legal/admin/acceptances/:id
router.delete('/admin/acceptances/:id',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  legalController.revokeAcceptance
);

module.exports = router;
