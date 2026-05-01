const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { onboardAgent } = require('../controllers/agentOnboardingController');

/**
 * POST /api/support/agents/onboard
 * Admin directly onboards a new support agent
 * Requires: business_id, first_name, last_name, email, timezone, availability_start, availability_end, skills[]
 */
router.post('/onboard', authenticate, requireRole('admin', 'super_admin'), onboardAgent);

module.exports = router;
