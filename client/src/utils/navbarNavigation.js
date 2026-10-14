import { canAccessBusinessHub, canPostJobs } from './modeAccess.js';
import { businessHubLandingPath } from './businessProfileForm.js';

const BUSINESS_MODES = new Set(['business_owner', 'business_manager', 'business_representative', 'business_employee']);

export function navbarMode(user) {
  if (user?.default_mode) return user.default_mode;
  if (['admin', 'super_admin'].includes(user?.role)) return 'admin';
  if (user?.role === 'support_agent') return 'business_support_agent';
  return ['helper', 'helper_pro', 'broker'].includes(user?.role) ? 'helper' : 'customer';
}

export function navbarWorkspacePath(pathname = '', savedBusinessId) {
  const routeId = pathname.match(/^\/business\/([^/]+)\/workspace(?:\/|$)/)?.[1];
  // Preserve the URL's already encoded id; saved ids use the existing helper.
  return routeId ? `/business/${routeId}/workspace` : businessHubLandingPath(savedBusinessId);
}

const link = (id, to, labelKey, primary = false) => ({ id, to, labelKey, primary });

export function navbarNavigation(user, { dashboardPath = '/dashboard', workspacePath = '/business-hub', showSupportWorkspace = false } = {}) {
  const mode = navbarMode(user);
  const effectiveUser = user ? { ...user, default_mode: mode } : null;
  const business = BUSINESS_MODES.has(mode);
  const helper = mode === 'helper';
  const customer = mode === 'customer';
  const messages = link('messages', customer ? '/messages' : '/helper/messages', 'nav.messages');
  let primary;
  if (customer) {
    primary = [link('findHelp', '/helpers', 'nav.findHelp'), link('myJobs', '/my-jobs', 'nav.myJobs'),
      link('orderFood', '/restaurants', 'nav.orderFood'), messages, link('postJob', '/post-job', 'nav.postJob', true)];
  } else if (helper) {
    primary = [link('browseJobs', '/jobs', 'nav.browseJobs', true), link('myWork', '/helper-dashboard', 'nav.myWork'), messages];
  } else if (business) {
    primary = [link('dashboard', dashboardPath, 'nav.dashboard'), link('workspace', workspacePath, 'nav.workspace', true), messages];
  } else {
    // Preserve specialized dashboards and the existing personal/provider inbox.
    const provider = ['helper', 'helper_pro', 'broker'].includes(user?.role);
    primary = [link('browseJobs', '/jobs', 'nav.browseJobs'), link('orderFood', '/restaurants', 'nav.localFoodDirectory')];
    if (canPostJobs(effectiveUser)) primary.push(link('postJob', '/post-job', 'nav.postJob'));
    primary.push(link('messages', provider ? '/helper/messages' : '/messages', 'nav.messages'), link('dashboard', dashboardPath, 'nav.dashboard'));
  }
  const account = [];
  if (customer) account.push(link('dashboard', dashboardPath, 'nav.dashboard'), link('foodOrders', '/orders', 'nav.foodOrders'));
  if (helper && canAccessBusinessHub(effectiveUser)) account.push(link('workspace', workspacePath, 'nav.businessWorkspace'));
  account.push(link('settings', '/settings', 'nav.settings'), link('wallet', '/wallet', 'nav.wallet'), link('statements', '/statements', 'statementCenter.title'));
  if (showSupportWorkspace && !primary.some(item => item.to === '/support/agent')) {
    account.push(link('support', '/support/agent', 'nav.supportWorkspace'));
  }
  return { mode, primary, account, showBusinessSwitcher: business && canAccessBusinessHub(effectiveUser) };
}

export function navbarLinkActive(item, pathname) {
  if (item.id === 'workspace') return pathname === '/business-hub' || /^\/business\/[^/]+\/workspace(?:\/|$)/.test(pathname);
  if (item.id === 'myWork') return pathname === '/helper-dashboard' || pathname === '/dashboard';
  if (item.id === 'messages') return ['/messages', '/helper/messages'].some(path => pathname === path || pathname.startsWith(`${path}/`));
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
