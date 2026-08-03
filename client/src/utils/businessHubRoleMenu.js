// client/src/utils/businessHubRoleMenu.js
//
// Maps the OxSteed team-role spec (sections 2 + 7) onto the existing
// BusinessHubPage tabs. Each role defines a top-level menu; each menu
// item maps to one of the existing tab keys (or, if no tab exists, to
// an external route).
//
// Per role:
//   - menu  : the visible list of groups + items in the order shown to the user
//   - home  : the default tab to land on when the user opens the workspace
//   - widgets : home-widget tags rendered by OverviewTab (small role-specific cards)
//
// We never invent new pages here — every entry either references an
// existing tab key (rendered by BusinessHubPage) or an external route.
import { LAUNCH_BUSINESS_WORKSPACE_TABS } from './launchScope';

// Mapping tab key -> the permission code that gates it. Owner bypasses.
export const TAB_PERMISSIONS = {
  overview:         'business.view',
  workflow:         'business.edit_profile',
  profile:          'business.edit_profile',
  clients:          'customers.view_all',
  services:         'products.manage',
  gallery:          'business.edit_branding',
  policies:         'business.edit_profile',
  faqs:             'business.edit_profile',
  hours:            'business.manage_hours',
  skills:           'business.edit_profile',
  'booking-services': 'products.manage',
  appointments:     'calendar.view_all',
  products:         'products.view',
  messages:         'messages.view_all',
  calendar:         'calendar.view_all',
  invoices:         'invoices.view',
  tax:              'invoices.view',
  goals:            'analytics.view_financial',
  'service-pricing':'products.manage',
  'product-pricing':'products.manage',
  analytics:        'analytics.view_summary',
  loyalty:          'customers.view_all',
  team:             'team.view',
  integrations:     'settings.integrations',
  expenses:         'analytics.view_financial',
  quotes:           'quotes.create',
  recurring:        'invoices.create',
  staff:            'team.view',
  'reviews-mgmt':   'business.edit_profile',
  marketing:        'business.edit_branding',
  waitlist:         'customers.view_all',
  packages:         'products.manage',
  health:           'analytics.view_summary',
  leads:            'leads.view',
  'msg-templates':  'support.manage_macros',
  ai:               'business.edit_branding',
  maintenance:      'jobs.view_all',
  'continuity-ops': 'business.edit_profile',
};

// Filter a tab list down to ones the active user can see, owners bypass.
export function filterAllowedTabs(tabKeys, role, permissionSet) {
  if (role === 'owner') return tabKeys;
  const perms = permissionSet instanceof Set ? permissionSet : new Set(permissionSet || []);
  return tabKeys.filter((tb) => {
    const need = TAB_PERMISSIONS[tb];
    if (!need) return true; // unmapped tabs default to visible (legacy behavior)
    return perms.has(need);
  });
}

// Role -> ordered menu definition. Each entry has:
//   id    : a stable id for the menu item (i18n key suffix)
//   label : translation key for the label
//   tab   : tab key to activate inside BusinessHubPage (or null if route is set)
//   route : external route to navigate to instead of switching tabs
//   group : section header (optional)
const COMMON_FOOTER = [
  { id: 'team',         label: 'businessHub.menu.team',         tab: 'team',         group: 'admin' },
  { id: 'settings',     label: 'businessHub.menu.settings',     tab: 'integrations', group: 'admin' },
];

