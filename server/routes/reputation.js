/**
 * reputation.js
 * Routes for user reputation scores, enforcement actions, and fee history
 */

const express = require('express');
const router  = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  getUserReputation,
  recalculateReputation,
  getEnforcementActions,
  checkRestrictions,
  getFeeHistory,
  getCustomerReliability
} = require('../controllers/reputationController');

// ── Public: reputation score (shown on profiles) ─────────────────────────────
router.get('/:userId',                  getUserReputation);

// ── Public: customer reliability (helpers see before bidding) ──────────────────
router.get('/customers/:userId/reliability',  getCustomerReliability);

// ── Authenticated: fee history (visible to the user and admins) ──────────────
router.get('/:userId/fee-history',      requireAuth, getFeeHistory);

// ── Admin: recalculate + enforcement ─────────────────────────────────────────
router.post('/:userId/recalculate',     requireAdmin, recalculateReputation);
router.get('/:userId/enforcement',      requireAdmin, getEnforcementActions);
router.get('/:userId/restrictions',     requireAuth,  checkRestrictions);

module.exports = router;
