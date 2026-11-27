// Adaptive navigation is a display projection, never an authorization policy.
// The server-owned GET /api/me/access snapshot is the only source of protected
// destinations. Persona labels are descriptive metadata used to group and
// emphasize links; they cannot grant access.

export const PERSONA_NAVIGATION_CATALOG = Object.freeze([
  { id: 'customer', variants: ['customer', 'restaurant_customer'], scope: 'personal', primary: 'home', setup: [], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'helper', variants: ['helper', 'helper_pro', 'broker'], capability: 'helper.offer_services', scope: 'personal', primary: 'helper-dashboard', setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'business-owner', variants: ['business_owner'], capability: 'business.own', scope: 'business', primary: 'business-workspace', setup: ['/business-launch-status'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'business-team', variants: ['business_manager', 'business_representative', 'business_employee', 'business_support_agent'], scope: 'business-membership', primary: 'business-workspace', setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'restaurant-owner', variants: ['restaurant_owner'], capability: 'restaurant.own', scope: 'restaurant', primary: 'restaurant-workspace', setup: ['/business-launch-status'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'restaurant-team', variants: ['restaurant_manager', 'restaurant_staff', 'restaurant_runner'], scope: 'restaurant-location', primary: 'restaurant-workspace', setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'logistics', variants: ['logistics', 'delivery', 'dispatcher', 'driver'], capability: 'logistics.ship', scope: 'personal-or-assignment', primary: 'logistics', setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'consultant', variants: ['consultant'], capability: 'consultant.accept_paying_clients', scope: 'personal', primary: 'consulting', setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'equipment-owner', variants: ['tool_owner', 'equipment_owner'], capability: 'tool_owner.list_equipment', scope: 'personal', primary: 'equipment', setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'franchise', variants: ['franchise_operator', 'franchise_applicant'], capability: 'franchise.operate', scope: 'territory', primary: 'franchise', setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'investor-reporting', variants: ['investor'], capability: 'investor.reporting', scope: 'reporting-audience', primary: 'investor-reporting', setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'credit-participant', variants: ['credit_participant', 'credit_member'], scope: 'credit-account', primary: 'credit', setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'partner-affiliate', variants: ['partner', 'affiliate'], scope: 'personal-or-partner', primary: 'partner', setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'workforce-learning', variants: ['workforce', 'learner', 'instructor'], scope: 'personal-or-program', primary: 'learn', setup: ['/learn'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'reviewer', variants: ['reviewer'], scope: 'staff', primary: 'staff-shell', setup: [], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'support-agent', variants: ['support_agent'], scope: 'staff', primary: 'staff-shell', setup: [], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'operations-staff', variants: ['admin', 'super_admin', 'operations'], scope: 'staff', primary: 'staff-shell', setup: [], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'device-service-account', variants: ['device', 'service_account', 'kiosk'], scope: 'nonhuman', primary: null, setup: [], surfaces: [] },
]);

const link = (id, to, labelKey, extra = {}) => ({ id, to, labelKey, primary: false, ...extra });
const STAFF_CAPABILITIES = new Set(['staff.review', 'staff.support', 'admin.access', 'manage_operations']);

// Account-menu sections. The flat `account` array keeps its build order
// (tests pin the ids) and grouping happens at render time via
// groupAccountItems(). An item without a known section falls into
// 'account' so it is never lost from the menu.
export const ACCOUNT_MENU_SECTIONS = Object.freeze([
  { id: 'lead', labelKey: null },
  { id: 'money', labelKey: 'nav.sectionMoney' },
  { id: 'ordersWork', labelKey: 'nav.sectionOrdersWork' },
  { id: 'business', labelKey: 'nav.sectionBusiness' },
  { id: 'learn', labelKey: 'nav.sectionLearnEarn' },
  { id: 'account', labelKey: 'nav.sectionAccount' },
]);

// Persona family -> menu section for the contextual shortcuts
// addPersonaLinks() adds. Kept out of PERSONA_NAV_TARGETS so the
// investPages file-shape assertion on that literal keeps matching.
const PERSONA_SECTION = Object.freeze({
  helper: 'ordersWork',
  'business-owner': 'business',
  'business-team': 'business',
  'restaurant-owner': 'business',
  'restaurant-team': 'business',
  logistics: 'ordersWork',
  consultant: 'ordersWork',
  'equipment-owner': 'business',
  franchise: 'business',
  'investor-reporting': 'money',
});

export function groupAccountItems(items) {
  const groups = ACCOUNT_MENU_SECTIONS.map((section) => ({ ...section, items: [] }));
  for (const item of items || []) {
    const section = ACCOUNT_MENU_SECTIONS.some((s) => s.id === item.section) ? item.section : 'account';
    groups.find((g) => g.id === section).items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

const PROJECTION_NOTICE_STATES = new Set(['loading', 'temporary_failure', 'rollback']);
const PERSONA_NAV_TARGETS = Object.freeze({
  helper: [
    { id: 'persona-helper-opportunities', to: '/jobs', labelKey: 'nav.browseJobs' },
    { id: 'persona-helper-work', to: '/helper-dashboard', labelKey: 'nav.myWork' },
  ],
  'business-owner': [{ id: 'persona-business-workspace', to: '/business-hub', labelKey: 'nav.businessWorkspace' }],
  'restaurant-owner': [{ id: 'persona-restaurant-workspace', to: '/restaurants/merchant', labelKey: 'progressiveAccess.capabilities.restaurant.own' }],
  logistics: [
    { id: 'persona-logistics-buyer', to: '/logistics/buyer', labelKey: 'logistics.nav.buyer' },
    { id: 'persona-logistics-organizer', to: '/logistics/organizer', labelKey: 'logistics.nav.organizer' },
  ],
  consultant: [{ id: 'persona-consulting', to: '/consulting/contractor-dashboard', labelKey: 'consultantContractorDashboard.page.title' }],
  'equipment-owner': [{ id: 'persona-equipment', to: '/tool-rentals/analytics', labelKey: 'progressiveAccess.capabilities.tool_owner.list_equipment' }],
  franchise: [{ id: 'persona-franchise', to: '/franchise/territory', labelKey: 'progressiveAccess.capabilities.franchise.operate' }],
  'investor-reporting': [{ id: 'persona-investments', to: '/investments', labelKey: 'nav.investments' }],
  // G-9: credit-participant, partner-affiliate, and workforce-learning have
  // no registry capability (no credit.*, partner.*, or workforce.* key
  // exists), so they have no persona target here. /oxsteed-credit,
  // /affiliate, and /learn are linked from the customer baseline account
  // menu below instead, reachable without a grant and promising none.
});

function isProjectionReady(projection) {
  return !!(projection?.flags?.accessProjection && projection?.access);
}

// G-40: catalog `primary` values used to be symbolic ids no code read.
// This map is the single place a primary becomes a route, and
// ModeHomeRoute consumes it (see G-13). Every value is a route registered
// in App.jsx. `staff-shell` has no entry on purpose: staff reach
// /support/agent through the separate staff-shell check, never through a
// catalog primary.
const PRIMARY_ROUTES = Object.freeze({
  home: '/',
  'helper-dashboard': '/helper-dashboard',
  'business-workspace': '/business-hub',
  'restaurant-workspace': '/restaurants/merchant',
  logistics: '/logistics',
  consulting: '/consulting/contractor-dashboard',
  equipment: '/tool-rentals/analytics',
  franchise: '/franchise/territory',
  'investor-reporting': '/investments',
  credit: '/oxsteed-credit',
  partner: '/affiliate',
  learn: '/learn',
});

export function familyForMode(mode) {
  if (!mode) return null;
  return PERSONA_NAVIGATION_CATALOG.find((family) => (family.variants || []).includes(mode)) || null;
}

/**
 * Resolve a catalog family's `primary` to a working route, or null.
 * Only a family whose capability the projection actually backs (and whose
 * activation is ready) resolves. The seven capability-less families never
 * gain a nav target from this map, and investor reporting additionally
 * needs its audience. Customer resolves to '/' (the real home).
 */
export function primaryRouteForFamily(familyId, projection) {
  const family = PERSONA_NAVIGATION_CATALOG.find((entry) => entry.id === familyId);
  if (!family || !family.primary) return null;
  const to = PRIMARY_ROUTES[family.primary];
  if (!to) return null;
  if (family.id === 'customer') return to;
  if (!family.capability || !hasCapability(projection, family.capability)) return null;
  if (!activationReady(projection, family.capability)) return null;
  if (family.id === 'investor-reporting' && !projection?.access?.investorAudience) return null;
  return to;
}

function setupLinksFor(familyId) {
  const family = PERSONA_NAVIGATION_CATALOG.find((entry) => entry.id === familyId);
  return (family?.setup || []).filter((to) => typeof to === 'string' && to.startsWith('/'));
}

function isNonhuman(projection) {
  const access = projection?.access || {};
  return access.actorType === 'nonhuman' || access.subjectType === 'device' || access.subjectType === 'service_account' || projection?.subject?.type === 'nonhuman';
}

function hasCapability(projection, capability) {
  const access = projection?.access;
  if (!access || !capability) return false;
  if ((access.personal || []).includes(capability)) return true;
  if ((access.organizations || []).some((scope) => (scope.capabilities || scope.access || []).includes(capability))) return true;
  // The server projects organizations as { type, id, name, role } with no
  // capabilities array (resolver.project), so ownership capabilities resolve
  // from the owner role, mirroring accessProjection.hasCapability. Without
  // this, business.own / restaurant.own could never be held in nav even
  // though the account owns the business.
  if (capability === 'business.own' || capability === 'restaurant.own') {
    return (access.organizations || []).some((scope) => scope && scope.role === 'owner');
  }
  return false;
}

function activationReady(projection, capability) {
  const state = projection?.access?.activation?.[capability] || projection?.activation?.[capability];
  if (state == null) return true;
  if (state === false || state === 'pending' || state === 'incomplete' || state === 'needs_setup') return false;
  if (typeof state === 'object' && state.ready === false) return false;
  return true;
}

function addUnique(target, item) {
  if (!target.some((existing) => existing.id === item.id || existing.to === item.to)) target.push(item);
}

function addPersonaLinks(target, projection, approved) {
  for (const family of PERSONA_NAVIGATION_CATALOG) {
    if (!family.capability || !approved(family.capability)) continue;
    if (family.id === 'investor-reporting' && !projection?.access?.investorAudience) continue;
    for (const item of PERSONA_NAV_TARGETS[family.id] || []) {
      addUnique(target, link(item.id, item.to, item.labelKey, {
        protected: true,
        persona: family.id,
        section: PERSONA_SECTION[family.id] || 'account',
        ...(item.reportingOnly ? { reportingOnly: true } : {}),
      }));
    }
  }
}

function organizationLinks(projection) {
  const organizations = [
    ...(projection?.access?.organizations || []),
    ...(projection?.access?.locations || []),
  ];
  const links = [];
  for (const scope of organizations) {
    const scopeId = scope && (scope.id ?? scope.business_id);
    if (!scope || scopeId == null) continue;
    const type = scope.type || scope.scopeType;
    const isRestaurantLocation = type === 'restaurant_location' || type === 'restaurant-location';
    // Restaurant tools are opt-in per assigned location. Never infer them from
    // a role string or a generic organization membership.
    if (isRestaurantLocation) {
      for (const tool of scope.shortcuts || scope.navigation || []) {
        if (!tool || !tool.to || tool.protected === false) continue;
        links.push(link(`restaurant-${scopeId}-${tool.id || tool.to}`, tool.to, tool.labelKey || 'nav.businessWorkspace', { scopeId: String(scopeId), protected: true, section: 'business' }));
      }
      // The parent workspace comes from its business membership above.
      // A location ID identifies location tools, never a business workspace.
      continue;
    }
    links.push(link(`workspace-${scopeId}`, `/business/${encodeURIComponent(scopeId)}/workspace`, scope.name || scope.business_name || 'nav.businessWorkspace', { scopeId: String(scopeId), workspace: true, protected: true, section: 'business' }));
  }
  return links;
}

/** Return one shared navigation model for all responsive presentations. */
export function deriveAdaptiveNavigation(projection, { showSupportWorkspace = false } = {}) {
  // G-41: the projection can be slow or failed while the nav renders
  // customer-only. Fail-closed stays, but surface the state so the user
  // knows workspace links are unavailable and retrying instead of gone.
  // Only the transient hook states signal it; unauthenticated and
  // restricted render customer-only with no notice.
  const projectionNotice = !isProjectionReady(projection) && PROJECTION_NOTICE_STATES.has(projection?.status)
    ? projection.status
    : null;
  if (isNonhuman(projection)) return { mode: 'none', primary: [], account: [], workspaces: [], personas: [], surfaces: [], projectionNotice: null };

  const primary = [
    link('findHelp', '/helpers', 'nav.findHelp'),
    link('myJobs', '/my-jobs', 'nav.myJobs'),
    link('orderFood', '/restaurants', 'nav.orderFood'),
    link('messages', '/messages', 'nav.messages'),
    link('postJob', '/post-job', 'nav.postJob', { primary: true }),
  ];
  const account = [
    link('dashboard', '/dashboard', 'nav.dashboard', { section: 'lead' }),
    link('foodOrders', '/orders', 'nav.foodOrders', { section: 'ordersWork' }),
    link('applications', '/settings/applications', 'nav.myApplications', { count: isProjectionReady(projection) ? Number(projection.access.openRequestCount || 0) : 0 }),
    // G-9: these pages have no grant behind them, so they live in the
    // customer baseline, not behind a persona capability. They are reachable
    // for every signed-in account and promise no access.
    link('credit', '/oxsteed-credit', 'nav.credit', { section: 'money' }),
    link('partner', '/affiliate', 'nav.partner', { section: 'learn' }),
    link('learning', '/learn', 'nav.learning', { section: 'learn' }),
  ];
  if (!isProjectionReady(projection)) {
    account.push(link('settings', '/settings', 'nav.settings', { section: 'account' }), link('help', '/support', 'nav.help', { section: 'account' }), link('wallet', '/wallet', 'nav.wallet', { section: 'money' }), link('statements', '/statements', 'statementCenter.title', { section: 'money' }));
    return { mode: 'customer', primary, account, workspaces: [], personas: ['customer'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'], showBusinessSwitcher: false, projectionNotice };
  }

  const access = projection.access;
  const personas = PERSONA_NAVIGATION_CATALOG.filter((family) => family.capability ? hasCapability(projection, family.capability) : false).map((family) => family.id);
  const workspaces = organizationLinks(projection);
  const hasBusinessWorkspace = workspaces.some((item) => item.workspace);
  const approved = (capability) => hasCapability(projection, capability) && activationReady(projection, capability);
  if (approved('helper.offer_services')) {
    addUnique(account, link('browseJobs', '/jobs', 'nav.browseJobs', { protected: true, section: 'ordersWork' }));
    addUnique(account, link('myWork', '/helper-dashboard', 'nav.myWork', { protected: true, section: 'ordersWork' }));
  } else if (hasCapability(projection, 'helper.offer_services')) {
    addUnique(account, link('helperSetup', '/settings/applications', 'nav.myApplications'));
  }
  if (approved('consultant.accept_paying_clients')) addUnique(account, link('consultantReferrals', '/consulting/contractor-dashboard', 'consultantContractorDashboard.page.title', { protected: true, section: 'ordersWork' }));
  if (approved('logistics.ship')) {
    addUnique(account, link('logisticsBuyer', '/logistics/buyer', 'logistics.nav.buyer', { protected: true, section: 'ordersWork' }));
    addUnique(account, link('logisticsOrganizer', '/logistics/organizer', 'logistics.nav.organizer', { protected: true, section: 'ordersWork' }));
  }
  if (approved('investor.reporting') && access.investorAudience) {
    addUnique(account, link('investments', '/investments', 'nav.investments', { protected: true, section: 'money' }));
  }
  if (hasCapability(projection, 'business.own') && !activationReady(projection, 'business.own')) {
    for (const to of setupLinksFor('business-owner')) addUnique(account, link('businessSetup', to, 'nav.businessLaunchStatus'));
  }
  if (hasCapability(projection, 'restaurant.own') && !activationReady(projection, 'restaurant.own')) {
    for (const to of setupLinksFor('restaurant-owner')) addUnique(account, link('restaurantSetup', to, 'nav.businessLaunchStatus'));
  }
  if (approved('business.own') || approved('restaurant.own') || hasBusinessWorkspace) {
    addUnique(account, link('workspace', '/business-hub', 'nav.businessWorkspace', { protected: true, section: 'business' }));
  }
  for (const workspace of workspaces) addUnique(account, workspace);

  // Every implemented catalog family gets its own contextual shortcut when
  // the projection says its capability is effective and activation is ready.
  // Families without a verified domain destination remain customer-only.
  addPersonaLinks(account, projection, approved);

  // G-9: the dead access.staffRole branch is deleted. resolver.project never
  // emits staffRole, so the clause could never fire. Staff reach the shell
  // through the live /support/agent/me check (showSupportWorkspace) or a
  // staff capability, both above.
  const staffAccess = showSupportWorkspace || (access.personal || []).some((capability) => STAFF_CAPABILITIES.has(capability));
  if (staffAccess) addUnique(account, link('support', '/support/agent', 'nav.supportWorkspace', { staffShell: true, section: 'account' }));
  account.push(link('settings', '/settings', 'nav.settings', { section: 'account' }), link('help', '/support', 'nav.help', { section: 'account' }), link('wallet', '/wallet', 'nav.wallet', { section: 'money' }), link('statements', '/statements', 'statementCenter.title', { section: 'money' }));
  return { mode: 'customer', primary, account, workspaces, personas: personas.length ? personas : ['customer'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'], showBusinessSwitcher: hasBusinessWorkspace, projectionNotice };
}

