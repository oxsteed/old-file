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
]);

export const LAUNCH_BUSINESS_HUB_TABS = new Set([
  'overview',
  'profile',
  'clients',
  'services',
  'messages',
  'calendar',
  'invoices',
  'team',
  'hiring',
]);

export const LAUNCH_VISIBILITY = Object.freeze({
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
  businessHubVortexAccess: false,
  oxsteedMedia: true,
  discoverEverything: false,
  footerUtilityPills: true,
  genericQrGenerator: false,
  helperEarnings: false,
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
  vortexWorkspaceEntry: false,
});

export function isLaunchSelfSelectableMode(mode) {
  return LAUNCH_SELF_SELECTABLE_MODES.includes(mode);
}

const LAUNCH_ROUTE_REDIRECTS = Object.freeze([
  { prefix: '/discover', to: '/jobs' },
  { prefix: '/translator', to: '/' },
  { prefix: '/cart', to: '/restaurants' },
  { prefix: '/shared-cart', to: '/restaurants' },
  { prefix: '/checkout', to: '/restaurants' },
  { prefix: '/investor/login', to: '/login' },
  { prefix: '/investor', to: '/dashboard' },
  { prefix: '/affiliate', to: '/dashboard' },
  { prefix: '/vortex', to: '/dashboard' },
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

function matchesPathPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getLaunchRedirect(pathname = '/') {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (/^\/orders\/[^/]+(?:\/|$)/.test(normalizedPath)) return '/orders';
  const specialtyMatch = normalizedPath.match(
    /^\/business\/([^/]+)\/(?:maintenance-request|trades-request|beauty-intake|creative-intake|professional-intake|continuity-intake|ai-preview)(?:\/|$)/,
  );
  if (specialtyMatch) return `/business/${specialtyMatch[1]}`;
  if (matchesPathPrefix(normalizedPath, '/dashboard/ai-preview')) return '/dashboard';

  return LAUNCH_ROUTE_REDIRECTS.find(({ prefix }) => matchesPathPrefix(normalizedPath, prefix))?.to || null;
}

export function normalizeLaunchDashboardMode(mode, role) {
  if (LAUNCH_SWITCHER_MODES.has(mode)) return mode;
  if (['admin', 'super_admin'].includes(role)) return 'admin';
  if (role === 'support_agent') return 'business_support_agent';
  return ['helper', 'helper_pro', 'broker'].includes(role) ? 'helper' : 'customer';
}
