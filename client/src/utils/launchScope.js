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

export const LAUNCH_BUSINESS_WORKSPACE_TABS = new Set([
  'overview',
  'profile',
  'clients',
  'services',
  'gallery',
  'policies',
  'faqs',
  'skills',
  'messages',
  'calendar',
  'invoices',
  'team',
]);

export const LAUNCH_VISIBILITY = Object.freeze({
  affiliateRewards: false,
  aiKnowledge: false,
  backgroundChecks: false,
  businessAscension: false,
  discoverEverything: false,
  footerUtilityPills: false,
  genericQrGenerator: false,
  grantedWorkspaceModes: false,
  helperEarnings: false,
  helperGrowthCenter: false,
  helperInvoices: false,
  networkBranchSwitcher: false,
  personalLifeDashboard: false,
  productMarketplace: false,
  restaurantAdvancedOperations: false,
  restaurantCampaigns: false,
  restaurantMerchantPublicEntry: false,
  resourcesMenu: false,
  specializedIntake: false,
  supportWorkspaceEntry: false,
  subscriptions: false,
  templates: false,
  toolRentals: false,
  vortexWorkspaceEntry: false,
});

export function isLaunchSelfSelectableMode(mode) {
  return LAUNCH_SELF_SELECTABLE_MODES.includes(mode);
}

export function launchModeLabelKey(mode, fallbackKey) {
  return mode === 'business_owner'
    ? 'modes.business_owner.launchLabel'
    : fallbackKey;
}

export function launchModeHintKey(mode, fallbackKey) {
  return mode === 'business_owner'
    ? 'modes.business_owner.launchHint'
    : fallbackKey;
}

export function launchRouteForMode(mode) {
  if (mode === 'helper') return '/helper-dashboard';
  if (mode === 'business_owner') return '/restaurants/merchant';
  if (mode === 'admin') return '/admin';
  if (LAUNCH_GRANTED_MODES.includes(mode)) return '/dashboard';
  return '/dashboard';
}

