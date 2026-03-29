// server/middleware/helperOnboardingMiddleware.js

// Require minimum onboarding step before allowing an action
function requireOnboardingStep(minimumStep) {
  const STEP_ORDER = [
    'registered',
    'profile_complete',
    'id_submitted',
    'id_verified',
    'background_submitted',
    'background_passed',
    'active'
  ];

  return (req, res, next) => {
    const userStep = req.user?.onboarding_step || 'registered';
    const userIdx  = STEP_ORDER.indexOf(userStep);
    const minIdx   = STEP_ORDER.indexOf(minimumStep);

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
  const TIER_ORDER = ['free', 'active', 'premium'];

  return (req, res, next) => {
    const userTier = req.user?.membership_tier || 'free';
    const userIdx  = TIER_ORDER.indexOf(userTier);
    const minIdx   = TIER_ORDER.indexOf(minimumTier);

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
