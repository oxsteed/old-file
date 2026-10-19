import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { footerNavigation } from '../src/utils/footerNavigation.js';
import { LAUNCH_VISIBILITY } from '../src/utils/launchScope.js';

const paths = groups => groups.map(group => group.links.map(item => item.to));
const expected = [['/restaurants', '/direct', '/delivery', '/media'],
  ['/how-it-works', '/about', '/careers', '/consulting-intake'], ['/support', '/learn', '/vortex']];
test('footer destinations and order stay consistent for guests, current modes and legacy accounts', () => {
  for (const user of [null, ...['customer', 'helper', 'business_owner', 'business_employee', 'admin'].map(default_mode => ({id:1,default_mode})), {id:1,role:'helper_pro'}]) {
    assert.deepEqual(paths(footerNavigation(user)), expected);
    assert.deepEqual(footerNavigation(user).map(group => group.id), ['explore', 'company', 'help']);
  }
});
test('launch flags and Pro entitlement independently gate secondary destinations', () => {
  const pro = { id: 1, role: 'helper_pro' };
  const visibility = {...LAUNCH_VISIBILITY, oxsteedMedia:false, productMarketplace:true, footerUtilityPills:false, genericQrGenerator:true};
  assert.deepEqual(paths(footerNavigation(pro, { visibility })), [['/restaurants','/direct','/delivery','/products'],expected[1],['/support','/learn','/qr-generator']]);
  for (const user of [null, {id:2,role:'helper',membership_tier:'free'}]) {
    assert.ok(!paths(footerNavigation(user, {visibility})).flat().includes('/qr-generator'));
  }
  assert.ok(!paths(footerNavigation(pro)).flat().includes('/qr-generator'));
});
test('Support workspace requires both a signed-in account and confirmed membership', () => {
  assert.ok(!paths(footerNavigation(null, {showSupportWorkspace:true})).flat().includes('/support/agent'));
  assert.ok(!paths(footerNavigation({id:1})).flat().includes('/support/agent'));
  assert.deepEqual(paths(footerNavigation({id:1}, {showSupportWorkspace:true}))[2], [...expected[2], '/support/agent']);
});
test('new footer labels have matching legacy and namespaced translations in all five languages', async () => {
  for (const language of ['en','es','fr','ht','ar']) {
    const legacy = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url)));
    const common = JSON.parse(await readFile(new URL(`../src/i18n/locales/${language}/common.json`, import.meta.url)));
    for (const key of ['explore','help','compactTagline','teamAccess']) {
      assert.ok(legacy.footer[key]?.trim(), `${language} ${key}`);
      assert.equal(legacy.footer[key], common.footer[key]);
    }
  }
});
