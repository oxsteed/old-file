import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { navbarNavigation, navbarLinkActive, navbarWorkspacePath } from '../src/utils/navbarNavigation.js';
import { hasProAccess, hasBusinessHubAccess } from '../src/utils/modeAccess.js';

// WP-104: navigation is projection-only. Every account gets the customer
// primary links, whatever its role or default_mode; capabilities add account
// shortcuts and the business switcher comes from projection organizations.
const CUSTOMER_PRIMARY = [['findHelp', '/helpers'], ['myJobs', '/my-jobs'], ['orderFood', '/restaurants'], ['messages', '/messages'], ['postJob', '/post-job']];
const CUSTOMER_ACCOUNT = ['dashboard', 'foodOrders', 'applications', 'settings', 'help', 'wallet', 'statements'];

for (const user of [
  { default_mode: 'customer', role: 'customer' },
  { default_mode: 'helper', role: 'helper' },
  { role: 'helper_pro' },
  { role: 'broker' },
  { default_mode: 'business_owner', role: 'helper' },
  { default_mode: 'business_manager', role: 'helper' },
  { default_mode: 'business_support_agent', role: 'support_agent' },
  { default_mode: 'admin', role: 'admin' },
  { default_mode: 'consultant', role: 'helper' },
  { default_mode: 'logistics', role: 'customer' },
]) {
  test(`projection-only navigation: ${user.default_mode || user.role} gets the customer primary links`, () => {
    const result = navbarNavigation(user);
    assert.equal(result.mode, 'customer');
    assert.deepEqual(result.primary.map(({ id, to }) => [id, to]), CUSTOMER_PRIMARY);
    assert.deepEqual(result.primary.filter(item => item.primary).map(item => item.id), ['postJob']);
    assert.equal(result.showBusinessSwitcher, false);
    assert.deepEqual(result.account.map(item => item.id), CUSTOMER_ACCOUNT);
    assert.ok(result.account.some(item => item.to === '/settings'));
  assert.ok(result.account.some(item => item.to === '/support'));
    assert.ok(result.account.some(item => item.to === '/statements'));
  });
}

test('role and default_mode no longer change the navigation', () => {
  const baseline = navbarNavigation({ role: 'customer', default_mode: 'customer' });
  for (const user of [{ role: 'helper' }, { role: 'helper', default_mode: 'helper' }, { role: 'helper', default_mode: 'business_owner' }, { role: 'admin', default_mode: 'admin' }]) {
    assert.deepEqual(navbarNavigation(user), baseline);
  }
});

test('client Pro visibility follows billing state independently of helper capability', () => {
  assert.equal(hasProAccess({ role: 'customer', tier: 'pro', subscription_status: 'active' }), true);
  assert.equal(hasProAccess({ role: 'customer', tier: 'pro', subscription_status: 'cancelled' }), false);
  assert.equal(hasProAccess({ role: 'customer', tier: 'free', subscription_status: 'none', trial_ends_at: new Date(Date.now() + 3600000).toISOString() }), true);
});

test('Business Hub access comes from the projection, not the mode', () => {
  const on = (personal, organizations = [], flags = {}) => ({ flags: { accessProjection: true, ...flags }, access: { personal, organizations } });
  assert.equal(hasBusinessHubAccess(null), false);
  assert.equal(hasBusinessHubAccess({ flags: {}, access: { personal: ['customer'] } }), false);
  assert.equal(hasBusinessHubAccess(on(['customer'])), false);
  assert.equal(hasBusinessHubAccess(on(['customer'], [{ type: 'business', id: '1', role: 'employee' }])), true);
  assert.equal(hasBusinessHubAccess(on(['customer'], [{ type: 'business', id: '1', role: 'owner' }])), true);
  // Active customers with an open access request can prepare private drafts.
  assert.equal(hasBusinessHubAccess(on(['customer'], [], { accessRequests: true })), true);
  assert.equal(hasBusinessHubAccess(on(['helper.offer_services'], [], { accessRequests: true })), false);
});

