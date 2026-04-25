const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');
const {
  submitBusinessLaunchRequest,
  getBusinessLaunchRequests,
  getBusinessLaunchRequest,
  updateBusinessLaunchRequestStatus,
} = require('../controllers/businessLaunchController');

// Public route: Submit a new Business Launch request
router.post(
  '/submit',
  generalLimiter,
  submitBusinessLaunchRequest
);

// Admin routes: View and manage requests
router.get(
  '/requests',
  authenticate,
  requireAdmin,
  getBusinessLaunchRequests
);

router.get(
  '/requests/:id',
  authenticate,
  requireAdmin,
  getBusinessLaunchRequest
);

router.patch(
  '/requests/:id',
  authenticate,
  requireAdmin,
  updateBusinessLaunchRequestStatus
);

module.exports = router;
