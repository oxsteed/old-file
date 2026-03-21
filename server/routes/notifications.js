const router      = require('express').Router();
const { authenticate } = require('../middleware/auth');
const notifCtrl   = require('../controllers/notificationController');

router.get('/',                  authenticate, notifCtrl.getNotifications);
router.post('/mark-read',        authenticate, notifCtrl.markRead);
router.get('/preferences',       authenticate, notifCtrl.getPreferences);
router.put('/preferences',       authenticate, notifCtrl.updatePreferences);
router.post('/push-token',       authenticate, notifCtrl.registerPushToken);

module.exports = router;
