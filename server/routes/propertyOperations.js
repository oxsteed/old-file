const express = require('express');
const { authenticate } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const controller = require('../controllers/propertyOperationsController');

const router = express.Router();

router.get('/public/:businessId', controller.getPublicWorkspace);

router.get('/business/:businessId', authenticate, requireBusinessAccess.member(), controller.getBusinessWorkspace);
router.put('/business/:businessId/settings', authenticate, requireBusinessAccess.manager(), controller.updateSettings);

router.post('/business/:businessId/units', authenticate, requireBusinessAccess.manager(), controller.createUnit);
router.put('/business/:businessId/units/:unitId', authenticate, requireBusinessAccess.manager(), controller.updateUnit);
router.delete('/business/:businessId/units/:unitId', authenticate, requireBusinessAccess.manager(), controller.deleteUnit);

router.post('/business/:businessId/packages', authenticate, requireBusinessAccess.manager(), controller.createPackage);
router.put('/business/:businessId/packages/:packageId', authenticate, requireBusinessAccess.manager(), controller.updatePackage);
router.delete('/business/:businessId/packages/:packageId', authenticate, requireBusinessAccess.manager(), controller.deletePackage);

router.post('/business/:businessId/compliance-records', authenticate, requireBusinessAccess.manager(), controller.createComplianceRecord);
router.put('/business/:businessId/compliance-records/:recordId', authenticate, requireBusinessAccess.manager(), controller.updateComplianceRecord);
router.delete('/business/:businessId/compliance-records/:recordId', authenticate, requireBusinessAccess.manager(), controller.deleteComplianceRecord);

module.exports = router;
