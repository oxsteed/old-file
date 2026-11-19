// Adaptive navigation is a display projection, never an authorization policy.
// The server-owned GET /api/me/access snapshot is the only source of protected
// destinations. Persona labels are descriptive metadata used to group and
// emphasize links; they cannot grant access.

export const PERSONA_NAVIGATION_CATALOG = Object.freeze([
  { id: 'customer', variants: ['customer', 'restaurant_customer'], scope: 'personal', primary: 'home', shortcuts: ['findHelp', 'orderFood'], setup: [], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'helper', variants: ['helper', 'helper_pro', 'broker'], capability: 'helper.offer_services', scope: 'personal', primary: 'helper-dashboard', shortcuts: ['jobs', 'helper-dashboard'], setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'business-owner', variants: ['business_owner'], capability: 'business.own', scope: 'business', primary: 'business-workspace', shortcuts: ['business-workspace'], setup: ['/business-launch/status'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'business-team', variants: ['business_manager', 'business_representative', 'business_employee', 'business_support_agent'], scope: 'business-membership', primary: 'business-workspace', shortcuts: ['business-workspace'], setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'restaurant-owner', variants: ['restaurant_owner'], capability: 'restaurant.own', scope: 'restaurant', primary: 'restaurant-workspace', shortcuts: ['restaurant-workspace'], setup: ['/business-launch/status'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'restaurant-team', variants: ['restaurant_manager', 'restaurant_staff', 'restaurant_runner'], scope: 'restaurant-location', primary: 'restaurant-workspace', shortcuts: ['restaurant-tools'], setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'logistics', variants: ['logistics', 'delivery', 'dispatcher', 'driver'], capability: 'logistics.ship', scope: 'personal-or-assignment', primary: 'logistics', shortcuts: ['logistics-buyer', 'logistics-organizer'], setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'consultant', variants: ['consultant'], capability: 'consultant.accept_paying_clients', scope: 'personal', primary: 'consulting', shortcuts: ['consulting'], setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'equipment-owner', variants: ['tool_owner', 'equipment_owner'], capability: 'tool_owner.list_equipment', scope: 'personal', primary: 'equipment', shortcuts: ['equipment'], setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'franchise', variants: ['franchise_operator', 'franchise_applicant'], capability: 'franchise.operate', scope: 'territory', primary: 'franchise', shortcuts: ['franchise'], setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'investor-reporting', variants: ['investor'], capability: 'investor.reporting', scope: 'reporting-audience', primary: 'investor-reporting', shortcuts: ['investor-reporting'], setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'credit-participant', variants: ['credit_participant', 'credit_member'], capability: 'credit.participate', scope: 'credit-account', primary: 'credit', shortcuts: ['credit'], setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'partner-affiliate', variants: ['partner', 'affiliate'], capability: 'partner.attribute', scope: 'personal-or-partner', primary: 'partner', shortcuts: ['partner'], setup: ['/settings/applications'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'workforce-learning', variants: ['workforce', 'learner', 'instructor'], capability: 'workforce.learn', scope: 'personal-or-program', primary: 'learn', shortcuts: ['learn'], setup: ['/learn'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'reviewer', variants: ['reviewer'], scope: 'staff', primary: 'staff-shell', shortcuts: ['review-queue'], setup: [], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'support-agent', variants: ['support_agent'], scope: 'staff', primary: 'staff-shell', shortcuts: ['support'], setup: [], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'operations-staff', variants: ['admin', 'super_admin', 'operations'], scope: 'staff', primary: 'staff-shell', shortcuts: ['admin'], setup: [], surfaces: ['desktop', 'mobile', 'installed', 'bottom'] },
  { id: 'device-service-account', variants: ['device', 'service_account', 'kiosk'], scope: 'nonhuman', primary: null, shortcuts: [], setup: [], surfaces: [] },
]);

const link = (id, to, labelKey, extra = {}) => ({ id, to, labelKey, primary: false, ...extra });
const STAFF_CAPABILITIES = new Set(['staff.review', 'staff.support', 'admin.access', 'manage_operations']);
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
  'credit-participant': [{ id: 'persona-credit', to: '/oxsteed-credit', labelKey: 'nav.credit' }],
  'partner-affiliate': [{ id: 'persona-partner', to: '/affiliate', labelKey: 'nav.partner' }],
  'workforce-learning': [{ id: 'persona-learning', to: '/learn', labelKey: 'nav.learning' }],
});

function isProjectionReady(projection) {
  return !!(projection?.flags?.accessProjection && projection?.access);
}

function isNonhuman(projection) {
  const access = projection?.access || {};
  return access.actorType === 'nonhuman' || access.subjectType === 'device' || access.subjectType === 'service_account' || projection?.subject?.type === 'nonhuman';
}

function hasCapability(projection, capability) {
  const access = projection?.access;
  if (!access || !capability) return false;
  if ((access.personal || []).includes(capability)) return true;
  return (access.organizations || []).some((scope) => (scope.capabilities || scope.access || []).includes(capability));
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
        links.push(link(`restaurant-${scopeId}-${tool.id || tool.to}`, tool.to, tool.labelKey || 'nav.businessWorkspace', { scopeId: String(scopeId), protected: true }));
      }
      // The parent workspace comes from its business membership above.
      // A location ID identifies location tools, never a business workspace.
      continue;
    }
    links.push(link(`workspace-${scopeId}`, `/business/${encodeURIComponent(scopeId)}/workspace`, scope.name || scope.business_name || 'nav.businessWorkspace', { scopeId: String(scopeId), workspace: true, protected: true }));
  }
  return links;
}

