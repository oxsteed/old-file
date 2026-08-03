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

export const LAUNCH_VISIBILITY = Object.freeze({
  affiliateRewards: false,
  aiKnowledge: false,
  backgroundChecks: false,
  businessAscension: false,
  discoverEverything: false,
  footerUtilityPills: false,
  genericQrGenerator: false,
  helperEarnings: false,
  helperGrowthCenter: false,
  helperInvoices: false,
  networkBranchSwitcher: false,
  personalLifeDashboard: false,
  productMarketplace: false,
  resourcesMenu: false,
  subscriptions: false,
  templates: false,
  toolRentals: false,
  vortexWorkspaceEntry: false,
});

export function isLaunchSelfSelectableMode(mode) {
  return LAUNCH_SELF_SELECTABLE_MODES.includes(mode);
}

