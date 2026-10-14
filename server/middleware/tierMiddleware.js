// server/middleware/tierMiddleware.js
const pool = require('../db');
const logger = require('../utils/logger');
const { hasProAccess } = require('../utils/trial');

function requireTier2Helper(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (!['helper', 'helper_pro', 'broker'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Helper access required' });
  }
  if (!hasProAccess(req.user)) {
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
 * and any payment-readiness checks required by the current launch flow.
 *
 * Note: Stripe-era account state may still exist in the database for future
 * infrastructure, but the launch-facing experience should not direct users
 * to a Stripe onboarding UI.
 */
async function requireTier3EligibleHelper(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (req.user.role !== 'helper') {
    return res.status(403).json({ success: false, message: 'Helper access required' });
  }

  // Check platform onboarding requirements.
  // Review P2-7-F11: never read the legacy identity columns off the JWT or
  // the raw user row directly. Derive from the canonical helpers in
  // services/helperOnboarding so every identity writer (Didit, legacy Didit,
  // Stripe Identity) satisfies this gate the same way.
  const { loadHelperOnboarding, isIdentityVerified, backgroundState } = require('../services/helperOnboarding');
  let onboarding = null;
  try {
    onboarding = await loadHelperOnboarding(req.user.id);
  } catch (onboardingErr) {
    logger.error('Tier 3 onboarding derivation failed', { userId: req.user?.id, error: onboardingErr.message });
  }
  const identityOk = Boolean(onboarding && isIdentityVerified(onboarding.user));
  const backgroundOk = Boolean(onboarding && backgroundState(onboarding.user) === 'passed');
  if (
    !req.user.onboarding_completed ||
    !identityOk ||
    !backgroundOk
  ) {
    return res.status(403).json({
      success: false,
      code: 'TIER3_HELPER_NOT_ELIGIBLE',
      message: 'Complete onboarding, ID verification, and background check to accept OxSteed Protection jobs'
    });
  }

  // Keep the database check generic so launch copy does not depend on Stripe UI.
  try {
    const connectResult = await pool.query(
      'SELECT stripe_account_id, onboarding_complete, charges_enabled FROM connect_accounts WHERE user_id = $1',
      [req.user.id]
    );
    if (!connectResult.rows[0] || !connectResult.rows[0].onboarding_complete || !connectResult.rows[0].charges_enabled) {
      return res.status(403).json({
        success: false,
        code: 'TIER3_PAYMENT_NOT_READY',
        message: 'This helper is not ready for protected payment capture yet. Use the direct payment and proof flow instead.'
      });
    }
  } catch (err) {
    logger.error('Tier 3 payment-readiness check failed', { userId: req.user?.id, error: err.message });
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
  // Review P2-7-F11: derive through the canonical identity helper instead
  // of reading the legacy id_verified column directly.
  const { isIdentityVerified } = require('../services/helperOnboarding');
  if (!isIdentityVerified(req.user)) {
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
