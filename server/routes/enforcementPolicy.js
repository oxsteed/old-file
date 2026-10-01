/**
 * enforcementPolicy.js
 * Routes for enforcement policy transparency and appeals
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const ctrl = require('../controllers/enforcementPolicyController');

// ── Public: enforcement policy ──────────────────────────────────
router.get('/policy', ctrl.getEnforcementPolicy);

// ── Authenticated: user status and appeals ──────────────────────
router.get('/my-status', requireAuth, ctrl.getMyEnforcementStatus);
router.post('/appeals', requireAuth, ctrl.submitAppeal);
router.get('/my-appeals', requireAuth, ctrl.getMyAppeals);

// ── Admin: review appeals ───────────────────────────────────────
router.put('/admin/appeals/:appealId/review', requireAuth, requireAdmin, requirePermission('manage_disputes'), ctrl.reviewAppeal);

module.exports = router;
