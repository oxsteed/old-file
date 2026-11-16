const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/consultantNetworkController');

router.get('/profile', authenticate, controller.getMyConsultantProfile);
router.put('/profile', authenticate, controller.upsertMyConsultantProfile);
router.get('/dashboard', authenticate, controller.getMyConsultantDashboard);
router.patch('/referrals/:requestId', authenticate, controller.updateMyReferral);

module.exports = router;
