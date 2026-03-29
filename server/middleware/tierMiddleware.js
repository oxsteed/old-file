// server/middleware/tierMiddleware.js

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

function requireTier3EligibleHelper(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (req.user.role !== 'helper') {
    return res.status(403).json({ success: false, message: 'Helper access required' });
  }
  if (
    !req.user.onboarding_completed ||
    !req.user.id_verified ||
    !req.user.background_check_passed
  ) {
    return res.status(403).json({
      success: false,
      code: 'TIER3_HELPER_NOT_ELIGIBLE',
      message: 'Complete onboarding, ID verification, and background check to use Guided Protected Job Mode'
    });
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
      message: 'Customer ID verification is required for Guided Protected Job Mode'
    });
  }
  next();
}

module.exports = {
  requireTier2Helper,
  requireTier3EligibleHelper,
  requireTier3EligibleCustomer
};
