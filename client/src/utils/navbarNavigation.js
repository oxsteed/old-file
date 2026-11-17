import { businessHubLandingPath } from './businessProfileForm.js';
import { LAUNCH_VISIBILITY } from './launchScope.js';
import { capabilityShortcuts, projectionActive, hasCapability } from './accessProjection.js';
import { investNavLinks } from './invest.js';

export function navbarWorkspacePath(pathname = '', savedBusinessId) {
  const routeId = pathname.match(/^\/business\/([^/]+)\/workspace(?:\/|$)/)?.[1];
  // Preserve the URL's already encoded id; saved ids use the existing helper.
  return routeId ? `/business/${routeId}/workspace` : businessHubLandingPath(savedBusinessId);
}

const link = (id, to, labelKey, primary = false) => ({ id, to, labelKey, primary });

// WP-016 / WP-104: navigation is projection-only. Every account lands in the
// customer workspace; approved capabilities add entry points alongside it in
// the account menu. A missing projection yields the customer baseline with no
// shortcuts and no business switcher. There is no mode branch and no
// null-projection legacy fallback: `navbarMode()` and the three mode-derived
// link sets are deleted.
//
// `user` and `workspacePath` are retained in the signature for callers; the
// link sets no longer read them. `dashboardPath` drives the dashboard
// account link (callers pass '/dashboard').
export function navbarNavigation(user, { dashboardPath = '/dashboard', workspacePath = '/business-hub', showSupportWorkspace = false, projection = null } = {}) {
  const primary = [
    link('findHelp', '/helpers', 'nav.findHelp'),
    link('myJobs', '/my-jobs', 'nav.myJobs'),
    link('orderFood', '/restaurants', 'nav.orderFood'),
    link('messages', '/messages', 'nav.messages'),
    link('postJob', '/post-job', 'nav.postJob', true),
  ];
  const account = [link('dashboard', dashboardPath, 'nav.dashboard'), link('foodOrders', '/orders', 'nav.foodOrders')];
  for (const item of capabilityShortcuts('customer', projection)) {
    if (![...primary, ...account].some((x) => x.id === item.id || x.to === item.to)) account.push(item);
  }
  // OxSteed Invest: entry points come from the access projection only
  // (projection.invest.investEnabled). They are additive: customer links
  // are never removed, and no role or mode is read here.
  for (const item of investNavLinks(projection)) {
    if (![...primary, ...account].some((x) => x.id === item.id || x.to === item.to)) account.push(item);
  }
  if (LAUNCH_VISIBILITY.consulting && projectionActive(projection) && hasCapability(projection.access, 'consultant.accept_paying_clients')) {
    account.push(link('consultantReferrals', '/consulting/contractor-dashboard', 'consultantContractorDashboard.page.title'));
  }
  account.push(link('settings', '/settings', 'nav.settings'), link('wallet', '/wallet', 'nav.wallet'), link('statements', '/statements', 'statementCenter.title'));
  if (showSupportWorkspace) account.push(link('support', '/support/agent', 'nav.supportWorkspace'));
  return {
    mode: 'customer',
    primary,
    account,
    showBusinessSwitcher: projectionActive(projection) && (projection.access.organizations || []).length > 0,
  };
}

export function navbarLinkActive(item, pathname, mode) {
  if (pathname === '/' && mode && mode !== 'customer' && ['dashboard', 'myWork'].includes(item.id)) return true;
  if (item.id === 'workspace') return pathname === '/business-hub' || /^\/business\/[^/]+\/workspace(?:\/|$)/.test(pathname);
  if (item.id === 'myWork') return pathname === '/helper-dashboard' || pathname === '/dashboard';
  if (item.id === 'messages') return ['/messages', '/helper/messages'].some(path => pathname === path || pathname.startsWith(`${path}/`));
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
