function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  next();
}

function requireHelperRole(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'helper') {
    return res.status(403).json({
      success: false,
      message: 'Helper access required'
    });
  }

  next();
}

function requireVerifiedHelper(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'helper') {
    return res.status(403).json({
      success: false,
      message: 'Helper access required'
    });
  }

  if (!req.user.email_verified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification is required'
    });
  }

  next();
}

function requireCompletedHelperOnboarding(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'helper') {
    return res.status(403).json({
      success: false,
      message: 'Helper access required'
    });
  }

  if (!req.user.email_verified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification is required'
    });
  }

  if (!req.user.onboarding_completed || req.user.onboarding_status !== 'onboarding_complete') {
    return res.status(403).json({
      success: false,
      code: 'HELPER_ONBOARDING_INCOMPLETE',
      message: 'Complete helper onboarding before accessing this feature',
      onboarding: {
        onboarding_status: req.user.onboarding_status,
        onboarding_completed: !!req.user.onboarding_completed,
        contact_completed: !!req.user.contact_completed,
        profile_completed: !!req.user.profile_completed,
        tier_selected: !!req.user.tier_selected,
        w9_completed: !!req.user.w9_completed,
        terms_accepted: !!req.user.terms_accepted
      }
    });
  }

  next();
}

function requireHelperLimitedAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'helper') {
    return res.status(403).json({
      success: false,
      message: 'Helper access required'
    });
  }

  if (!req.user.email_verified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification is required'
    });
  }

  next();
}

module.exports = {
  requireAuth,
  requireHelperRole,
  requireVerifiedHelper,
  requireCompletedHelperOnboarding,
  requireHelperLimitedAccess
};
