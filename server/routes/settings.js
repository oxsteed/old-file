const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { patchPrivacySettings } = require('../controllers/settingsPrivacyController');

router.patch('/privacy', authenticate, patchPrivacySettings);

module.exports = router;
