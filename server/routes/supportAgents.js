const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  onboardAgent,
  listMySupportEmployers,
  ensureMyHelperEmployer,
} = require('../controllers/agentOnboardingController');

/**
 * GET /api/support/agents/employers/me
 */
router.get('/employers/me', authenticate, listMySupportEmployers);

/**
 * POST /api/support/agents/employers/helper
 */
router.post('/employers/helper', authenticate, ensureMyHelperEmployer);

/**
 * POST /api/support/agents/onboard
 */
router.post('/onboard', authenticate, onboardAgent);

module.exports = router;
