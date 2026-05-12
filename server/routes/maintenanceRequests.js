const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const controller = require('../controllers/maintenanceRequestController');

router.get('/public/:businessId', controller.getPublicBusiness);
router.post(
  '/public/:businessId',
  authenticate,
  upload.array('photos', 5),
  validateFileUpload,
  controller.createRequest
);

router.get('/my', authenticate, controller.listMyRequests);
router.get('/business/:businessId', authenticate, controller.listBusinessRequests);
router.get('/:id', authenticate, controller.getRequest);
router.patch('/:id', authenticate, controller.updateRequest);
router.post('/:id/convert-to-job', authenticate, controller.convertToJob);

module.exports = router;