test('dashboard path drives the dashboard account link; support workspace is opt-in only', () => {
  const result = navbarNavigation({ default_mode: 'business_support_agent' }, { dashboardPath: '/support/agent', showSupportWorkspace: true });
  assert.equal(result.account.find(item => item.id === 'dashboard').to, '/support/agent');
  assert.equal(result.account.filter(item => item.to === '/support/agent').length, 2);
  const plain = navbarNavigation({ default_mode: 'customer' });
  assert.equal(plain.account.some(item => item.id === 'support'), false);
  assert.equal(navbarNavigation({ default_mode: 'customer' }, { showSupportWorkspace: true }).account.at(-1).to, '/support/agent');
});

test('open applications are visible in Account without changing primary navigation', () => {
  const projection = {
    flags: { accessProjection: true },
    access: { personal: ['customer'], organizations: [], openRequestCount: 2 },
  };
  const result = navbarNavigation({ role: 'customer' }, { projection });
  assert.deepEqual(result.primary.map(({ id, to }) => [id, to]), CUSTOMER_PRIMARY);
  assert.equal(result.account.find(item => item.id === 'applications').to, '/settings/applications');
  assert.equal(result.account.find(item => item.id === 'applications').count, 2);
});

test('workspace URL wins over saved selection and never invents a business for new owners', () => {
  assert.equal(navbarWorkspacePath('/business/42/workspace/calendar', '9'), '/business/42/workspace');
  assert.equal(navbarWorkspacePath('/business/a%20b/workspace', '9'), '/business/a%20b/workspace');
  assert.equal(navbarWorkspacePath('/helpers', '9'), '/business/9/workspace');
  assert.equal(navbarWorkspacePath('/'), '/business-hub');
});
test('nested routes highlight messages, work, settings and workspace without prefix collisions', () => {
  for (const [item, path] of [[{id:'messages',to:'/messages'}, '/helper/messages/guest/1'], [{id:'workspace',to:'/business-hub'}, '/business/2/workspace/messages'], [{id:'myWork',to:'/helper-dashboard'}, '/dashboard'], [{id:'settings',to:'/settings'}, '/settings/passkeys']]) {
    assert.equal(navbarLinkActive(item, path), true);
  }
  assert.equal(navbarLinkActive({id:'messages',to:'/messages'}, '/messages-extra'), false);
  assert.equal(navbarLinkActive({id:'workspace',to:'/business-hub'}, '/business/2'), false);
});
test('the operational homepage highlights work without marking customer discovery as a dashboard', () => {
  assert.equal(navbarLinkActive({ id: 'myWork', to: '/helper-dashboard' }, '/', 'helper'), true);
  for (const mode of ['business_owner', 'business_manager', 'business_representative', 'business_employee']) {
    assert.equal(navbarLinkActive({ id: 'dashboard', to: '/dashboard' }, '/', mode), true);
    assert.equal(navbarLinkActive({ id: 'workspace', to: '/business-hub' }, '/', mode), false);
  }
  assert.equal(navbarLinkActive({ id: 'dashboard', to: '/dashboard' }, '/', 'customer'), false);
});
test('new labels have matching legacy and namespaced translations in every language', async () => {
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    const legacy = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url)));
    const common = JSON.parse(await readFile(new URL(`../src/i18n/locales/${language}/common.json`, import.meta.url)));
    for (const key of ['findHelp', 'myJobs', 'orderFood', 'myWork', 'workspace', 'businessWorkspace', 'foodOrders', 'account', 'help']) {
      assert.ok(legacy.nav[key], `${language}: ${key}`);
      assert.equal(legacy.nav[key], common.nav[key]);
    }
  }
});

