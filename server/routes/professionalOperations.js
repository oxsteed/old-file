const express = require('express');
const { authenticate } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const controller = require('../controllers/professionalOperationsController');

const router = express.Router();

router.get('/public/:businessId', controller.getPublicWorkspace);
router.post('/public/:businessId/intakes', controller.createEngagementRequest);

router.get('/business/:businessId', authenticate, requireBusinessAccess.member(), controller.getBusinessWorkspace);
router.put('/business/:businessId/settings', authenticate, requireBusinessAccess.manager(), controller.updateSettings);
router.put('/business/:businessId/intakes/:requestId', authenticate, requireBusinessAccess.member(), controller.updateEngagementRequest);

router.post('/business/:businessId/packages', authenticate, requireBusinessAccess.manager(), controller.createPackage);
router.put('/business/:businessId/packages/:packageId', authenticate, requireBusinessAccess.manager(), controller.updatePackage);
router.delete('/business/:businessId/packages/:packageId', authenticate, requireBusinessAccess.manager(), controller.deletePackage);

router.post('/business/:businessId/compliance-records', authenticate, requireBusinessAccess.member(), controller.createComplianceRecord);
router.put('/business/:businessId/compliance-records/:recordId', authenticate, requireBusinessAccess.member(), controller.updateComplianceRecord);
router.delete('/business/:businessId/compliance-records/:recordId', authenticate, requireBusinessAccess.member(), controller.deleteComplianceRecord);

module.exports = router;
