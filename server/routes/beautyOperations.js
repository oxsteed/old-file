const express = require('express');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { generalLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/beautyOperationsController');

const router = express.Router();

router.get('/public/:businessId', controller.getPublicWorkspace);
router.post('/public/:businessId/intakes', generalLimiter, upload.array('photos', 5), validateFileUpload, controller.createIntakeRequest);

router.get('/business/:businessId', authenticate, requireBusinessAccess.member(), controller.getBusinessWorkspace);
router.put('/business/:businessId/settings', authenticate, requireBusinessAccess.manager(), controller.updateSettings);
router.put('/business/:businessId/intakes/:requestId', authenticate, requireBusinessAccess.member(), controller.updateIntakeRequest);

router.post('/business/:businessId/packages', authenticate, requireBusinessAccess.manager(), controller.createPackage);
router.put('/business/:businessId/packages/:packageId', authenticate, requireBusinessAccess.manager(), controller.updatePackage);
router.delete('/business/:businessId/packages/:packageId', authenticate, requireBusinessAccess.manager(), controller.deletePackage);

router.post('/business/:businessId/trust-records', authenticate, requireBusinessAccess.manager(), controller.createTrustRecord);
router.put('/business/:businessId/trust-records/:recordId', authenticate, requireBusinessAccess.manager(), controller.updateTrustRecord);
router.delete('/business/:businessId/trust-records/:recordId', authenticate, requireBusinessAccess.manager(), controller.deleteTrustRecord);

module.exports = router;
