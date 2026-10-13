// server/middleware/helperOnboardingMiddleware.js

const { getEffectiveTier } = require('../utils/trial');

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

    // If the required step is unknown, deny - never fail open on unknown requirements
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


// Review P2-2-F11: tax identity is required before money moves to a helper.
// Mirrors the affiliate payout gate (affiliatePayoutsController.js): a W-9
// must be on file and the Didit identity verification must be fresh (2-year
// TTL, fail-closed). Mounted on helper money-movement routes (instant
// payouts); Connect account creation stays ungated on tax identity because
// Stripe collects tax details in its own onboarding and there is no W-9 UI
// yet, so gating creation would deadlock helpers out of payouts.
function requireTaxIdentity(req, res, next) {
  const { isDiditVerificationFresh } = require('../utils/diditGate');
  const user = req.user || {};
  if (!user.w9_completed) {
    return res.status(403).json({
      error: 'Complete your W-9 tax form before receiving payouts.',
      code: 'tax_identity_required',
      missing: 'w9',
    });
  }
  if (user.didit_status !== 'verified' || !isDiditVerificationFresh(user.didit_verified_at)) {
    return res.status(403).json({
      error: 'Verify your identity before receiving payouts.',
      code: 'tax_identity_required',
      missing: 'identity_verification',
    });
  }
  next();
}

// Review P2-594: gate onboarding endpoints on what the helper has actually
// done (see services/helperOnboarding.js), so every step is reachable.
function requireHelperStep(step) {
  return async (req, res, next) => {
    try {
      const { loadHelperOnboarding, missingFor } = require('../services/helperOnboarding');
      const onboarding = await loadHelperOnboarding(req.user.id);
      if (!onboarding || onboarding.user.role !== 'helper') {
        return res.status(403).json({ error: 'Helper account required', code: 'helper_required' });
      }
      const missing = missingFor(step, onboarding);
      if (missing.length) {
        return res.status(403).json({ error: 'Finish the earlier onboarding steps first.', code: 'onboarding_step_missing', missing });
      }
      req.helperOnboarding = onboarding;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

// Review P2-596: publishing a directory listing requires finished onboarding
// (recorded terms, completed profile, verified identity). Unlisting is always
// allowed.
function requireListingEligible(req, res, next) {
  if (!req.body || req.body.is_listed !== true) return next();
  const { loadHelperOnboarding } = require('../services/helperOnboarding');
  return loadHelperOnboarding(req.user.id).then((onboarding) => {
    if (!onboarding || !['helper', 'helper_pro', 'broker'].includes(onboarding.user.role)) {
      return res.status(403).json({ error: 'Helper account required', code: 'helper_required' });
    }
    if (!onboarding.user.onboarding_completed || !onboarding.canAppearInSearch) {
      return res.status(403).json({
        error: 'Finish onboarding before publishing your listing.',
        code: 'listing_requires_onboarding',
        missing: onboarding.user.onboarding_completed ? onboarding.missing : [...onboarding.missing, 'finalize'],
      });
    }
    req.helperOnboarding = onboarding;
    return next();
  }).catch(next);
}

// ── Tier gating ─────────────────────────────────────────
// Require minimum membership tier
// NOTE: Checks effective tier (considers active trials) not just membership_tier
function requireTier(minimumTier) {
  // Support both naming conventions
  // 'pro' = trial-eligible or paid pro tier; 'tier2' = paid tier
  const TIER_ORDER = ['free', 'tier1', 'pro', 'tier2', 'premium'];

  return (req, res, next) => {
    // Use getEffectiveTier to account for active trials
    const userTier = getEffectiveTier(req.user);
    const userIdx  = TIER_ORDER.indexOf(userTier);
    const minIdx   = TIER_ORDER.indexOf(minimumTier);

    // If the required tier is unknown, deny - never fail open on unknown requirements
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
  requireHelperStep,
  requireListingEligible,
  requireOnboardingStep,
  requireTaxIdentity,
  requireTier,
  requireCompletedHelperOnboarding,
  requireHelperLimitedAccess
};
