import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { footerNavigation } from '../src/utils/footerNavigation.js';
import { LAUNCH_VISIBILITY } from '../src/utils/launchScope.js';

const paths = groups => groups.map(group => group.links.map(item => item.to));
const expected = [['/helpers', '/restaurants', '/how-it-works'],
  ['/direct', '/delivery', '/media', '/products'],
  ['/about', '/careers', '/support'], ['/login', '/join']];
test('footer destinations and order stay consistent for guests, current modes and legacy accounts', () => {
  // Public footer links describe customer discovery and public products.
  // Team, staff, and specialist workspaces are never advertised as guest tools.
  const expectedPro = [expected[0], expected[1], expected[2], ['/dashboard', '/post-job', '/qr-generator']];
  const mediaOff = [expected[0], ['/direct', '/delivery', '/products'], expected[2], expected[3]];
  const mediaOffPro = [mediaOff[0], mediaOff[1], mediaOff[2], ['/dashboard', '/post-job', '/qr-generator']];
  const marketplaceOff = [expected[0], ['/direct', '/delivery', '/media'], expected[2], expected[3]];
  for (const user of [null, ...['customer', 'helper', 'business_owner', 'business_employee', 'admin'].map(default_mode => ({id:1,default_mode}))]) {
    const account = user ? ['/dashboard', '/post-job'] : expected[3];
    const expectedForUser = [...expected.slice(0, 3), account];
    const mediaOffForUser = [mediaOff[0], mediaOff[1], mediaOff[2], account];
    const marketplaceOffForUser = [marketplaceOff[0], marketplaceOff[1], marketplaceOff[2], account];
    assert.deepEqual(paths(footerNavigation(user)), expectedForUser);
    assert.deepEqual(paths(footerNavigation(user, { visibility: { ...LAUNCH_VISIBILITY, oxsteedMedia: false } })), mediaOffForUser);
    assert.deepEqual(paths(footerNavigation(user, { visibility: { ...LAUNCH_VISIBILITY, productMarketplace: false } })), marketplaceOffForUser);
    assert.deepEqual(footerNavigation(user).map(group => group.id), ['explore', 'services', 'company', 'account']);
    assert.ok(!paths(footerNavigation(user)).flat().some(path => ['/vortex', '/consulting-intake', '/logistics'].includes(path)));
  }
  const pro = { id: 1, role: 'helper_pro' };
  assert.deepEqual(paths(footerNavigation(pro)), expectedPro);
  assert.deepEqual(paths(footerNavigation(pro, { visibility: { ...LAUNCH_VISIBILITY, oxsteedMedia: false } })), mediaOffPro);
});
test('launch flags and Pro entitlement independently gate secondary destinations', () => {
  const pro = { id: 1, role: 'helper_pro' };
  const visibility = {...LAUNCH_VISIBILITY, oxsteedMedia:false, productMarketplace:true, footerUtilityPills:false, genericQrGenerator:true};
  assert.deepEqual(paths(footerNavigation(pro, { visibility })), [expected[0], ['/direct','/delivery','/products'], expected[2], ['/dashboard','/post-job','/qr-generator']]);
  for (const user of [null, {id:2,role:'helper',membership_tier:'free'}]) {
    assert.ok(!paths(footerNavigation(user, {visibility})).flat().includes('/qr-generator'));
  }
  // All-launch flip (2026-11-04): genericQrGenerator defaults on, so a
  // Pro user gets /qr-generator by default; non-Pro users still do not.
  assert.ok(paths(footerNavigation(pro)).flat().includes('/qr-generator'));
  assert.ok(!paths(footerNavigation(null)).flat().includes('/qr-generator'));
  assert.ok(!paths(footerNavigation(pro, { visibility: { ...LAUNCH_VISIBILITY, genericQrGenerator: false } })).flat().includes('/qr-generator'));
});
test('Support workspace requires both a signed-in account and confirmed membership', () => {
  assert.ok(!paths(footerNavigation(null, {showSupportWorkspace:true})).flat().includes('/support/agent'));
  assert.ok(!paths(footerNavigation({id:1})).flat().includes('/support/agent'));
  assert.deepEqual(paths(footerNavigation({id:1}, {showSupportWorkspace:true}))[3], ['/dashboard', '/post-job', '/support/agent']);
});
test('new footer labels have matching legacy and namespaced translations in all five languages', async () => {
  for (const language of ['en','es','fr','ht','ar']) {
    const legacy = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url)));
    const common = JSON.parse(await readFile(new URL(`../src/i18n/locales/${language}/common.json`, import.meta.url)));
    for (const key of ['explore','services','help','compactTagline','teamAccess']) {
      assert.ok(legacy.footer[key]?.trim(), `${language} ${key}`);
      assert.equal(legacy.footer[key], common.footer[key]);
    }
  }
});
