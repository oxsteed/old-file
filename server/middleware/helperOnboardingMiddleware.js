// server/middleware/helperOnboardingMiddleware.js

// ── New onboarding step gating ──────────────────────────
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

    // If the required step is unknown, deny — never fail open on unknown requirements
    if (minIdx === -1) {
      return res.status(403).json({ error: 'Onboarding step check failed.' });
    }
    // If the user's step is unknown, treat as the minimum (registered)
    const effectiveUserIdx = userIdx === -1 ? 0 : userIdx;

    if (effectiveUserIdx < minIdx) {
      return res.status(403).json({
        error: 'Onboarding incomplete',
        current_step: userStep,
        required_step: minimumStep
      });
    }
    next();
  };
}

// ── Tier gating ─────────────────────────────────────────
// Require minimum membership tier
function requireTier(minimumTier) {
  // Support both naming conventions
  const TIER_ORDER = ['free', 'tier1', 'active', 'tier2', 'premium'];

  return (req, res, next) => {
    const userTier = req.user?.membership_tier || 'tier1';
    const userIdx  = TIER_ORDER.indexOf(userTier);
    const minIdx   = TIER_ORDER.indexOf(minimumTier);

    // If the required tier is unknown, deny — never fail open on unknown requirements
    if (minIdx === -1) {
      return res.status(403).json({ error: 'Tier check failed.' });
    }
    // If the user's tier is unknown, treat as the lowest tier (free)
    const effectiveUserIdx = userIdx === -1 ? 0 : userIdx;

    if (effectiveUserIdx < minIdx) {
      return res.status(403).json({
        error: 'Membership tier insufficient',
        current_tier: userTier,
        required_tier: minimumTier
      });
    }
    next();
  };
}

// ── Legacy middleware (preserved for backward compatibility) ──

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
  next();
}

module.exports = {
  requireOnboardingStep,
  requireTier,
  requireCompletedHelperOnboarding,
  requireHelperLimitedAccess
};
