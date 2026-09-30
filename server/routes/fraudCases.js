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

router.get('/cases', requireAdmin, requirePermission('view_financials'), fraudCaseController.listFraudCases);
router.post('/cases', requireAdmin, requirePermission('view_financials'), fraudCaseController.createFraudCase);
router.post('/cases/:id/assign', requireAdmin, requirePermission('view_financials'), fraudCaseController.assignFraudCase);
router.post('/cases/:id/investigate', requireAdmin, requirePermission('view_financials'), fraudCaseController.investigateFraudCase);
router.post('/cases/:id/resolve', requireAdmin, requirePermission('view_financials'), fraudCaseController.resolveFraudCase);
router.post('/cases/:id/dismiss', requireAdmin, requirePermission('view_financials'), fraudCaseController.dismissFraudCase);
router.post('/cases/:id/link-dispute', requireAdmin, requirePermission('view_financials'), fraudCaseController.linkDispute);

module.exports = router;
