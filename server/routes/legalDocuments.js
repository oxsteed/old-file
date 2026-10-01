// Legal Documents Routes
// Acceptance recording + history for user-facing legal flows

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');
const legalController = require('../controllers/legalDocumentsController');
const ccpaController = require('../controllers/ccpaController');
const db = require('../db');

const legalDrafts = new Map();
const TERMS_DOCUMENT_TYPE = 'terms_of_service';

function termsSectionHtml(blocks = []) {
  return blocks.map((block) => {
    const text = block.text || '';
    if (block.type === 'h2') return `<h2>${text}</h2>`;
    if (block.type === 'note') return `<p><strong>${block.strong || ''}</strong>${text}</p>`;
    if (block.type === 'li') return `<li>${text}</li>`;
    return `<p>${text}</p>`;
  }).join('\n');
}

function loadTermsDocument(req) {
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

function adminDocumentFromDraft(id, draft) {
  return {
    id,
    title: draft.title,
    category: draft.category,
    description: draft.description || '',
    version: draft.version || 1,
    status: draft.status || 'draft',
    updatedAt: draft.updatedAt,
    changeSummary: draft.changeSummary || '',
  };
}

function getAdminDocuments() {
  if (!legalDrafts.has(TERMS_DOCUMENT_TYPE)) {
    legalDrafts.set(TERMS_DOCUMENT_TYPE, {
      title: 'Terms of Service',
      category: TERMS_DOCUMENT_TYPE,
      description: 'Current public OxSteed terms.',
      version: 1,
      status: 'live',
      sections: loadTermsDocument({ query: {} }).sections,
      updatedAt: '2026-06-02T00:00:00.000Z',
    });
  }
  return Array.from(legalDrafts.entries()).map(([id, draft]) => adminDocumentFromDraft(id, draft));
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

// ── User-facing routes ────────────────────────────────────────────────────────

router.get('/documents/:documentType',
  generalLimiter,
  (req, res, next) => {
    if (req.baseUrl.includes('/admin/legal')) return next();
    if (req.params.documentType !== TERMS_DOCUMENT_TYPE) {
      return res.status(404).json({ error: 'Document not found' });
    }
    return res.json(loadTermsDocument(req));
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
  (req, res) => {
    const status = req.query.status;
    const documents = getAdminDocuments().filter((doc) => !status || doc.status === status);
    return res.json({ documents });
  }
);

router.post('/documents',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  (req, res) => {
    const id = `${req.body.category || 'document'}_${Date.now()}`;
    const now = new Date().toISOString();
    const sections = String(req.body.content || '')
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((content, index) => ({ key: `section_${index + 1}`, title: `Section ${index + 1}`, content }));
    legalDrafts.set(id, {
      title: req.body.title || 'Untitled legal document',
      category: req.body.category || 'terms_of_service',
      description: req.body.description || '',
      version: 1,
      status: 'draft',
      changeSummary: req.body.changeSummary || '',
      sections,
      updatedAt: now,
    });
    return res.status(201).json({ document: adminDocumentFromDraft(id, legalDrafts.get(id)) });
  }
);

router.get('/documents/:id',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  (req, res) => {
    getAdminDocuments();
    const draft = legalDrafts.get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Document not found' });
    return res.json({ document: adminDocumentFromDraft(req.params.id, draft), sections: draft.sections || [] });
  }
);

router.put('/documents/:id',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  (req, res) => {
    getAdminDocuments();
    const draft = legalDrafts.get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Document not found' });
    const now = new Date().toISOString();
    const sections = req.body.content
      ? String(req.body.content).split(/\n{2,}/).filter(Boolean).map((content, index) => ({
          key: `section_${index + 1}`,
          title: `Section ${index + 1}`,
          content,
        }))
      : draft.sections;
    const updated = {
      ...draft,
      title: req.body.title ?? draft.title,
      description: req.body.description ?? draft.description,
      changeSummary: req.body.changeSummary ?? draft.changeSummary,
      sections,
      updatedAt: now,
    };
    legalDrafts.set(req.params.id, updated);
    return res.json({ document: adminDocumentFromDraft(req.params.id, updated), sections: updated.sections || [] });
  }
);

router.post('/documents/:id/request-approval',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  (req, res) => {
    getAdminDocuments();
    const draft = legalDrafts.get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Document not found' });
    draft.status = 'pending_review';
    draft.changeSummary = req.body.changeSummary || draft.changeSummary || '';
    draft.updatedAt = new Date().toISOString();
    return res.json({ document: adminDocumentFromDraft(req.params.id, draft) });
  }
);

router.post('/documents/:id/approve',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  (req, res) => {
    getAdminDocuments();
    const draft = legalDrafts.get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Document not found' });
    draft.status = req.body.scheduledPublishDate ? 'scheduled' : 'live';
    draft.updatedAt = new Date().toISOString();
    return res.json({ document: adminDocumentFromDraft(req.params.id, draft) });
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

router.get('/ccpa-requests',
  authenticate,
  requireAdmin, requirePermission('manage_operations'),
  (req, res, next) => {
    req.query.requestType = req.query.requestType || req.query.type;
    return ccpaController.listCCPARequests(req, res, next);
  }
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
