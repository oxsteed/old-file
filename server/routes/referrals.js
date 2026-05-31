const router       = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const ctrl         = require('../controllers/referralController');

router.get('/me',          authenticate, ctrl.getMyReferral);
router.get('/balance',     authenticate, ctrl.getCreditBalance);
router.post('/validate',   authLimiter,  ctrl.validateCode);   // public but rate-limited

module.exports = router;
