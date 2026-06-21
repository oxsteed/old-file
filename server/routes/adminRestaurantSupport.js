'use strict';

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/adminAuth');
const ctrl = require('../controllers/restaurantSupportController');

router.use(requireAdmin);

router.get('/cases', ctrl.adminListCases);
router.get('/cases/:caseId', ctrl.adminGetCase);
router.post('/cases/:caseId/assign', ctrl.adminAssign);
router.post('/cases/:caseId/escalate', ctrl.adminEscalate);
router.post('/cases/:caseId/deescalate', ctrl.adminDeescalate);
router.post('/cases/:caseId/approve-resolution', ctrl.adminApproveResolution);
router.post('/cases/:caseId/close', ctrl.adminClose);
router.post('/cases/:caseId/reopen', ctrl.adminReopen);
router.get('/metrics', ctrl.adminMetrics);

module.exports = router;
