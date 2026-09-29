/**
 * Canonical admin route and access contract.
 *
 * Navigation, protected route declarations, and route-contract tests should
 * reference these definitions instead of recreating paths or grants. The
 * server remains authoritative for authorization; the client contract keeps
 * direct navigation and discoverability aligned with it.
 */

const defineRoute = (path, { audience = 'admin', grant = null, superOnly = false } = {}) => Object.freeze({
  path,
  relative: path.replace(/^\/admin\//, ''),
  audience,
  grant,
  superOnly,
});

export const ADMIN_ROUTE_MANIFEST = Object.freeze({
  dashboard: defineRoute('/admin/dashboard'),
  operations: defineRoute('/admin/operations'),
  users: defineRoute('/admin/users'),
  jobs: defineRoute('/admin/jobs'),
  reports: defineRoute('/admin/reports'),
  moderation: defineRoute('/admin/moderation'),
  enforcement: defineRoute('/admin/enforcement'),
  contentRemovals: defineRoute('/admin/content-removals'),
  skills: defineRoute('/admin/skills'),
  support: defineRoute('/admin/support'),
  supportChat: defineRoute('/admin/support/chat'),
  quoteRequests: defineRoute('/admin/quote-requests'),
  directOps: defineRoute('/direct/admin', { audience: 'direct' }),
  directServiceAreas: defineRoute('/admin/direct-service-areas'),
  directCatalog: defineRoute('/admin/direct-catalog'),
  messages: defineRoute('/admin/messages', { grant: 'message_users' }),
  search: defineRoute('/admin/search'),
  businesses: defineRoute('/admin/businesses'),
  toolRentals: defineRoute('/admin/tool-rentals'),
  plannedNeeds: defineRoute('/admin/planned-needs'),
  payments: defineRoute('/admin/payments', { grant: 'view_financials' }),
  orders: defineRoute('/admin/orders'),
  templates: defineRoute('/admin/templates'),
  consulting: defineRoute('/admin/consulting'),
  consultingPayments: defineRoute('/admin/consulting/payments'),
  scheduling: defineRoute('/admin/consulting/scheduler'),
  businessLaunch: defineRoute('/admin/consulting/business-launch'),
  consultingSessions: defineRoute('/admin/consulting/sessions'),
  orgChart: defineRoute('/admin/corporate/org-chart'),
  corporateAssignments: defineRoute('/admin/corporate/assignments'),
  logistics: defineRoute('/admin/logistics'),
  logisticsControl: defineRoute('/admin/logistics/control', { superOnly: true }),
  learnSubmissions: defineRoute('/admin/learn/submissions'),
  learnProductLinks: defineRoute('/admin/learn/product-links'),

  superDashboard: defineRoute('/admin/super/dashboard', { superOnly: true }),
  money: defineRoute('/admin/super/money', { grant: 'view_financials' }),
  restaurantCredit: defineRoute('/admin/super/restaurant-credit', { superOnly: true }),
  oxsteedCredit: defineRoute('/admin/super/oxsteed-credit', { superOnly: true }),
  revenue: defineRoute('/admin/super/revenue', { grant: 'view_financials' }),
  feeConfig: defineRoute('/admin/super/fees', { superOnly: true }),
  pricingConfig: defineRoute('/admin/super/pricing', { superOnly: true }),
  pricingOverrides: defineRoute('/admin/super/pricing-overrides', { superOnly: true }),
  financials: defineRoute('/admin/super/financials', { grant: 'view_financials' }),
  payouts: defineRoute('/admin/super/payouts', { grant: 'view_financials' }),
  conversations: defineRoute('/admin/super/conversations', { superOnly: true }),
  adminAccounts: defineRoute('/admin/super/admin-accounts', { grant: 'manage_admin_accounts' }),
  permissions: defineRoute('/admin/super/permissions', { grant: 'manage_admin_accounts' }),
  regions: defineRoute('/admin/super/regions', { superOnly: true }),
  internalAccess: defineRoute('/admin/super/logistics-internal-access', { superOnly: true }),
  gateLockouts: defineRoute('/admin/super/access-gate-lockouts', { superOnly: true }),
  createUser: defineRoute('/admin/super/users/create', { superOnly: true }),
  searchLogs: defineRoute('/admin/super/search-logs', { superOnly: true }),
  settings: defineRoute('/admin/super/settings', { grant: 'manage_settings' }),
  auditLog: defineRoute('/admin/super/audit-log', { grant: 'view_audit_log' }),
  userActionLog: defineRoute('/admin/super/audit-log/user-actions', { grant: 'view_audit_log' }),
  oneTruth: defineRoute('/admin/super/one-truth', { superOnly: true }),
  franchiseHq: defineRoute('/admin/super/franchises', { superOnly: true }),
  careers: defineRoute('/admin/super/careers', { superOnly: true }),
  countryPacks: defineRoute('/admin/super/country-packs', { superOnly: true }),
  corporateSetup: defineRoute('/admin/super/corporate/departments', { superOnly: true }),
  modePolicies: defineRoute('/admin/super/mode-policies', { superOnly: true }),
  modeApprovals: defineRoute('/admin/super/mode-approvals', { superOnly: true }),
});

export const adminRoute = (key) => {
  const definition = ADMIN_ROUTE_MANIFEST[key];
  if (!definition) throw new Error(`Unknown admin route contract: ${key}`);
  return definition;
};
