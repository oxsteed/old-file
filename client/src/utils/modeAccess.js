// client/src/utils/modeAccess.js
//
// WP-104: the legacy gates `canPostJobs` and `canAccessBusinessHub` are
// deleted. Posting a job is open to any signed-in account (the customer
// workspace action); Business Hub access comes from the access projection
// (`hasBusinessHubAccess`). The remaining mode-aware predicates below are
// untouched by this cutover: they answer dashboard/sidebar questions for
// surfaces whose own migration is a later phase, and they read
// `default_mode` (kept in lockstep with `users.role` on the server, see
// server/utils/modeRole.js), never the deleted role-based `isHelper` flag.

import { projectionActive } from './accessProjection.js';

// Modes that imply users.role='helper' on the server. Mirrors MODE_ROLE_MAP
// in server/utils/modeRole.js.
const HELPER_CLASS_MODES = new Set([
  'helper',
  'business_owner',
  'consultant',
  'tool_owner',
  'business_manager',
  'business_representative',
  'business_employee',
  'business_support_agent',
]);

// Modes that imply users.role='customer'. life_only + franchise_applicant
// are customer-class at the DB level — they're customer accounts with extra
// surfaces shown.
const CUSTOMER_CLASS_MODES = new Set([
  'customer',
  'investor',
  'logistics',
  'franchise_applicant',
  'life_only',
]);

function getMode(user) {
  return user?.default_mode || (user?.role === 'helper' ? 'helper' : 'customer');
}

export function isHelperClassMode(user) {
  return HELPER_CLASS_MODES.has(getMode(user));
}

export function isCustomerClassMode(user) {
  return CUSTOMER_CLASS_MODES.has(getMode(user));
}

// ── Dashboard selection ──────────────────────────────────────────────────────
// Used by SmartDashboard / DashboardRouter to pick which child page to render.
export function dashboardKeyForMode(mode) {
  switch (mode) {
    case 'helper':                  return 'helper';
    case 'investor':                return 'investor';
    case 'logistics':               return 'logistics';
    case 'business_owner':          return 'business_owner';
    case 'consultant':              return 'consultant';
    case 'tool_owner':              return 'tool_owner';
    case 'franchise_applicant':     return 'franchise_applicant';
    case 'life_only':               return 'life';
    case 'business_manager':        return 'business_manager';
    case 'business_representative': return 'business_representative';
    case 'business_employee':       return 'business_employee';
    case 'business_support_agent':  return 'support_agent';
    case 'admin':                   return 'admin';
    case 'customer':
    default:                        return 'customer';
  }
}

// ── Per-mode visibility predicates ───────────────────────────────────────────
// Keep these tight — each one answers a single yes/no question. Pages then
// compose them.

export function canBidOnJobs(user) {
  return isHelperClassMode(user);
}

export function canListTools(user) {
  const m = getMode(user);
  return m === 'tool_owner' || m === 'helper' || m === 'business_owner';
}

export function canManageBusinesses(user) {
  const m = getMode(user);
  return m === 'business_owner' || m === 'helper' || m === 'business_manager' || m === 'admin';
}

// Pro entitlement is granted by an active first-year trial or a paid legacy
// tier. Role checks remain separate because some Pro tools are intentionally
// limited to helper-class accounts.
export function hasProAccess(user) {
  if (!user) return false;
  const status = String(user.subscription_status || '').toLowerCase();
  const subscriptionCurrent = !status || ['active', 'trialing'].includes(status);
  if (['helper_pro', 'broker'].includes(user.role) && subscriptionCurrent) return true;
  const legacyTier = String(user.membership_tier || '').toLowerCase();
  if (['pro', 'tier2'].includes(legacyTier)) return true;
  if (user.trial_ends_at && new Date(user.trial_ends_at).getTime() > Date.now()) return true;
  if (status && !['active', 'trialing'].includes(status)) return false;
  const tier = String(user.effective_tier || user.tier || '').toLowerCase();
  if (['pro', 'tier2', 'premium', 'elite'].includes(tier)) return true;
  return false;
}

// Business Hub gate, projection-only (WP-104): an organization membership
// opens the hub. An active customer with an open access request can prepare
// private drafts; the API enforces owner approval when they publish. A
// missing projection opens nothing — the hub needs the projection to know
// which organizations the account belongs to.
export function hasBusinessHubAccess(projection) {
  if (!projectionActive(projection)) return false;
  const { access, flags } = projection;
  if ((access.organizations || []).length > 0) return true;
  return Boolean(flags?.accessRequests && (access.personal || []).includes('customer'));
}

// QR code creation and saved-code storage are Pro features on the API.
// Keep the client entitlement check aligned with server/routes/qrCodes.js so
// users without access do not see a page that can only fail with 403.
export function canUseQrGenerator(user) {
  return Boolean(user && hasProAccess(user));
}

export function canOfferConsulting(user) {
  return getMode(user) === 'consultant';
}

export function canSeeLifeFeatures(user) {
  // Life Pulse / planned needs / vehicles / homes are universal to the
  // personal side — show them to anyone in a customer-class mode.
  return isCustomerClassMode(user);
}

export function canSeeFranchiseApplications(user) {
  return getMode(user) === 'franchise_applicant';
}

export function canSeeSupportAgentPortal(user) {
  return getMode(user) === 'business_support_agent';
}

// ── Settings sidebar visibility ──────────────────────────────────────────────
// Returns a Set of tab keys the user should see in /settings for their mode.
// Used to rewrite SettingsPage TABS.

export function settingsTabsForMode(user) {
  const m = getMode(user);
  const base = new Set([
    'profile', 'security', 'subscription', 'notifications',
    'referral', 'privacy', 'account', 'danger',
  ]);
  if (canListTools(user)) base.add('toolRentals');
  if (canManageBusinesses(user)) base.add('businesses');
  // Helper-class modes additionally get the Payment Policies tab (Stripe
  // Connect, payout schedule, etc.).
  if (isHelperClassMode(user)) base.add('paymentPolicies');
  if (canSeeLifeFeatures(user)) base.add('life');
  return base;
}

// ── Navbar link visibility ───────────────────────────────────────────────────

export function navLinksForMode(user, projection = null) {
  const m = getMode(user);
  const links = {
    showBrowseJobs: true,
    // WP-104: posting a job is a customer-workspace action, open to any
    // signed-in account; the old mode allow-list is deleted.
    showPostJob: !!user,
    showMessages: !!user,
    showDashboard: !!user,
    showBusinessHub: hasBusinessHubAccess(projection),
    showQRGenerator: canUseQrGenerator(user),
    showToolRentalsBrowse: true,
    showConsultingPortal: m === 'consultant',
    showLaunchStatus: m === 'franchise_applicant' || m === 'consultant',
    showSupportWorkspace: m === 'business_support_agent',
  };
  return links;
}

export default {
  isHelperClassMode,
  isCustomerClassMode,
  dashboardKeyForMode,
  canBidOnJobs,
  canListTools,
  canManageBusinesses,
  hasProAccess,
  hasBusinessHubAccess,
  canUseQrGenerator,
  canOfferConsulting,
  canSeeLifeFeatures,
  canSeeFranchiseApplications,
  canSeeSupportAgentPortal,
  settingsTabsForMode,
  navLinksForMode,
};
