const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireUserTotpStepUp } = require('../middleware/requireUserTotpStepUp');
const PayoutController = require('../controllers/PayoutController');
const { requireOnboardingStep } = require('../middleware/helperOnboardingMiddleware');

// Payout Methods (User Routes)
// Review P2-2-F01: registering or changing a payout destination is a money
// path; helpers must have finished onboarding first. Reads stay open.
// Audit fix (auth finding 20): payout-method writes are the classic
// account-takeover payout-redirection vector. Writes require a fresh TOTP
// proof (totp_code in the body), verified against the helper's enrolled
// secret, on top of onboarding. Fail closed when TOTP is not enrolled.
router.get('/payout-methods', requireAuth, PayoutController.getPayoutMethods);
router.post('/payout-methods', requireAuth, requireUserTotpStepUp, requireOnboardingStep('active'), PayoutController.createPayoutMethod);
router.put('/payout-methods/:method_id', requireAuth, requireUserTotpStepUp, requireOnboardingStep('active'), PayoutController.updatePayoutMethod);
router.delete('/payout-methods/:method_id', requireAuth, requireUserTotpStepUp, requireOnboardingStep('active'), PayoutController.deletePayoutMethod);

module.exports = router;
