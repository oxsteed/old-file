const VORTEX_CLIENT_ENABLED = import.meta.env?.VITE_VORTEX_ENABLED === 'true';

// Central launch-scope policy.
//
// Future product code and routes intentionally remain in the repository. Public
// entry points consume this module so a later release can restore a surface in
// one place without deleting or rediscovering its implementation.

export const LAUNCH_SELF_SELECTABLE_MODES = Object.freeze([
  'customer',
  'helper',
  'business_owner',
]);

export const LAUNCH_GRANTED_MODES = Object.freeze([
  'business_manager',
  'business_representative',
  'business_employee',
  'business_support_agent',
]);

export const LAUNCH_SWITCHER_MODES = new Set([
  ...LAUNCH_SELF_SELECTABLE_MODES,
  ...LAUNCH_GRANTED_MODES,
  'admin',
]);

export const LAUNCH_SETTINGS_TABS = new Set([
  'profile',
  'security',
  'businesses',
  'notifications',
  'privacy',
  'account',
  'danger',
  // Review P2-2-F08: W-9 tax documents tab (helper-only; SettingsPage
  // filters it by role). The requireTaxIdentity payout gate is otherwise
  // unsatisfiable in-app.
  'tax',
]);

export const LAUNCH_BUSINESS_HUB_TABS = new Set([
  'overview',
  'analytics',
  'profile',
  'clients',
  'services',
  'messages',
  'calendar',
  'invoices',
  'team',
  'hiring',
  // Review P2-9-F04: intake triage tabs. Submitted intakes notify the owner
  // with a deep link to the matching operations tab; without these entries
  // isBusinessHubTabLaunched bounced the link to overview and owners could
  // not open the intake in-product.
  'beauty-ops',
  'creative-ops',
  'continuity-ops',
  'professional-ops',
  'trades-ops',
  'maintenance',
]);

export const LAUNCH_DEFAULTS = Object.freeze({
  affiliateRewards: true,
  aiKnowledge: false,
  backgroundChecks: false,
  businessAscension: false,
  businessHubAdvancedOps: false,
  businessHubFinancialPlanning: false,
  businessHubGrowthTools: false,
  businessHubProductCommerce: false,
  businessHubRoleMenu: false,
  businessHubRoleMenuWidgets: false,
  businessHubSpecializedTemplates: false,
  // Review P3-943: the Vortex APIs return 503 unless the server sets
  // VORTEX_ENABLED. The client mirrors it via VITE_VORTEX_ENABLED (set both).
  businessHubVortexAccess: VORTEX_CLIENT_ENABLED,
  // Review P3-7-F09: build-time default only. The server is the single source
  // of truth; main.jsx fetches /api/launch-visibility at boot and overrides
  // this via applyServerLaunchVisibility().
  oxsteedMedia: true,
  discoverEverything: false,
  footerUtilityPills: true,
  genericQrGenerator: false,
  helperEarnings: true,
  helperGrowthCenter: false,
  helperInvoices: true,
  jobEscrowLabels: true,
  jobMaterialsLogistics: false,
  networkBranchSwitcher: false,
  personalLifeDashboard: false,
  productMarketplace: false,
  resourcesMenu: false,
  specializedProfileTemplates: false,
  subscriptions: false,
  templates: false,
  toolRentals: true,
  vortexWorkspaceEntry: VORTEX_CLIENT_ENABLED,
});

// Review P3-7-F09: the server is the single source of truth for launch state.
// main.jsx fetches /api/launch-visibility at boot and calls
// applyServerLaunchVisibility() before first render, which mutates this
// object in place. It is intentionally NOT frozen: every existing
// `LAUNCH_VISIBILITY.x` read pattern (render-time reads, default parameters,
// getLaunchRedirect) then sees the server-supplied values. LAUNCH_DEFAULTS
// stays frozen as the pristine build-time reference.
export const LAUNCH_VISIBILITY = { ...LAUNCH_DEFAULTS };

export function applyServerLaunchVisibility(patch) {
  if (!patch || typeof patch !== 'object') return;
  if (typeof patch.media === 'boolean') LAUNCH_VISIBILITY.oxsteedMedia = patch.media;
}

