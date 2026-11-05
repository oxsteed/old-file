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

// Weekly self-audit 2026-11-04 item 2: life_only, tool_owner, consultant,
// and franchise_applicant are real modes (MODE_CATALOG + routeForMode in
// modeRouter.js already cover them, and dashboardKeyForMode already maps
// them to their dashboards), but they were missing here, so
// normalizeLaunchDashboardMode silently fell them back to helper/customer
// and their SmartDashboard branches could never run. Adding them restores
// their dashboards without touching customer, helper, business_owner, or
// admin mappings. Side effect, intended: ModeSwitcher can now offer these
// modes (it filters by this same set), and ModeHomeRoute sends life_only
// and franchise_applicant users to their dashboard instead of Discovery.
export const LAUNCH_SWITCHER_MODES = new Set([
  ...LAUNCH_SELF_SELECTABLE_MODES,
  ...LAUNCH_GRANTED_MODES,
  'admin',
  'life_only',
  'tool_owner',
  'consultant',
  'franchise_applicant',
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
  // 2026-11-02 admin-ops audit item 15: affiliate defaults OFF to match
  // the affiliate API gate (AFFILIATE_ENABLED unset means the API 503s).
  // With this off, /affiliate redirects to /dashboard and affiliate UI
  // does not render until /api/launch-visibility overrides it at boot.
  affiliateRewards: false,
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
  // Weekly self-audit 2026-11-04 item 1: consulting and franchise are real
  // launch keys, not new flags. The server already gates their APIs
  // (CONSULTING_ENABLED, FRANCHISE_ENABLED, both default off), and
  // /api/launch-visibility serves them through LAUNCH_KEY_ENV, so the boot
  // fetch overrides these build-time defaults. Both stay false here; only
  // an env flip plus a redeploy turns either surface on.
  consulting: false,
  // Review P3-7-F09: build-time default only. The server is the single source
  // of truth; main.jsx fetches /api/launch-visibility at boot and overrides
  // this via applyServerLaunchVisibility().
  // Weekly self-audit 2026-11-04 item 12: false to match the server default
  // (OXSTEED_MEDIA_LAUNCHED, default off). The old true default meant a
  // failed or timed-out boot fetch rendered Media UI against gated Media
  // APIs, the exact failure mode P3-7-F09 was built to prevent.
  oxsteedMedia: false,
  discoverEverything: false,
  footerUtilityPills: true,
  // Weekly self-audit 2026-11-04 item 1: mirrors FRANCHISE_ENABLED on the
  // server (default off). See the consulting comment above.
  franchise: false,
  // UI gaps item 2: mirrors OXSTEED_LAUNCH_INVESTOR on the server
  // (default off). The investor routes previously had no launch key at
  // all, so their redirects were unconditional and investor login could
  // never land on its own dashboard. With this key the redirects are
  // flag-conditional like franchise/consulting: off keeps today's bounce
  // to /login and /dashboard, on lets the investor routes render.
  investor: false,
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
  // Full launch map from /api/launch-visibility. Only keys the client knows
  // (LAUNCH_DEFAULTS) and only boolean values are applied, so an unknown or
  // malformed server value can never flip a surface.
  if (patch.launches && typeof patch.launches === 'object') {
    for (const key of Object.keys(LAUNCH_DEFAULTS)) {
      if (typeof patch.launches[key] === 'boolean') LAUNCH_VISIBILITY[key] = patch.launches[key];
    }
  }
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

// Weekly self-audit 2026-11-04 item 1: this table used to be flag-blind,
// so flipping a launch flag could never restore its routes. Entries with a
// `flag` redirect only while that LAUNCH_VISIBILITY key is off; when the
// flag turns on, the route renders. Entries without a `flag` have no owning
// launch flag in the client or on the server, so their redirect is
// intentional and unconditional until a flag is defined for that product;
// each such entry says so below rather than pretending a flag restores it.
// The previous comment on /discover claimed flipping discoverEverything
// restores it; that was false before this change because the code never
// checked the flag. It is true now.
const LAUNCH_ROUTE_REDIRECTS = Object.freeze([
  // Review P1-7-F01 (by design): /discover is the "Discover Everything"
  // cross-entity search surface (DiscoverPage.jsx: helpers, jobs,
  // businesses, tools, products). While discoverEverything is off it
  // redirects to /jobs, the launched discovery surface.
  { prefix: '/discover', to: '/jobs', flag: 'discoverEverything' },
  // No owning flag: translator has no launch key on either side, so this
  // redirect stays unconditional until one is defined.
  { prefix: '/translator', to: '/' },
  // No routes exist for these paths in App.jsx; the redirect is a legacy
  // deep-link catch so old links land on /restaurants instead of NotFound,
  // not a launch gate.
  { prefix: '/cart', to: '/restaurants' },
  { prefix: '/shared-cart', to: '/restaurants' },
  { prefix: '/checkout', to: '/restaurants' },
  // UI gaps item 2: investor now has a launch key (OXSTEED_LAUNCH_INVESTOR,
  // default off), so these redirects are flag-conditional like
  // franchise/consulting. Off keeps today's bounce to /login and
  // /dashboard; on lets the investor routes render.
  { prefix: '/investor/login', to: '/login', flag: 'investor' },
  { prefix: '/investor', to: '/dashboard', flag: 'investor' },
  // Review P3-7-F06: /affiliate is gated by the affiliateRewards flag rather
  // than a static redirect, so the flag has a real consumer.
  // No owning flag for the entries below: network, planned-needs, car-care,
  // upgrade, promote, and business-launch-status have no launch key on
  // either side (networkBranchSwitcher gates only the branch switcher, not
  // the /network product; businessAscension gates a HomePage upsell, not
  // the launch-status page). Their redirects stay unconditional until a
  // flag is defined for each product.
  { prefix: '/network', to: '/dashboard' },
  { prefix: '/planned-needs', to: '/dashboard' },
  { prefix: '/car-care', to: '/dashboard' },
  { prefix: '/upgrade', to: '/dashboard' },
  { prefix: '/templates', to: '/business-hub', flag: 'templates' },
  { prefix: '/promote', to: '/business-hub' },
  { prefix: '/consultant-availability', to: '/calendar', flag: 'consulting' },
  { prefix: '/consulting', to: '/business-hub', flag: 'consulting' },
  { prefix: '/business-launch-status', to: '/business-hub' },
  { prefix: '/franchise', to: '/business-hub', flag: 'franchise' },
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

  return LAUNCH_ROUTE_REDIRECTS.find(({ prefix, flag }) => matchesPathPrefix(normalizedPath, prefix)
    && (!flag || !LAUNCH_VISIBILITY[flag]))?.to || null;
}

export function normalizeLaunchDashboardMode(mode, role) {
  if (LAUNCH_SWITCHER_MODES.has(mode)) return mode;
  if (['admin', 'super_admin'].includes(role)) return 'admin';
  if (role === 'support_agent') return 'business_support_agent';
  return ['helper', 'helper_pro', 'broker'].includes(role) ? 'helper' : 'customer';
}
