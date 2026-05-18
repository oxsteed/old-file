const express = require('express');
const { authenticate } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const controller = require('../controllers/continuityOperationsController');

const router = express.Router();

router.get('/public/:businessId', controller.getPublicWorkspace);
router.post('/public/:businessId/intakes', controller.createIntakeRequest);

router.get('/business/:businessId', authenticate, requireBusinessAccess.member(), controller.getBusinessWorkspace);
router.put('/business/:businessId/settings', authenticate, requireBusinessAccess.manager(), controller.updateSettings);
router.put('/business/:businessId/intakes/:requestId', authenticate, requireBusinessAccess.member(), controller.updateIntakeRequest);

router.post('/business/:businessId/plans', authenticate, requireBusinessAccess.manager(), controller.createPlan);
router.put('/business/:businessId/plans/:planId', authenticate, requireBusinessAccess.manager(), controller.updatePlan);
router.delete('/business/:businessId/plans/:planId', authenticate, requireBusinessAccess.manager(), controller.deletePlan);

router.post('/business/:businessId/trust-records', authenticate, requireBusinessAccess.member(), controller.createTrustRecord);
router.put('/business/:businessId/trust-records/:recordId', authenticate, requireBusinessAccess.member(), controller.updateTrustRecord);
router.delete('/business/:businessId/trust-records/:recordId', authenticate, requireBusinessAccess.member(), controller.deleteTrustRecord);

module.exports = router;
