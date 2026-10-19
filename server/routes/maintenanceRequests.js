const express = require('express');
const router = express.Router();
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { scopeExempt } = require('../middleware/scopeGates');
const { authenticate } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const requireTermsAcceptance = require('../middleware/requireTermsAcceptance');
const checkRestrictions = require('../middleware/checkRestrictions');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const controller = require('../controllers/maintenanceRequestController');

router.get('/public/:businessId', scopeExempt('public-storefront'), controller.getPublicBusiness);
router.post(
  '/public/:businessId',
  authenticate,
  upload.array('photos', 5),
  validateFileUpload,
  scopeExempt('public-intake'), controller.createRequest
);

router.get('/my', authenticate, controller.listMyRequests);
router.get('/assigned', authenticate, controller.listAssignedRequests);
router.get('/business/:businessId', authenticate, requireBusinessAccess({ minRole: 'any', resolvePermissions: false }), controller.listBusinessRequests);
router.get('/:id', authenticate, controller.getRequest);
router.patch('/:id', authenticate, controller.updateRequest);
// Review P2-9-F10: converting a maintenance request to a job posts a public
// job, so it goes through the same guards as POST /api/jobs (verified email,
// current terms, job-posting restrictions).
router.post('/:id/convert-to-job', authenticate, requireEmailVerified, requireTermsAcceptance, checkRestrictions('job_posting'), controller.convertToJob);

module.exports = router;
