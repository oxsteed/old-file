const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const affiliatePayoutsController = require('../controllers/affiliatePayoutsController');

// Programs
router.post('/', requireAuth, affiliatePayoutsController.createAffiliateProgram);
router.get('/', requireAuth, affiliatePayoutsController.getAffiliatePrograms);
router.get('/:programId', requireAuth, affiliatePayoutsController.getAffiliateProgram);

// Commissions
router.get('/:programId/commissions', requireAuth, affiliatePayoutsController.getAffiliateCommissions);

// Payouts
router.get('/schedule', requireAuth, affiliatePayoutsController.getPayoutsSchedule);
router.post('/calculate', requireAuth, affiliatePayoutsController.calculateAndCreatePayout);
router.post('/:payoutId/process', requireAuth, affiliatePayoutsController.processPayout);

// Stats
router.get('/stats/all', requireAuth, affiliatePayoutsController.getAffiliateStats);

module.exports = router;
