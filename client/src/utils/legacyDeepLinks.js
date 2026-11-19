// client/src/utils/legacyDeepLinks.js
//
// Stale deep-link index (WP-104 cutover). Every former mode entry point maps
// to its current action in one place, so a bookmark, an old email, or a
// third-party link never lands on a bare 404 and never on a dashboard the
// account does not have.
//
// Two families:
//
//  1. Signup entry points. The join flow offers one card per intent
//     (customer, helper, business owner); the card a link preselects is an
//     *intent* card, not a mode grant. The signup payload sends only
//     `signupIntent`, and the server decides what the account may do.
//     `/register/<mode>` and `/join?mode=<mode>` both resolve through
//     joinTargetForLegacyMode / joinModeForLegacyMode below. Self-selectable
//     persona intents preselect their descriptive card; granted staff,
//     membership, and nonhuman modes still land on the customer-first flow.
//  2. Former dashboard deep links. These are recorded with the mechanism
//     that already resolves them; this module does not re-implement those
//     redirects. /helper-dashboard itself is NOT stale: it stays as the work
//     surface reached via nav (the myWork capability shortcut).
//
// The legacy → intent map mirrors LEGACY_MODE_TO_INTENT in
// server/services/access/policyRegistry.js (the server stays the source of
// truth; this copy only drives link preselection, never authority).
//
// Deliberately left out (no evidence of inbound links; add a row with
// evidence if one appears):
//   - /business-dashboard — never existed as a route.
//   - /signup, /sign-up — no evidence these routes ever existed.
//   - /helper/* work pages (/helper/clients, /helper/payouts,
//     /helper/messages) — live routes, not stale.
//   - /register/<granted mode> (business_manager, business_representative,
//     business_employee, business_support_agent) — granted modes are never
//     self-selected; they land on /join like any unknown mode.

export const LEGACY_MODE_TO_INTENT = Object.freeze({
  customer: 'find_help',
  restaurant_customer: 'find_help',
  life_only: 'find_help',
  helper: 'offer_services',
  business_owner: 'run_business',
  restaurant_owner: 'run_restaurant',
  consultant: 'consult',
  tool_owner: 'list_equipment',
  equipment_owner: 'list_equipment',
  logistics: 'ship_goods',
  delivery: 'ship_goods',
  driver: 'ship_goods',
  franchise_applicant: 'franchise',
  investor: 'request_reporting',
  credit_participant: 'join_credit',
  credit_member: 'join_credit',
  partner: 'join_partner',
  affiliate: 'join_partner',
  workforce: 'join_workforce',
  learner: 'join_workforce',
  instructor: 'join_workforce',
});

// Modes the join flow actually offers as cards. Mirrors
// LAUNCH_SELF_SELECTABLE_MODES in ./launchScope.js (JoinPage's MODES).
export const JOIN_MODE_CARDS = Object.freeze([
  'customer', 'helper', 'business_owner', 'restaurant_owner', 'logistics', 'delivery', 'driver',
  'consultant', 'tool_owner', 'equipment_owner', 'franchise_applicant', 'investor',
  'credit_participant', 'credit_member', 'partner', 'affiliate', 'workforce', 'learner', 'instructor',
]);

/** Intent a legacy mode value expresses; unknown values collapse to find_help. */
export function intentForLegacyMode(mode) {
  if (typeof mode !== 'string') return 'find_help';
  return LEGACY_MODE_TO_INTENT[mode.trim().toLowerCase()] || 'find_help';
}

/**
 * Join card a legacy `?mode=` value preselects, or null when the mode has no
 * card (the join flow then falls back to its customer-first default).
 */
export function joinModeForLegacyMode(mode) {
  if (typeof mode !== 'string') return null;
  const value = mode.trim().toLowerCase();
  return JOIN_MODE_CARDS.includes(value) ? value : null;
}

/** Join URL for a legacy mode value: card preselected, or plain /join. */
export function joinTargetForLegacyMode(mode) {
  const card = joinModeForLegacyMode(mode);
  return card && card !== 'customer' ? `/join?mode=${card}` : '/join';
}

/** Target for a former /register/<mode> entry point. */
export function resolveLegacyRegisterPath(mode) {
  return joinTargetForLegacyMode(mode);
}

// Former dashboard deep links and where they go today. `owner` names the
// mechanism that resolves the link; only the /register/* family is resolved
// by this module (see resolveLegacyRegisterPath). `kept` means the route
// still renders; it is recorded here so the index stays complete.
export const LEGACY_DASHBOARD_LINKS = Object.freeze({
  '/helper-dashboard': {
    action: 'kept',
    target: '/helper-dashboard',
    owner: 'App.jsx route (work surface, requireOnboarded)',
    note: 'Reached via nav (myWork capability shortcut); never a landing.',
  },
  '/investor/dashboard': {
    action: 'redirect',
    target: '/dashboard',
    owner: 'launchScope getLaunchRedirect (/investor prefix)',
    note: 'Investor reporting is an application capability, not a home.',
  },
  '/consulting/portal': {
    action: 'redirect',
    target: '/business-hub',
    owner: 'launchScope getLaunchRedirect (/consulting prefix)',
    note: 'Consulting work lives in the business workspace.',
  },
  '/franchise/status': {
    action: 'redirect',
    target: '/business-hub',
    owner: 'launchScope getLaunchRedirect (/franchise prefix)',
    note: 'Franchise work lives in the business workspace.',
  },
});

/** Recorded current target for a former dashboard deep link, or null. */
export function legacyDashboardTarget(pathname) {
  if (typeof pathname !== 'string') return null;
  return LEGACY_DASHBOARD_LINKS[pathname]?.target || null;
}

export default {
  LEGACY_MODE_TO_INTENT,
  JOIN_MODE_CARDS,
  intentForLegacyMode,
  joinModeForLegacyMode,
  joinTargetForLegacyMode,
  resolveLegacyRegisterPath,
  LEGACY_DASHBOARD_LINKS,
  legacyDashboardTarget,
};
