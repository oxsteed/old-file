'use strict';

/**
 * Activation enforcement (PR #804 ecosystem gap G-1).
 *
 * Approval and activation are separate, permanently (vision brief section
 * 12). The registry declares `activationRequirements` per capability, but
 * until this module existed nothing read them: approval minted a grant and
 * the grant alone authorized use. Now `activationFor` resolves each
 * declared requirement against real domain evidence, `resolver.evaluate`
 * (via `accessService.can`) denies a granted-but-incomplete capability
 * with reason `activation_incomplete`, and `getProjection` emits the
 * result so the client can show the missing steps instead of a bare 403.
 *
 * Evidence sources (nothing here invents a new check; each reuses a check
 * the product already performs somewhere):
 *   - identity_verified: the canonical derived identity helper
 *     (`services/helperOnboarding.isIdentityVerified`: id_verified,
 *     identity_verified, or didit_status verified).
 *   - helper_terms: recorded helper terms consent (terms_accepted with a
 *     timestamp and a version), the same facts
 *     `deriveHelperOnboarding` requires for a complete onboarding.
 *   - payout_setup: Stripe Connect onboarding complete
 *     (connect_charges_enabled AND connect_payouts_enabled, the same pair
 *     `middleware/auth.js` exposes as stripe_connect_ready). For
 *     helper.offer_services the helper payout-readiness check also
 *     applies: W-9 on file plus a fresh Didit verification
 *     (`middleware/helperOnboardingMiddleware.requireTaxIdentity`).
 *   - restaurant_activation: the owner has a restaurant row with
 *     status 'active' (food_restaurants.status, draft by default).
 *   - territory_assignment: the owner has a launched franchise
 *     application with a linked business — the same step
 *     `syncFranchiseGrant` requires before it issues the grant, so a
 *     franchise grant is activation-ready by construction.
 *
 * Requirements with no global evidence source (authority_verified,
 * eligibility_verified, agreement_accepted for investor.participate;
 * opportunity/closing requirements for the removed investment.* entries)
 * are per-opportunity or reviewer-owned. They can never be satisfied from
 * account facts, so they stay missing: fail closed, never assumed.
 */

const pool = require('../../db');
const { getCapability } = require('./policyRegistry');
const { isIdentityVerified } = require('../helperOnboarding');
const { isDiditVerificationFresh } = require('../../utils/diditGate');

/** Read the user-row facts every requirement below is derived from. */
async function loadActivationEvidence(userId, db = pool) {
  // Stripe Connect readiness lives on connect_accounts, joined the same
  // way middleware/auth.js does (ca.charges_enabled / ca.payouts_enabled).
  const { rows } = await db.query(
    `SELECT u.id, u.terms_accepted, u.terms_accepted_at, u.terms_version,
            u.id_verified, u.identity_verified, u.didit_status, u.didit_verified_at,
            u.w9_completed,
            ca.charges_enabled AS connect_charges_enabled,
            ca.payouts_enabled AS connect_payouts_enabled
       FROM users u
       LEFT JOIN connect_accounts ca ON ca.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  const user = rows[0] || null;
  if (!user) return null;
  const evidence = { user, hasActiveRestaurant: false, hasLaunchedFranchise: false };
  try {
    const { rows: restaurants } = await db.query(
      `SELECT 1 FROM food_restaurants WHERE owner_user_id = $1 AND status = 'active' LIMIT 1`,
      [userId],
    );
    evidence.hasActiveRestaurant = restaurants.length > 0;
  } catch (error) {
    // Older deployments may not have the restaurant tables yet; activation
    // stays incomplete rather than assuming the restaurant exists.
    if (error && error.code !== '42P01') throw error;
  }
  try {
    const { rows: applications } = await db.query(
      `SELECT 1 FROM franchise_applications
        WHERE owner_user_id = $1 AND status = 'launched' AND linked_business_id IS NOT NULL LIMIT 1`,
      [userId],
    );
    evidence.hasLaunchedFranchise = applications.length > 0;
  } catch (error) {
    if (error && error.code !== '42P01') throw error;
  }
  return evidence;
}

/**
 * Pure requirement check over evidence loaded by loadActivationEvidence.
 * Unknown requirements are missing: activation never passes on a
 * requirement this module cannot verify.
 */
function requirementSatisfied(requirement, evidence, capability) {
  if (!evidence || !evidence.user) return false;
  const user = evidence.user;
  switch (requirement) {
    case 'identity_verified':
      return isIdentityVerified(user);
    case 'helper_terms':
      return Boolean(user.terms_accepted && user.terms_accepted_at && user.terms_version);
    case 'payout_setup': {
      // Stripe Connect onboarding is the payout-readiness evidence for
      // every capability that declares payout_setup. Helpers additionally
      // need the tax-identity gate (W-9 + fresh Didit) that already guards
      // helper money movement.
      const connectReady = Boolean(user.connect_charges_enabled && user.connect_payouts_enabled);
      if (!connectReady) return false;
      if (capability !== 'helper.offer_services') return true;
      return Boolean(user.w9_completed)
        && String(user.didit_status || '').toLowerCase() === 'verified'
        && isDiditVerificationFresh(user.didit_verified_at);
    }
    case 'restaurant_activation':
      return evidence.hasActiveRestaurant === true;
    case 'territory_assignment':
      return evidence.hasLaunchedFranchise === true;
    default:
      return false;
  }
}

/**
 * Resolve a capability's activation state for one user.
 * @returns {{ ready:boolean, missing:string[] }} missing lists every
 *   declared requirement not yet satisfied (empty when ready).
 */
async function activationFor(capability, userId, db = pool) {
  const cap = getCapability(capability);
  if (!cap) return { ready: false, missing: [] };
  const requirements = cap.activationRequirements || [];
  if (!requirements.length) return { ready: true, missing: [] };
  const evidence = await loadActivationEvidence(userId, db);
  if (!evidence) return { ready: false, missing: [...requirements] };
  const missing = requirements.filter((r) => !requirementSatisfied(r, evidence, capability));
  return { ready: missing.length === 0, missing };
}

module.exports = { activationFor, requirementSatisfied, loadActivationEvidence };
