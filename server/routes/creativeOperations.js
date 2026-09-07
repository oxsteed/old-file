const express = require('express');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { generalLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/creativeOperationsController');

const router = express.Router();

router.get('/public/:businessId', controller.getPublicWorkspace);
router.post('/public/:businessId/intakes', generalLimiter, upload.array('photos', 5), validateFileUpload, controller.createIntakeRequest);

router.get('/business/:businessId', authenticate, requireBusinessAccess.member(), controller.getBusinessWorkspace);
router.put('/business/:businessId/settings', authenticate, requireBusinessAccess.manager(), controller.updateSettings);
router.put('/business/:businessId/intakes/:requestId', authenticate, requireBusinessAccess.member(), controller.updateIntakeRequest);

router.post('/business/:businessId/packages', authenticate, requireBusinessAccess.manager(), controller.createPackage);
router.put('/business/:businessId/packages/:packageId', authenticate, requireBusinessAccess.manager(), controller.updatePackage);
router.delete('/business/:businessId/packages/:packageId', authenticate, requireBusinessAccess.manager(), controller.deletePackage);

router.post('/business/:businessId/approval-records', authenticate, requireBusinessAccess.member(), controller.createApprovalRecord);
router.put('/business/:businessId/approval-records/:recordId', authenticate, requireBusinessAccess.member(), controller.updateApprovalRecord);
router.delete('/business/:businessId/approval-records/:recordId', authenticate, requireBusinessAccess.member(), controller.deleteApprovalRecord);

module.exports = router;
