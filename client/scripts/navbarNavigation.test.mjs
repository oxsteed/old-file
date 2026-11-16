import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { navbarMode, navbarNavigation, navbarLinkActive, navbarWorkspacePath } from '../src/utils/navbarNavigation.js';

const shapes = {
  customer: [['findHelp', '/helpers'], ['myJobs', '/my-jobs'], ['orderFood', '/restaurants'], ['messages', '/messages'], ['postJob', '/post-job']],
  helper: [['browseJobs', '/jobs'], ['myWork', '/helper-dashboard'], ['messages', '/helper/messages']],
  business_owner: [['dashboard', '/dashboard'], ['workspace', '/business-hub'], ['messages', '/helper/messages']],
};
for (const [mode, expected] of Object.entries(shapes)) {
  test(`${mode} exposes the ordered daily priorities and one primary action`, () => {
    const result = navbarNavigation({ default_mode: mode, role: 'helper' });
    assert.deepEqual(result.primary.map(({ id, to }) => [id, to]), expected);
    assert.deepEqual(result.primary.filter(item => item.primary).map(item => item.id), [mode === 'customer' ? 'postJob' : mode === 'helper' ? 'browseJobs' : 'workspace']);
    assert.equal(result.showBusinessSwitcher, mode === 'business_owner');
    assert.ok(result.account.some(item => item.to === '/settings'));
    assert.ok(result.account.some(item => item.to === '/statements'));
  });
}
test('legacy helper variants and explicit mode use the same navigation', () => {
  for (const role of ['helper', 'helper_pro', 'broker']) {
    assert.equal(navbarMode({ role }), 'helper');
    assert.deepEqual(navbarNavigation({ role }), navbarNavigation({ role, default_mode: 'helper' }));
  }
  assert.equal(navbarMode({ role: 'helper', default_mode: 'customer' }), 'customer');
  assert.equal(navbarMode({ role: 'customer' }), 'customer');
});
test('granted business roles use workspace navigation; support and admin retain their dashboards', () => {
  for (const mode of ['business_manager', 'business_representative', 'business_employee']) {
    assert.deepEqual(navbarNavigation({ default_mode: mode }).primary, navbarNavigation({ default_mode: 'business_owner' }).primary);
  }
  for (const [mode, dashboardPath] of [['admin', '/admin'], ['business_support_agent', '/support/agent'], ['logistics', '/logistics/buyer']]) {
    const result = navbarNavigation({ default_mode: mode }, { dashboardPath, showSupportWorkspace: true });
    assert.ok(result.primary.some(item => item.to === dashboardPath));
    assert.equal(result.account.filter(item => item.to === '/support/agent').length, mode === 'business_support_agent' ? 0 : 1);
  }
});
test('Account keeps personal tasks and permission-gated support out of the primary row', () => {
  const customer = navbarNavigation({ default_mode: 'customer' });
  assert.deepEqual(customer.account.map(item => item.id), ['dashboard', 'foodOrders', 'settings', 'wallet', 'statements']);
  assert.equal(customer.account.some(item => item.id === 'workspace'), false);
  assert.deepEqual(navbarNavigation({ default_mode: 'helper' }).account.map(item => item.id), ['workspace', 'settings', 'wallet', 'statements']);
  assert.equal(navbarNavigation({ default_mode: 'customer' }, { showSupportWorkspace: true }).account.at(-1).to, '/support/agent');
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
    for (const key of ['findHelp', 'myJobs', 'orderFood', 'myWork', 'workspace', 'businessWorkspace', 'foodOrders', 'account']) {
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
  // No duplicates when the view already exposes the destination.
  nav = navbarNavigation({ role: 'helper', default_mode: 'helper' }, { projection: on(['customer', 'helper.offer_services']) });
  assert.equal(nav.mode, 'helper');
  assert.equal([...nav.primary, ...nav.account].filter((i) => i.to === '/helper-dashboard').length, 1);
  // Flag off or no projection: byte-for-byte legacy.
  const legacy = navbarNavigation({ role: 'helper', default_mode: 'helper' });
  assert.deepEqual(navbarNavigation({ role: 'helper', default_mode: 'helper' }, { projection: { flags: {}, access: { personal: ['customer'] } } }), legacy);
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

  const logistics = navbarNavigation({ role: 'customer', default_mode: 'logistics' }, { dashboardPath: '/logistics/buyer', projection: on(['customer', 'logistics.ship']) });
  assert.equal(logistics.mode, 'logistics');
  assert.ok(logistics.primary.some((item) => item.to === '/logistics/buyer'));

  const revoked = navbarNavigation({ role: 'customer', default_mode: 'logistics' }, { projection: on(['customer']) });
  assert.equal(revoked.mode, 'customer');
  assert.ok(!revoked.account.some((item) => item.to === '/logistics/buyer'));
});

// WP-047: the organization switcher shows a translated permission status.
test('business switcher renders translated organization roles in every locale', async () => {
  const src = await readFile(new URL('../src/components/BusinessSwitcher.jsx', import.meta.url), 'utf8');
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