export function isBusinessHubTabLaunched(tab) {
  if (tab === 'media') return LAUNCH_VISIBILITY.oxsteedMedia;
  // Review P3-7-F06: the Products tab is launch-gated by
  // businessHubProductCommerce so flipping the flag restores it in one place.
  if (tab === 'products') return LAUNCH_VISIBILITY.businessHubProductCommerce;
  return LAUNCH_BUSINESS_HUB_TABS.has(tab);
}

export function isLaunchSelfSelectableMode(mode) {
  return LAUNCH_SELF_SELECTABLE_MODES.includes(mode);
}

const LAUNCH_ROUTE_REDIRECTS = Object.freeze([
  // Review P1-7-F01 (by design): /discover is the "Discover Everything"
  // cross-entity search surface (DiscoverPage.jsx: helpers, jobs,
  // businesses, tools, products). It is unlaunched (discoverEverything is
  // false and the HomePage discover tab only renders when the flag is on),
  // so the route intentionally redirects to /jobs, the launched discovery
  // surface. Flipping discoverEverything to true restores it in one place.
  { prefix: '/discover', to: '/jobs' },
  { prefix: '/translator', to: '/' },
  { prefix: '/cart', to: '/restaurants' },
  { prefix: '/shared-cart', to: '/restaurants' },
  { prefix: '/checkout', to: '/restaurants' },
  { prefix: '/investor/login', to: '/login' },
  { prefix: '/investor', to: '/dashboard' },
  // Review P3-7-F06: /affiliate is gated by the affiliateRewards flag rather
  // than a static redirect, so the flag has a real consumer.
  { prefix: '/network', to: '/dashboard' },
  { prefix: '/planned-needs', to: '/dashboard' },
  { prefix: '/car-care', to: '/dashboard' },
  { prefix: '/upgrade', to: '/dashboard' },
  { prefix: '/templates', to: '/business-hub' },
  { prefix: '/promote', to: '/business-hub' },
  { prefix: '/consultant-availability', to: '/calendar' },
  { prefix: '/consulting', to: '/business-hub' },
  { prefix: '/business-launch-status', to: '/business-hub' },
  { prefix: '/franchise', to: '/business-hub' },
]);

function mediaLaunchRedirect(pathname) {
  if (!LAUNCH_VISIBILITY.oxsteedMedia && (pathname === '/media' || pathname.startsWith('/media/'))) {
    return '/';
  }
  return null;
}

function matchesPathPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getLaunchRedirect(pathname = '/') {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const mediaRedirect = mediaLaunchRedirect(normalizedPath);
  if (mediaRedirect) return mediaRedirect;
  // Review P3-7-F14: removed the unconditional /orders/:id -> /orders
  // rewrite. It fired in LaunchScopeRouteGate before the route's own
  // OrderIdRedirect, so order-detail deep links bounced to the order list
  // instead of the canonical /food/orders/:id. The router owns that mapping.
  const specialtyMatch = normalizedPath.match(
    /^\/business\/([^/]+)\/(?:maintenance-request|trades-request|beauty-intake|creative-intake|professional-intake|continuity-intake|ai-preview)(?:\/|$)/,
  );
  // Review P2-9-F11: the specialty template-intake pages are launch-gated by
  // specializedProfileTemplates (BusinessProfilePage only links them when the
  // flag is on). Bounce them to the business profile only while the flag is
  // off; when launched, the pages must be reachable.
  if (specialtyMatch && !LAUNCH_VISIBILITY.specializedProfileTemplates) {
    return `/business/${specialtyMatch[1]}`;
  }
  if (matchesPathPrefix(normalizedPath, '/dashboard/ai-preview')) return '/dashboard';

  // The affiliate dashboard is launch-gated: while affiliateRewards is off,
  // /affiliate (and its subpaths) redirect to the dashboard.
  if (!LAUNCH_VISIBILITY.affiliateRewards && matchesPathPrefix(normalizedPath, '/affiliate')) {
    return '/dashboard';
  }

  return LAUNCH_ROUTE_REDIRECTS.find(({ prefix }) => matchesPathPrefix(normalizedPath, prefix))?.to || null;
}

export function normalizeLaunchDashboardMode(mode, role) {
  if (LAUNCH_SWITCHER_MODES.has(mode)) return mode;
  if (['admin', 'super_admin'].includes(role)) return 'admin';
  if (role === 'support_agent') return 'business_support_agent';
  return ['helper', 'helper_pro', 'broker'].includes(role) ? 'helper' : 'customer';
}