/** Return one shared navigation model for all responsive presentations. */
export function deriveAdaptiveNavigation(projection, { showSupportWorkspace = false } = {}) {
  if (isNonhuman(projection)) return { mode: 'none', primary: [], account: [], workspaces: [], personas: [], surfaces: [] };

  const primary = [
    link('findHelp', '/helpers', 'nav.findHelp'),
    link('myJobs', '/my-jobs', 'nav.myJobs'),
    link('orderFood', '/restaurants', 'nav.orderFood'),
    link('messages', '/messages', 'nav.messages'),
    link('postJob', '/post-job', 'nav.postJob', { primary: true }),
  ];
  const account = [
    link('dashboard', '/dashboard', 'nav.dashboard'),
    link('foodOrders', '/orders', 'nav.foodOrders'),
    link('applications', '/settings/applications', 'nav.myApplications', { count: isProjectionReady(projection) ? Number(projection.access.openRequestCount || 0) : 0 }),
  ];
  if (!isProjectionReady(projection)) {
    account.push(link('settings', '/settings', 'nav.settings'), link('help', '/support', 'nav.help'), link('wallet', '/wallet', 'nav.wallet'), link('statements', '/statements', 'statementCenter.title'));
    return { mode: 'customer', primary, account, workspaces: [], personas: ['customer'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'], showBusinessSwitcher: false };
  }

  const access = projection.access;
  const personas = PERSONA_NAVIGATION_CATALOG.filter((family) => family.capability ? hasCapability(projection, family.capability) : false).map((family) => family.id);
  const workspaces = organizationLinks(projection);
  const hasBusinessWorkspace = workspaces.some((item) => item.workspace);
  const approved = (capability) => hasCapability(projection, capability) && activationReady(projection, capability);
  if (approved('helper.offer_services')) {
    addUnique(account, link('browseJobs', '/jobs', 'nav.browseJobs', { protected: true }));
    addUnique(account, link('myWork', '/helper-dashboard', 'nav.myWork', { protected: true }));
  } else if (hasCapability(projection, 'helper.offer_services')) {
    addUnique(account, link('helperSetup', '/settings/applications', 'nav.myApplications'));
  }
  if (approved('consultant.accept_paying_clients')) addUnique(account, link('consultantReferrals', '/consulting/contractor-dashboard', 'consultantContractorDashboard.page.title', { protected: true }));
  if (approved('logistics.ship')) {
    addUnique(account, link('logisticsBuyer', '/logistics/buyer', 'logistics.nav.buyer', { protected: true }));
    addUnique(account, link('logisticsOrganizer', '/logistics/organizer', 'logistics.nav.organizer', { protected: true }));
  }
  if (approved('investor.reporting') && access.investorAudience) {
    addUnique(account, link('investments', '/investments', 'nav.investments', { protected: true }));
  }
  if (hasCapability(projection, 'business.own') && !activationReady(projection, 'business.own')) {
    addUnique(account, link('businessSetup', '/business-launch/status', 'nav.businessLaunchStatus'));
  }
  if (hasCapability(projection, 'restaurant.own') && !activationReady(projection, 'restaurant.own')) {
    addUnique(account, link('restaurantSetup', '/business-launch/status', 'nav.businessLaunchStatus'));
  }
  if (approved('business.own') || approved('restaurant.own') || hasBusinessWorkspace) {
    addUnique(account, link('workspace', '/business-hub', 'nav.businessWorkspace', { protected: true }));
  }
  for (const workspace of workspaces) addUnique(account, workspace);

  // Every implemented catalog family gets its own contextual shortcut when
  // the projection says its capability is effective and activation is ready.
  // Families without a verified domain destination remain customer-only.
  addPersonaLinks(account, projection, approved);

  const staffAccess = showSupportWorkspace || (access.personal || []).some((capability) => STAFF_CAPABILITIES.has(capability)) || ['admin', 'super_admin', 'support_agent', 'reviewer'].includes(access.staffRole);
  if (staffAccess) addUnique(account, link('support', '/support/agent', 'nav.supportWorkspace', { staffShell: true }));
  account.push(link('settings', '/settings', 'nav.settings'), link('help', '/support', 'nav.help'), link('wallet', '/wallet', 'nav.wallet'), link('statements', '/statements', 'statementCenter.title'));
  return { mode: 'customer', primary, account, workspaces, personas: personas.length ? personas : ['customer'], surfaces: ['desktop', 'mobile', 'installed', 'bottom'], showBusinessSwitcher: hasBusinessWorkspace };
}

