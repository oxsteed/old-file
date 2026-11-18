import { businessHubLandingPath } from './businessProfileForm.js';
import { investNavLinks } from './invest.js';
import { deriveAdaptiveNavigation } from './personaNavigation.js';

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
  const navigation = deriveAdaptiveNavigation(projection, { showSupportWorkspace });
  const primary = navigation.primary;
  const account = navigation.account;
  const dashboard = account.find((item) => item.id === 'dashboard');
  if (dashboard) dashboard.to = dashboardPath;
  // Preserve the existing staff-shell contract: the explicit support entry is
  // the final account action, even when the shell is also the dashboard path.
  if (showSupportWorkspace) {
    const index = account.findIndex((item) => item.id === 'support');
    const [support] = index >= 0 ? account.splice(index, 1) : [];
    account.push(support || link('support', '/support/agent', 'nav.supportWorkspace'));
  }
  // OxSteed Invest: entry points come from the access projection only
  // (projection.invest.investEnabled). They are additive: customer links
  // are never removed, and no role or mode is read here.
  for (const item of investNavLinks(projection)) {
    if (![...primary, ...account].some((x) => x.id === item.id || x.to === item.to)) account.push(item);
  }
  return {
    ...navigation,
    mode: navigation.mode || 'customer',
    primary,
    account,
    showBusinessSwitcher: navigation.showBusinessSwitcher,
  };
}

export function navbarLinkActive(item, pathname, mode) {
  if (pathname === '/' && mode && mode !== 'customer' && ['dashboard', 'myWork'].includes(item.id)) return true;
  if (item.id === 'workspace') return pathname === '/business-hub' || /^\/business\/[^/]+\/workspace(?:\/|$)/.test(pathname);
  if (item.id === 'myWork') return pathname === '/helper-dashboard' || pathname === '/dashboard';
  if (item.id === 'messages') return ['/messages', '/helper/messages'].some(path => pathname === path || pathname.startsWith(`${path}/`));
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
