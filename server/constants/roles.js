/**
 * OxSteed Role Definitions
 * ─────────────────────────────────────────────────────────────
 * These are the canonical role definitions for the entire
 * platform. Import from here — never hardcode role strings.
 *
 * Legal basis for each role is documented inline.
 * These definitions align exactly with Section 3 of the T&C.
 */

// ─── System Roles ─────────────────────────────────────────────
const ROLES = {

  /**
   * CUSTOMER
   * A person or entity that posts jobs or contacts helpers.
   * Legal posture: End consumer. No employment relationship
   * with OxSteed. No tax obligations to OxSteed.
   * Platform liability: Standard consumer protection rules apply.
   */
  CUSTOMER: 'customer',

  /**
   * HELPER_FREE (Tier 1)
   * An independent individual with a free directory listing.
   * Legal posture: Independent contractor operating a personal
   * business. OxSteed is their marketing channel, not employer.
   * Classification defense: Helper sets own rate, own hours,
   * own service area. No exclusivity. No behavioral control
   * by OxSteed. Passes ABC test Part B and C (Ohio standard).
   * Platform liability: Zero. No money flows through platform.
   */
  HELPER_FREE: 'helper',

  /**
   * HELPER_PRO (Tier 2)
   * A Tier 1 Helper with an active Pro subscription.
   * Legal posture: Same IC status as Tier 1. Subscription fee
   * is a SaaS product purchase, not a fee for work dispatched.
   * Platform liability: Zero for job outcomes. Platform liable
   * only for subscription billing disputes.
   * Additional: Optional background check — does not change
   * IC classification. A plumber paying for a business listing
   * in Yellow Pages is still an independent plumber.
   */
  HELPER_PRO: 'helper_pro',

  /**
   * HELPER_BROKER (Tier 3)
   * A Pro Helper with an active Broker subscription and a
   * connected Stripe Express account.
   * Legal posture: Independent payment facilitator. Stripe is
   * the licensed money transmitter. OxSteed is the platform
   * operator. Helper is the merchant of record for their jobs.
   * Platform liability: Limited to escrow administration.
   * OxSteed's dispute resolution is contractual, not judicial.
   */
  HELPER_BROKER: 'broker',

  /**
   * ADMIN (Regular)
   * OxSteed employee or contractor with operational moderation
   * access. Can view jobs, users, and basic reports.
   * Cannot access: financials, system config, user PII exports.
   * Employment status: W-2 employee or 1099 contractor of
   * OxSteed LLC — distinct from Helper independent contractors.
   */
  ADMIN: 'admin',

  /**
   * SUPER_ADMIN
   * OxSteed owner or senior operator with full platform access.
   * Has access to: all financial data, system configuration,
   * due diligence exports, commission overrides, ban authority.
   * This role should never be assigned to more than 2 accounts.
   */
  SUPER_ADMIN: 'super_admin',
};

// ─── Role Hierarchy (for permission checks) ───────────────────
const ROLE_HIERARCHY = {
  [ROLES.CUSTOMER]:      0,
  [ROLES.HELPER_FREE]:   1,
  [ROLES.HELPER_PRO]:    2,
  [ROLES.HELPER_BROKER]: 3,
  [ROLES.ADMIN]:         4,
  [ROLES.SUPER_ADMIN]:   5,
};

// ─── Role Groups (for middleware) ─────────────────────────────
const ROLE_GROUPS = {

  // Any authenticated user
  ANY_USER: [
    ROLES.CUSTOMER,
    ROLES.HELPER_FREE,
    ROLES.HELPER_PRO,
    ROLES.HELPER_BROKER,
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
  ],

  // Any helper regardless of tier
  ANY_HELPER: [
    ROLES.HELPER_FREE,
    ROLES.HELPER_PRO,
    ROLES.HELPER_BROKER,
  ],

  // Helpers with active paid subscription
  PAID_HELPER: [
    ROLES.HELPER_PRO,
    ROLES.HELPER_BROKER,
  ],

  // Roles that can submit bids on jobs
  CAN_BID: [
    ROLES.HELPER_PRO,
    ROLES.HELPER_BROKER,
  ],

  // Roles that can use Tier 3 protected payment
  CAN_USE_ESCROW: [
    ROLES.HELPER_BROKER,
  ],

  // Roles that can mediate for other helpers
  CAN_BROKER: [
    ROLES.HELPER_BROKER,
  ],

  // Any admin tier
  ANY_ADMIN: [
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
  ],

  // Full financial access
  FINANCIAL_ACCESS: [
    ROLES.SUPER_ADMIN,
  ],
};

