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
