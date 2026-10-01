/**
 * routes/learn.js — Learn Mode API
 * Mounted at /api/learn and /api/admin/learn
 */

const express  = require('express');
const router   = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission }  = require('../middleware/adminAuth');
const {
  getGuides,
  getGuideStats,
  recordView,
  getCompletions,
  recordCompletion,
  submitGuide,
  getMySubmissions,
  getBadges,
  adminListSubmissions,
  adminGetSubmission,
  adminReviewSubmission,
  // Product link overrides
  getProductLinks,
  adminListProductLinks,
  adminCreateProductLink,
  adminUpdateProductLink,
  adminDeleteProductLink,
} = require('../controllers/learnController');

// ── Public routes (no auth) ────────────────────────────────────
router.get('/guides',                getGuides);
router.get('/stats',                 getGuideStats);
router.post('/views',                recordView);          // auth optional — req.user may be null
// Product link overrides — fetched by the iOS app on every refresh.
// Returns active rows only; fails open (empty array) if table absent.
router.get('/product-links',         getProductLinks);

// ── Authenticated user routes ──────────────────────────────────
router.get('/completions',           authenticate, getCompletions);
router.post('/completions',          authenticate, recordCompletion);
router.get('/badges',                authenticate, getBadges);
router.post('/guides/submit',        authenticate, submitGuide);
router.post('/submissions',          authenticate, submitGuide);
router.get('/submissions/mine',      authenticate, getMySubmissions);

// ── Admin routes ───────────────────────────────────────────────
router.get('/admin/submissions',         authenticate, requireAdmin, requirePermission('moderate_content'), adminListSubmissions);
router.get('/admin/submissions/:id',     authenticate, requireAdmin, requirePermission('moderate_content'), adminGetSubmission);
router.patch('/admin/submissions/:id',   authenticate, requireAdmin, requirePermission('moderate_content'), adminReviewSubmission);

// Product link CRUD — admin only
router.get('/admin/product-links',        authenticate, requireAdmin, requirePermission('moderate_content'), adminListProductLinks);
router.post('/admin/product-links',       authenticate, requireAdmin, requirePermission('moderate_content'), adminCreateProductLink);
router.put('/admin/product-links/:id',    authenticate, requireAdmin, requirePermission('moderate_content'), adminUpdateProductLink);
router.delete('/admin/product-links/:id', authenticate, requireAdmin, requirePermission('moderate_content'), adminDeleteProductLink);

module.exports = router;