// ─── Role Capabilities Map ────────────────────────────────────
// What each role CAN do — used for feature gating in frontend
const ROLE_CAPABILITIES = {

  [ROLES.CUSTOMER]: {
    can_post_jobs:            true,
    can_browse_helpers:       true,
    can_request_introduction: true,
    can_submit_bids:          false,
    can_use_tier3_payment:    true,  // Customer side only
    can_view_financial_data:  false,
    can_access_admin:         false,
    can_mediate:              false,
    subscription_required:    false,
  },

  [ROLES.HELPER_FREE]: {
    can_post_jobs:            false,
    can_browse_helpers:       false,
    can_create_profile:       true,
    can_view_job_feed:        true,
    can_submit_bids:          false,  // Must upgrade to Pro
    can_receive_intros:       true,
    can_use_tier3_payment:    false,  // Must upgrade to Broker
    can_view_financial_data:  false,
    can_access_admin:         false,
    can_mediate:              false,
    subscription_required:    false,
  },

  [ROLES.HELPER_PRO]: {
    can_post_jobs:            false,
    can_browse_helpers:       false,
    can_create_profile:       true,
    can_view_job_feed:        true,
    can_submit_bids:          true,
    can_receive_push_alerts:  true,
    can_request_background_check: true,
    can_use_tier3_payment:    false,  // Must upgrade to Broker
    can_view_financial_data:  false,
    can_access_admin:         false,
    can_mediate:              false,
    subscription_required:    true,
    subscription_plan:        'pro',
  },

  [ROLES.HELPER_BROKER]: {
    can_post_jobs:            false,
    can_browse_helpers:       false,
    can_create_profile:       true,
    can_view_job_feed:        true,
    can_submit_bids:          true,
    can_receive_push_alerts:  true,
    can_request_background_check: true,
    can_use_tier3_payment:    true,
    can_receive_escrow_payouts: true,
    can_mediate:              true,
    can_view_financial_data:  false,
    can_access_admin:         false,
    subscription_required:    true,
    subscription_plan:        'broker',
  },

  [ROLES.ADMIN]: {
    can_view_jobs:            true,
    can_moderate_content:     true,
    can_view_users:           true,
    can_ban_users:            true,
    can_view_disputes:        true,
    can_resolve_disputes:     true,
    can_view_basic_reports:   true,
    can_view_financials:      false,
    can_modify_system_config: false,
    can_export_data:          false,
    can_access_admin:         true,
    can_access_super_admin:   false,
  },

  [ROLES.SUPER_ADMIN]: {
    can_view_jobs:            true,
    can_moderate_content:     true,
    can_view_users:           true,
    can_ban_users:            true,
    can_promote_users:        true,
    can_view_disputes:        true,
    can_resolve_disputes:     true,
    can_override_commissions: true,
    can_view_financials:      true,
    can_modify_system_config: true,
    can_export_data:          true,
    can_access_admin:         true,
    can_access_super_admin:   true,
    can_generate_dd_exports:  true,
    can_view_scorecard:       true,
  },
};

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Check if a role has a specific capability.
 * @param {string} role
 * @param {string} capability
 * @returns {boolean}
 */
const can = (role, capability) => {
  return ROLE_CAPABILITIES[role]?.[capability] === true;
};

/**
 * Check if role is in a role group.
 * @param {string} role
 * @param {string} groupName  - key of ROLE_GROUPS
 * @returns {boolean}
 */
const isInGroup = (role, groupName) => {
  return ROLE_GROUPS[groupName]?.includes(role) ?? false;
};

/**
 * Get the rank of a role (higher = more permissions).
 * @param {string} role
 * @returns {number}
 */
const getRank = (role) => ROLE_HIERARCHY[role] ?? -1;

/**
 * Check if roleA outranks roleB.
 */
const outranks = (roleA, roleB) => getRank(roleA) > getRank(roleB);

module.exports = {
  ROLES,
  ROLE_HIERARCHY,
  ROLE_GROUPS,
  ROLE_CAPABILITIES,
  can,
  isInGroup,
  getRank,
  outranks,
};
