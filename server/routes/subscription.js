const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const subCtrl = require('../controllers/subscriptionController');
const db = require('../db');
const { paymentsLimiter, strictLimiter } = require('../middleware/rateLimiter');
const { requireFeatureEnabled } = require('../middleware/featureFlags');
// Review P3-942: subscriptions are unlaunched in the client; new purchases are
// gated server-side too. Existing subscribers can still view, cancel and use the portal.
const requireSubscriptionsLaunched = requireFeatureEnabled('Subscriptions', 'SUBSCRIPTIONS_ENABLED', false);

// Subscription routes
router.get('/plans', subCtrl.getPlans);
router.post('/checkout', authenticate, requireSubscriptionsLaunched, paymentsLimiter, subCtrl.createCheckout);
router.get('/current', authenticate, subCtrl.getSubscription);
router.get('/badges/:userId', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, type AS badge_type, created_at
       FROM badges
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.params.userId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});
router.post('/cancel', authenticate, subCtrl.cancelSubscription);
router.post('/portal', strictLimiter, authenticate, subCtrl.createPortalSession);

module.exports = router;
