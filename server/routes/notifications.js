const router      = require('express').Router();
const { authenticate } = require('../middleware/auth');
const notifCtrl   = require('../controllers/notificationController');
const webPushCtrl = require('../controllers/webPushController');

router.get('/',                  authenticate, notifCtrl.getNotifications);
router.post('/mark-read',        authenticate, notifCtrl.markRead);
router.get('/preferences',       authenticate, notifCtrl.getPreferences);
router.put('/preferences',       authenticate, notifCtrl.updatePreferences);
router.post('/push-token',       authenticate, notifCtrl.registerPushToken);

// ─── Web Push (W3C Push API + VAPID) ─────────────────────────
// Public - needed before the browser can call pushManager.subscribe()
router.get('/webpush/public-key',     webPushCtrl.getPublicKey);

router.post('/webpush/subscribe',     authenticate, webPushCtrl.subscribe);
router.delete('/webpush/subscribe',   authenticate, webPushCtrl.unsubscribe);
router.get('/webpush/devices',        authenticate, webPushCtrl.listDevices);
router.post('/webpush/test',          authenticate, webPushCtrl.sendTest);

module.exports = router;