export const ROLE_MENUS = {
  owner: {
    home: 'overview',
    widgets: ['revenue','payouts','open_jobs','completion_rate','team_utilization','new_leads','quote_conversion','message_volume','template_usage','profile_health'],
    menu: [
      { id: 'overview',    label: 'businessHub.menu.overview',    tab: 'overview' },
      { id: 'workflow',    label: 'businessHub.menu.workflows',   tab: 'workflow' },
      { id: 'jobs',        label: 'businessHub.menu.jobs',        tab: 'calendar' },
      { id: 'calendar',    label: 'businessHub.menu.calendar',    tab: 'calendar' },
      { id: 'customers',   label: 'businessHub.menu.customers',   tab: 'clients' },
      { id: 'messages',    label: 'businessHub.menu.messages',    tab: 'messages' },
      { id: 'templates',   label: 'businessHub.menu.templates',   tab: 'msg-templates' },
      { id: 'products',    label: 'businessHub.menu.products',    tab: 'products' },
      { id: 'analytics',   label: 'businessHub.menu.analytics',   tab: 'analytics' },
      { id: 'finance',     label: 'businessHub.menu.finance',     tab: 'invoices' },
      { id: 'goals',       label: 'businessHub.menu.goals',       tab: 'goals' },
      { id: 'documents',   label: 'businessHub.menu.documents',   tab: 'recurring' },
      ...COMMON_FOOTER,
    ],
  },

  manager: {
    home: 'overview',
    widgets: ['today_jobs','unassigned_work','late_jobs','staff_availability','overdue_replies','open_escalations'],
    menu: [
      { id: 'overview',    label: 'businessHub.menu.operationsOverview', tab: 'overview' },
      { id: 'workflow',    label: 'businessHub.menu.workflows',   tab: 'workflow' },
      { id: 'jobs',        label: 'businessHub.menu.jobs',        tab: 'calendar' },
      { id: 'calendar',    label: 'businessHub.menu.calendar',    tab: 'calendar' },
      { id: 'teamSchedule',label: 'businessHub.menu.teamSchedule',tab: 'staff' },
      { id: 'customers',   label: 'businessHub.menu.customers',   tab: 'clients' },
      { id: 'messages',    label: 'businessHub.menu.messages',    tab: 'messages' },
      { id: 'quotes',      label: 'businessHub.menu.quotesInvoices', tab: 'quotes' },
      { id: 'products',    label: 'businessHub.menu.productsTools',  tab: 'products' },
      { id: 'templates',   label: 'businessHub.menu.templates',   tab: 'msg-templates' },
      { id: 'reports',     label: 'businessHub.menu.reports',     tab: 'analytics' },
      { id: 'escalations', label: 'businessHub.menu.supportEscalations', tab: 'messages' },
      ...COMMON_FOOTER,
    ],
  },

  employee: {
    home: 'calendar',
    widgets: ['next_job','today_schedule','tasks_needing_update','waiting_replies','checklists','personal_stats'],
    menu: [
      { id: 'myWork',      label: 'businessHub.menu.myWork',      tab: 'calendar' },
      { id: 'mySchedule',  label: 'businessHub.menu.mySchedule',  tab: 'calendar' },
      { id: 'assignedJobs',label: 'businessHub.menu.assignedJobs',tab: 'calendar' },
      { id: 'messages',    label: 'businessHub.menu.messages',    tab: 'messages' },
      { id: 'customers',   label: 'businessHub.menu.customers',   tab: 'clients' },
      { id: 'tools',       label: 'businessHub.menu.toolsEquipment',tab: 'products' },
      { id: 'templates',   label: 'businessHub.menu.workflows',   tab: 'msg-templates' },
    ],
  },

  representative: {
    home: 'leads',
    widgets: ['new_leads','quotes_awaiting','followups_today','consultations','conversion_rate','unread_lead_conv'],
    menu: [
      { id: 'salesOverview',label:'businessHub.menu.salesOverview', tab: 'overview' },
      { id: 'leads',       label: 'businessHub.menu.leads',       tab: 'leads' },
      { id: 'conversations',label:'businessHub.menu.conversations', tab: 'messages' },
      { id: 'quotes',      label: 'businessHub.menu.quotes',      tab: 'quotes' },
      { id: 'appointments',label: 'businessHub.menu.appointments',tab: 'calendar' },
      { id: 'customers',   label: 'businessHub.menu.customers',   tab: 'clients' },
      { id: 'followups',   label: 'businessHub.menu.followups',   tab: 'calendar' },
      { id: 'templates',   label: 'businessHub.menu.scripts',     tab: 'msg-templates' },
      { id: 'reports',     label: 'businessHub.menu.performance', tab: 'analytics' },
    ],
  },

  support_agent: {
    home: 'messages',
    widgets: ['unassigned_tickets','first_response_sla','escalations','upcoming_reschedules','csat','ai_drafts'],
    menu: [
      { id: 'supportOverview',label:'businessHub.menu.supportOverview', tab: 'overview' },
      { id: 'inbox',       label: 'businessHub.menu.inboxQueue',  tab: 'messages' },
      { id: 'tickets',     label: 'businessHub.menu.tickets',     tab: 'messages' },
      { id: 'customers',   label: 'businessHub.menu.customers',   tab: 'clients' },
      { id: 'appointments',label: 'businessHub.menu.reschedules', tab: 'calendar' },
      { id: 'macros',      label: 'businessHub.menu.macros',      tab: 'msg-templates' },
      { id: 'kb',          label: 'businessHub.menu.knowledgeBase',tab: 'ai' },
      { id: 'escalations', label: 'businessHub.menu.escalations', tab: 'messages' },
      { id: 'qa',          label: 'businessHub.menu.qaPerformance', tab: 'analytics' },
    ],
  },
};

export function getMenuForRole(role) {
  return ROLE_MENUS[role] || ROLE_MENUS.owner;
}

export function buildVisibleMenu(role, permissionSet) {
  const config = getMenuForRole(role);
  const perms = permissionSet instanceof Set ? permissionSet : new Set(permissionSet || []);
  return config.menu.filter((item) => {
    if (item.tab && !LAUNCH_BUSINESS_WORKSPACE_TABS.has(item.tab)) return false;
    if (role === 'owner') return true;
    if (!item.tab) return true;
    const need = TAB_PERMISSIONS[item.tab];
    if (!need) return true;
    return perms.has(need);
  });
}
