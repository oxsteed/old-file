// Legal Documents Routes
// Acceptance recording + history for user-facing legal flows

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');
const legalController = require('../controllers/legalDocumentsController');

// ── User-facing routes ────────────────────────────────────────────────────────

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

// GET  /api/legal/admin/acceptances
router.get('/admin/acceptances',
  authenticate,
  requireAdmin,
  legalController.listAllAcceptances
);

// GET  /api/legal/admin/compliance
router.get('/admin/compliance',
  authenticate,
  requireAdmin,
  legalController.getComplianceMetrics
);

// GET  /api/legal/admin/audit-log
router.get('/admin/audit-log',
  authenticate,
  requireAdmin,
  legalController.getAuditLog
);

// DELETE /api/legal/admin/acceptances/:id
router.delete('/admin/acceptances/:id',
  authenticate,
  requireAdmin,
  legalController.revokeAcceptance
);

module.exports = router;
