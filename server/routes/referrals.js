const router       = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl         = require('../controllers/referralController');

router.get('/me',          authenticate, ctrl.getMyReferral);
router.post('/validate',               ctrl.validateCode);   // public

module.exports = router;
