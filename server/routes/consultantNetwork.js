const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const requirePlatformApproval = require('../middleware/requirePlatformApproval');
const controller = require('../controllers/consultantNetworkController');

// Review P2-7-F09: the shared requirePlatformApproval middleware (was mounted
// nowhere) now gates paying referral transitions. Only transitions into a
// paying state need approval; other status updates pass through.
const PAYING_REFERRAL_STATUSES = new Set(['engaged', 'won']);
const gatePayingReferralTransition = (req, res, next) => {
  if (PAYING_REFERRAL_STATUSES.has(req.body?.consultant_assignment_status)) {
    return requirePlatformApproval('consultant', 'accept_paying_booking')(req, res, next);
  }
  return next();
};

router.get('/profile', authenticate, controller.getMyConsultantProfile);
router.put('/profile', authenticate, controller.upsertMyConsultantProfile);
router.get('/dashboard', authenticate, controller.getMyConsultantDashboard);
router.patch('/referrals/:requestId', authenticate, gatePayingReferralTransition, controller.updateMyReferral);

module.exports = router;
