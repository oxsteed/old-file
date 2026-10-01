const express       = require('express');
const router        = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { strictLimiter } = require('../middleware/rateLimiter');
const { sendSOS, listSOS } = require('../controllers/safetyController');

// Rate-limit SOS to prevent abuse while still being fast enough for real emergencies
router.post('/sos', authenticate, strictLimiter, sendSOS);

// Admin: view all SOS events
router.get('/sos', authenticate, requireAdmin, requirePermission('manage_support'), listSOS);

module.exports = router;
