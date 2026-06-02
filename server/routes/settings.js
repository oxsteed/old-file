const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const {
  patchPrivacySettings,
  submitAppReport,
} = require('../controllers/settingsPrivacyController');

router.patch('/privacy', authenticate, patchPrivacySettings);
router.post('/app-report', authenticate, submitAppReport);

module.exports = router;
