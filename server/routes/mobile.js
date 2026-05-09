const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const mobileController = require('../controllers/mobileController');

router.post('/push-token', authenticate, mobileController.registerPushToken);
router.delete('/push-token', authenticate, mobileController.unregisterPushToken);

module.exports = router;
