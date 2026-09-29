const express = require('express');
const router = express.Router();
const policyController = require('../controllers/helperCancellationPoliciesController');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/helper-settings/policies
 * Get helper's current cancellation policies
 */
router.get('/policies', requireAuth, policyController.getPolicies);

/**
 * PUT /api/helper-settings/policies
 * Update helper's cancellation policies
 */
router.put('/policies', requireAuth, policyController.updatePolicies);

/**
 * GET /api/helper-settings/policies/history
 * Permanent change history for the helper's own custom off-platform payment settings
 */
router.get('/policies/history', requireAuth, policyController.getPolicyHistory);

/**
 * GET /api/helper-settings/oxsteed-default
 * Get default OxSteed policy for reference (public)
 */
router.get('/oxsteed-default', policyController.getOxsteadDefaultPolicy);

module.exports = router;