// WP-016: capability-aware shared navigation from the access projection.
test('projection: approvals add shortcuts without replacing the view; removed access falls back to customer', () => {
  const on = (personal, organizations = []) => ({ flags: { accessProjection: true }, access: { personal, organizations } });
  // Customer view + approved helper: provider entry points in the account menu.
  let nav = navbarNavigation({ role: 'customer', default_mode: 'customer' }, { projection: on(['customer', 'helper.offer_services']) });
  assert.equal(nav.mode, 'customer');
  assert.ok(nav.account.some((i) => i.to === '/helper-dashboard'));
  assert.ok(nav.primary.some((i) => i.id === 'postJob'));
  // Helper view whose access was revoked: customer navigation, no provider links.
  nav = navbarNavigation({ role: 'helper', default_mode: 'helper' }, { projection: on(['customer']) });
  assert.equal(nav.mode, 'customer');
  assert.ok(!nav.primary.some((i) => i.to === '/jobs'));
  assert.ok(!nav.account.some((i) => i.to === '/helper-dashboard'));
  // Organization membership: workspace shortcut from the customer view.
  nav = navbarNavigation({ role: 'customer', default_mode: 'customer' }, { projection: on(['customer'], [{ type: 'business', id: '1', role: 'employee' }]) });
  assert.ok(nav.account.some((i) => i.to === '/business-hub'));
  assert.equal(nav.showBusinessSwitcher, true);
  // Capability links are additive while Home remains customer-first.
  nav = navbarNavigation({ role: 'helper', default_mode: 'helper' }, { projection: on(['customer', 'helper.offer_services']) });
  assert.equal(nav.mode, 'customer');
  assert.equal([...nav.primary, ...nav.account].filter((i) => i.to === '/helper-dashboard').length, 1);
  // WP-104: flag off or no projection is the customer baseline, not legacy.
  const baseline = navbarNavigation({ role: 'customer', default_mode: 'customer' });
  assert.deepEqual(navbarNavigation({ role: 'helper', default_mode: 'helper' }), baseline);
  assert.deepEqual(navbarNavigation({ role: 'helper', default_mode: 'helper' }, { projection: { flags: {}, access: { personal: ['customer'] } } }), baseline);
});

test('approved consultants can open referrals from their customer navigation', () => {
  const user = { role: 'customer', default_mode: 'customer' };
  const projection = { flags: { accessProjection: true }, access: { personal: ['customer', 'consultant.accept_paying_clients'] } };
  const approved = navbarNavigation(user, { projection });
  assert.equal(approved.mode, 'customer');
  assert.ok(approved.primary.some((item) => item.id === 'postJob'));
  assert.ok(approved.account.some((item) => item.to === '/consulting/contractor-dashboard'));
  const revoked = navbarNavigation(user, { projection: { ...projection, access: { personal: ['customer'] } } });
  assert.ok(!revoked.account.some((item) => item.id === 'consultantReferrals'));
});

test('projection backs the logistics mode and adds buyer access without replacing customer Home', () => {
  const on = (personal) => ({ flags: { accessProjection: true }, access: { personal, organizations: [] } });
  const approved = navbarNavigation({ role: 'customer', default_mode: 'customer' }, { projection: on(['customer', 'logistics.ship']) });
  assert.equal(approved.mode, 'customer');
  assert.ok(approved.account.some((item) => item.to === '/logistics/buyer'));
  assert.ok(approved.account.some((item) => item.to === '/logistics/organizer'));

  const logistics = navbarNavigation({ role: 'customer', default_mode: 'logistics' }, { projection: on(['customer', 'logistics.ship']) });
  assert.equal(logistics.mode, 'customer');
  assert.ok(logistics.account.some((item) => item.to === '/logistics/buyer'));

  const revoked = navbarNavigation({ role: 'customer', default_mode: 'logistics' }, { projection: on(['customer']) });
  assert.equal(revoked.mode, 'customer');
  assert.ok(!revoked.account.some((item) => item.to === '/logistics/buyer'));
});

