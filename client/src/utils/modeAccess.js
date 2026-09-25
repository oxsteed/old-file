// client/src/utils/modeAccess.js
//
// One place that maps a user's default_mode → UI visibility flags. The legacy
// codebase uses `isHelper` (from AuthContext) in dozens of places; that flag
// stays correct because we keep users.role in lockstep with default_mode on
// the server (see server/utils/modeRole.js). This util just adds mode-aware
// flags where role wasn't fine-grained enough — primarily for navbar links,
// settings sidebar items, and dashboard widget selection.

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

export function canPostJobs(user) {
  // Customers + helpers (who sometimes need help themselves) + life mode all
  // can post jobs. Franchise applicants can too — they often need vendors.
  const m = getMode(user);
  return ['customer', 'investor', 'helper', 'business_owner', 'tool_owner', 'consultant', 'life_only', 'franchise_applicant'].includes(m);
}

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
  if (['helper_pro', 'broker'].includes(user.role)) return true;
  const tier = String(user.effective_tier || user.membership_tier || '').toLowerCase();
  if (['pro', 'tier2'].includes(tier)) return true;
  return Boolean(user.trial_ends_at && new Date(user.trial_ends_at).getTime() > Date.now());
}

// Business Hub gate — helper-class modes (helper, business_owner, team roles)
// aligned with SmartDashboard families that operate workspaces.
export function canAccessBusinessHub(user) {
  if (!user) return false;
  if (isHelperClassMode(user)) return true;
  return ['admin', 'super_admin'].includes(user.role) || getMode(user) === 'admin';
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

export function navLinksForMode(user) {
  const m = getMode(user);
  const links = {
    showBrowseJobs: true,
    showPostJob: canPostJobs(user),
    showMessages: !!user,
    showDashboard: !!user,
    showBusinessHub: canAccessBusinessHub(user),
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
  canPostJobs,
  canBidOnJobs,
  canListTools,
  canManageBusinesses,
  hasProAccess,
  canAccessBusinessHub,
  canUseQrGenerator,
  canOfferConsulting,
  canSeeLifeFeatures,
  canSeeFranchiseApplications,
  canSeeSupportAgentPortal,
  settingsTabsForMode,
  navLinksForMode,
};
