'use strict';

/**
 * Fraud case routes (admin-only).
 *
 * Mounted by the parent at /api/fraud, e.g.:
 *   const fraudCaseRoutes = require('./routes/fraudCases');
 *   app.use('/api/fraud', fraudCaseRoutes);
 */

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const fraudCaseController = require('../controllers/fraudCaseController');

// Track D (finding 23): the list keeps the read grant; every mutation moves
// to the manage grant, so a read-granted admin can no longer resolve or
// dismiss a fraud investigation.
router.get('/cases', requireAdmin, requirePermission('view_financials'), fraudCaseController.listFraudCases);
router.post('/cases', requireAdmin, requirePermission('manage_financials'), fraudCaseController.createFraudCase);
router.post('/cases/:id/assign', requireAdmin, requirePermission('manage_financials'), fraudCaseController.assignFraudCase);
router.post('/cases/:id/investigate', requireAdmin, requirePermission('manage_financials'), fraudCaseController.investigateFraudCase);
router.post('/cases/:id/resolve', requireAdmin, requirePermission('manage_financials'), fraudCaseController.resolveFraudCase);
router.post('/cases/:id/dismiss', requireAdmin, requirePermission('manage_financials'), fraudCaseController.dismissFraudCase);
router.post('/cases/:id/link-dispute', requireAdmin, requirePermission('manage_financials'), fraudCaseController.linkDispute);

module.exports = router;