// WP-047: the organization switcher shows a translated permission status.
test('business switcher renders translated organization roles in every locale', async () => {
  const src = await readFile(new URL('../src/components/BusinessSwitcher.jsx', import.meta.url), 'utf8');
  const navbar = await readFile(new URL('../src/components/Navbar.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /BUSINESS_HUB_LAST_ID_LS_KEY|readLastBusinessHubId/);
  assert.doesNotMatch(navbar, /readLastBusinessHubId/);
  assert.match(src, /accountWorkspaceStorageKey\(userId\)/);
  assert.match(src, /localStorage\.getItem\(storageKey\)/);
  assert.match(src, /localStorage\.setItem\(storageKey/);
  assert.doesNotMatch(src, /\{b\._role \|\| 'owner'\}/);
  assert.match(src, /orgRoleLabel\(b\._role \|\| 'owner'\)/);
  const { readdir } = await import('node:fs/promises');
  const locales = (await readdir(new URL('../src/i18n/locales/', import.meta.url))).filter((l) => /^[a-z]{2}$/.test(l));
  assert.equal(locales.length, 20);
  for (const l of locales) {
    const roles = JSON.parse(await readFile(new URL(`../src/i18n/locales/${l}/common.json`, import.meta.url), 'utf8')).progressiveAccess.orgRoles;
    assert.deepEqual(Object.keys(roles).sort(), ['employee', 'manager', 'owner', 'representative', 'support_agent'], l);
    assert.ok(Object.values(roles).every((v) => typeof v === 'string' && v.trim()), l);
  }
});

test('mobile QR entry uses the same helper projection gate as desktop', async () => {
  const navbar = await readFile(new URL('../src/components/Navbar.jsx', import.meta.url), 'utf8');
  assert.match(navbar, /hasHelperAccess && canUseQrGenerator\(user\) && <MobileNavLink to="\/qr-generator"/);
  assert.match(navbar, /\{hasHelperAccess && \(/);
});

// OxSteed Invest (Track 3): invest entry points come from the access
// projection only (projection.invest.investEnabled). They are additive:
// the customer primary links are untouched, and no role or mode is read.
test('invest navigation appears only when the projection flag is on', () => {
  const on = (invest) => ({
    flags: { accessProjection: true },
    access: { personal: [], organizations: [] },
    invest,
  });
  const baseline = navbarNavigation({ role: 'customer' });
  assert.ok(!baseline.account.some((item) => item.to.startsWith('/invest')));
  const off = navbarNavigation({ role: 'customer' }, { projection: on({ investEnabled: false, investCommitmentsEnabled: false, investPilot: false }) });
  assert.ok(!off.account.some((item) => item.to.startsWith('/invest')));
  const enabled = navbarNavigation({ role: 'customer' }, { projection: on({ investEnabled: true, investCommitmentsEnabled: false, investPilot: false }) });
  assert.deepEqual(enabled.primary.map(({ id, to }) => [id, to]), CUSTOMER_PRIMARY);
  assert.deepEqual(
    enabled.account.filter((item) => item.to.startsWith('/invest')).map(({ id, to, labelKey }) => [id, to, labelKey]),
    [
      ['exploreInvestments', '/invest', 'nav.exploreInvestments'],
      ['requestInvestorAccess', '/invest/apply', 'nav.requestInvestorAccess'],
      ['myInvestments', '/invest/my-investments', 'nav.myInvestments'],
    ],
  );
  // Role and mode do not change the invest entries; applying never blocks
  // the customer links.
  for (const user of [{ role: 'helper' }, { role: 'helper', default_mode: 'helper' }, { role: 'admin', default_mode: 'investor' }]) {
    const result = navbarNavigation(user, { projection: on({ investEnabled: true, investCommitmentsEnabled: false, investPilot: false }) });
    assert.deepEqual(result.account.filter((item) => item.to.startsWith('/invest')).map((item) => item.to),
      ['/invest', '/invest/apply', '/invest/my-investments']);
    assert.deepEqual(result.primary.map(({ id, to }) => [id, to]), CUSTOMER_PRIMARY);
  }
});
