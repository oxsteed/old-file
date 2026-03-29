// server/middleware/helperOnboardingMiddleware.js

// Require minimum onboarding step before allowing an action
function requireOnboardingStep(minimumStep) {
  const STEP_ORDER = [
    'registered',
    'verified_pending_onboarding',
    'profile_complete',
    'onboarding_in_progress',
    'id_submitted',
    'id_verified',
    'background_submitted',
    'background_passed',
    'onboarding_complete',
    'active'
  ];

  return (req, res, next) => {
    // Map onboarding_status to step
    const status = req.user?.onboarding_status || 'verified_pending_onboarding';
    const completed = req.user?.onboarding_completed;
    let userStep = status;
    if (completed) userStep = 'active';

    const userIdx  = STEP_ORDER.indexOf(userStep);
    const minIdx   = STEP_ORDER.indexOf(minimumStep);

    // If step is unknown, allow (be lenient)
    if (userIdx === -1 || minIdx === -1) {
      return next();
    }

    if (userIdx < minIdx) {
      return res.status(403).json({
        error: 'Onboarding incomplete',
        current_step: userStep,
        required_step: minimumStep
      });
    }
    next();
  };
}

// Require minimum membership tier
function requireTier(minimumTier) {
  // Support both naming conventions
  const TIER_ORDER = ['free', 'tier1', 'active', 'tier2', 'premium'];

  return (req, res, next) => {
    const userTier = req.user?.membership_tier || 'tier1';
    const userIdx  = TIER_ORDER.indexOf(userTier);
    const minIdx   = TIER_ORDER.indexOf(minimumTier);

    // If tier is unknown, allow (be lenient)
    if (userIdx === -1 || minIdx === -1) {
      return next();
    }

    if (userIdx < minIdx) {
      return res.status(403).json({
        error: 'Membership tier insufficient',
        current_tier: userTier,
        required_tier: minimumTier
      });
    }
    next();
  };
}

module.exports = { requireOnboardingStep, requireTier };
