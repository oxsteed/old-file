/**
 * routes/learn.js — Learn Mode API
 * Mounted at /api/learn and /api/admin/learn
 */

const express  = require('express');
const router   = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin }  = require('../middleware/adminAuth');
const {
  getCompletions,
  recordCompletion,
  submitGuide,
  getMySubmissions,
  adminListSubmissions,
  adminGetSubmission,
  adminReviewSubmission,
} = require('../controllers/learnController');

// ── Authenticated user routes ──────────────────────────────────
router.get('/completions',           authenticate, getCompletions);
router.post('/completions',          authenticate, recordCompletion);
router.post('/submissions',          authenticate, submitGuide);
router.get('/submissions/mine',      authenticate, getMySubmissions);

// ── Admin routes ───────────────────────────────────────────────
router.get('/admin/submissions',         authenticate, requireAdmin, adminListSubmissions);
router.get('/admin/submissions/:id',     authenticate, requireAdmin, adminGetSubmission);
router.patch('/admin/submissions/:id',   authenticate, requireAdmin, adminReviewSubmission);

module.exports = router;
