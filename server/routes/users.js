// Phase 2 - Users routes
// OxSteed v2

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { getMe, updateProfile } = require('../controllers/authController');

router.get('/me', authenticate, getMe);
router.patch('/me', authenticate, updateProfile);

router.use(errorHandler);

module.exports = router;
