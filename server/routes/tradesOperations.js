const express = require('express');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { generalLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/tradesOperationsController');

const router = express.Router();

router.get('/public/:businessId', controller.getPublicWorkspace);
router.post('/public/:businessId/requests', generalLimiter, upload.array('photos', 5), validateFileUpload, controller.createDiagnosticRequest);

router.get('/business/:businessId', authenticate, requireBusinessAccess.member(), controller.getBusinessWorkspace);
router.put('/business/:businessId/settings', authenticate, requireBusinessAccess.manager(), controller.updateSettings);

router.post('/business/:businessId/requests', authenticate, requireBusinessAccess.member(), controller.createDiagnosticRequest);
router.put('/business/:businessId/requests/:requestId', authenticate, requireBusinessAccess.member(), controller.updateDiagnosticRequest);

router.post('/business/:businessId/recommendations', authenticate, requireBusinessAccess.member(), controller.createRecommendation);
router.put('/business/:businessId/recommendations/:recommendationId', authenticate, requireBusinessAccess.member(), controller.updateRecommendation);
router.delete('/business/:businessId/recommendations/:recommendationId', authenticate, requireBusinessAccess.member(), controller.deleteRecommendation);

router.post('/business/:businessId/trust-records', authenticate, requireBusinessAccess.member(), controller.createTrustRecord);
router.put('/business/:businessId/trust-records/:recordId', authenticate, requireBusinessAccess.member(), controller.updateTrustRecord);
router.delete('/business/:businessId/trust-records/:recordId', authenticate, requireBusinessAccess.member(), controller.deleteTrustRecord);

module.exports = router;
