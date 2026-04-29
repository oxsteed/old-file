const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const smsNotificationController = require('../controllers/smsNotificationController');

// Request phone verification (send OTP)
router.post('/request-verification', requireAuth, smsNotificationController.requestPhoneVerification);

// Verify phone with OTP
router.post('/verify-otp', requireAuth, smsNotificationController.verifyPhone);

// Get SMS preferences
router.get('/preferences', requireAuth, smsNotificationController.getSMSPreferences);

// Update SMS preferences
router.put('/preferences', requireAuth, smsNotificationController.updateSMSPreferences);

// Get SMS logs
router.get('/logs', requireAuth, smsNotificationController.getSMSLogs);

module.exports = router;
