// server/middleware/tierMiddleware.js
const pool = require('../db');
const logger = require('../utils/logger');

function requireTier2Helper(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (req.user.role !== 'helper') {
    return res.status(403).json({ success: false, message: 'Helper access required' });
  }
  if (req.user.membership_tier !== 'tier2') {
    return res.status(403).json({
      success: false,
      code: 'TIER2_REQUIRED',
      message: 'This feature requires Tier 2 Pro Helper membership'
    });
  }
  next();
}

/**
 * Require that a helper is eligible for Tier 3 (OxSteed Protection) jobs.
 * Checks: onboarding complete, ID verified, background check passed,
 * AND Stripe Express onboarding complete with charges enabled.
 *
 * Per design: to accept a Tier 3 job, helpers must complete Stripe Express
 * onboarding from within OxSteed so they can receive direct charges.
 */
async function requireTier3EligibleHelper(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (req.user.role !== 'helper') {
    return res.status(403).json({ success: false, message: 'Helper access required' });
  }

  // Check platform onboarding requirements
  if (
    !req.user.onboarding_completed ||
    !req.user.id_verified ||
    !req.user.background_check_passed
  ) {
    return res.status(403).json({
      success: false,
      code: 'TIER3_HELPER_NOT_ELIGIBLE',
      message: 'Complete onboarding, ID verification, and background check to accept OxSteed Protection jobs'
    });
  }

  // Check Stripe Express onboarding is complete and charges are enabled
  try {
    const connectResult = await pool.query(
      'SELECT stripe_account_id, onboarding_complete, charges_enabled FROM connect_accounts WHERE user_id = $1',
      [req.user.id]
    );
    if (!connectResult.rows[0] || !connectResult.rows[0].onboarding_complete || !connectResult.rows[0].charges_enabled) {
      return res.status(403).json({
        success: false,
        code: 'TIER3_STRIPE_NOT_READY',
        message: 'Complete Stripe payment setup to accept OxSteed Protection jobs. Go to your dashboard to set up payments.'
      });
    }
  } catch (err) {
    logger.error('Tier3 Stripe check error:', err);
    return res.status(500).json({ success: false, message: 'Failed to verify payment account status' });
  }

  next();
}

function requireTier3EligibleCustomer(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (req.user.role !== 'customer') {
    return res.status(403).json({ success: false, message: 'Customer access required' });
  }
  if (!req.user.id_verified) {
    return res.status(403).json({
      success: false,
      code: 'TIER3_CUSTOMER_NOT_ELIGIBLE',
      message: 'Customer ID verification is required for OxSteed Protection jobs'
    });
  }
  next();
}

module.exports = {
  requireTier2Helper,
  requireTier3EligibleHelper,
  requireTier3EligibleCustomer
};
