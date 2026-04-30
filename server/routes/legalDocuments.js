// Legal Documents Routes
// Public access to legal documents + admin endpoints for management

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const legalController = require('../controllers/legalDocumentsController');

// ────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ────────────────────────────────────────────────────────────

/**
 * GET /api/legal/documents/:category
 * Fetch published legal document
 * Optional: ?language=en (defaults to 'en')
 */
router.get('/documents/:category', rateLimiter, legalController.getLegalDocument);

/**
 * GET /api/legal/documents/:id/history
 * Fetch version history
 */
router.get('/documents/:id/history', rateLimiter, legalController.getDocumentHistory);

/**
 * GET /api/legal/documents/:id/version/:versionNumber
 * Fetch specific version
 */
router.get('/documents/:id/version/:versionNumber', rateLimiter, legalController.getDocumentVersion);

/**
 * POST /api/legal/documents/:id/accept
 * User accepts a document with electronic signature
 */
router.post('/documents/:id/accept', authenticate, rateLimiter, legalController.acceptDocument);

/**
 * GET /api/legal/my-acceptances
 * Fetch user's acceptance history
 */
router.get('/my-acceptances', authenticate, rateLimiter, legalController.getUserAcceptances);

// ────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ────────────────────────────────────────────────────────────

/**
 * GET /api/legal/admin/documents
 * List all legal documents with optional status filter
 * Query: ?status=draft|pending_review|scheduled|live|archived
 */
router.get('/admin/documents', authenticate, requireAdmin, legalController.listLegalDocuments);

/**
 * POST /api/legal/admin/documents
 * Create new legal document
 * Body: { category, title, description, content }
 */
router.post('/admin/documents', authenticate, requireAdmin, legalController.createLegalDocument);

/**
 * PUT /api/legal/admin/documents/:id
 * Update document (saves as draft)
 * Body: { title, description, content, changeSummary }
 */
router.put('/admin/documents/:id', authenticate, requireAdmin, legalController.updateLegalDocument);

/**
 * POST /api/legal/admin/documents/:id/request-approval
 * Submit document for legal review
 * Body: { changeSummary, changedSections }
 */
router.post('/admin/documents/:id/request-approval', authenticate, requireAdmin, legalController.requestApproval);

/**
 * POST /api/legal/admin/documents/:id/approve
 * Approve document for publication
 * Body: { scheduledPublishDate?, reviewComments }
 */
router.post('/admin/documents/:id/approve', authenticate, requireAdmin, legalController.approveDocument);

/**
 * POST /api/legal/admin/documents/:id/publish
 * Publish document immediately
 * Body: { notifyUsers? }
 */
router.post('/admin/documents/:id/publish', authenticate, requireAdmin, legalController.publishDocument);

module.exports = router;
