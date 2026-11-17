import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  intentForLegacyMode,
  joinModeForLegacyMode,
  joinTargetForLegacyMode,
  resolveLegacyRegisterPath,
  legacyDashboardTarget,
  LEGACY_DASHBOARD_LINKS,
} from './legacyDeepLinks.js';

// WP-104 (Track D 1.7): former mode entry points resolve to the join flow
// with the matching intent card preselected; modes with no join card land on
// the customer-first join flow instead of a 404.

test('register entry points land on the join flow with the intent card preselected', () => {
  assert.equal(resolveLegacyRegisterPath('helper'), '/join?mode=helper');
  assert.equal(resolveLegacyRegisterPath('business_owner'), '/join?mode=business_owner');
  assert.equal(resolveLegacyRegisterPath('customer'), '/join');
});

test('modes with no join card fall back to the customer-first join flow', () => {
  for (const mode of ['restaurant_owner', 'investor', 'logistics', 'consultant', 'tool_owner', 'franchise_applicant', 'life_only', 'business_manager', 'admin', 'helper_pro', 'broker', 'nonsense', '', undefined, null]) {
    assert.equal(resolveLegacyRegisterPath(mode), '/join', String(mode));
  }
});

test('legacy mode values map to the signup intent, never to a role', () => {
  assert.equal(intentForLegacyMode('helper'), 'offer_services');
  assert.equal(intentForLegacyMode('business_owner'), 'run_business');
  assert.equal(intentForLegacyMode('restaurant_owner'), 'run_restaurant');
  assert.equal(intentForLegacyMode('customer'), 'find_help');
  assert.equal(intentForLegacyMode('life_only'), 'find_help');
  assert.equal(intentForLegacyMode('restaurant_customer'), 'find_help');
  assert.equal(intentForLegacyMode('admin'), 'find_help');
  assert.equal(intentForLegacyMode('business_manager'), 'find_help');
  assert.equal(intentForLegacyMode('nonsense'), 'find_help');
  assert.equal(intentForLegacyMode(undefined), 'find_help');
});

test('only the join flow cards are preselectable from ?mode=', () => {
  assert.equal(joinModeForLegacyMode('helper'), 'helper');
  assert.equal(joinModeForLegacyMode('business_owner'), 'business_owner');
  assert.equal(joinModeForLegacyMode('customer'), 'customer');
  assert.equal(joinModeForLegacyMode('restaurant_owner'), null);
  assert.equal(joinModeForLegacyMode('investor'), null);
  assert.equal(joinTargetForLegacyMode('helper'), '/join?mode=helper');
  assert.equal(joinTargetForLegacyMode('investor'), '/join');
});

test('former dashboard deep links resolve to a page the account can have', () => {
  assert.equal(LEGACY_DASHBOARD_LINKS['/helper-dashboard'].action, 'kept');
  assert.equal(legacyDashboardTarget('/helper-dashboard'), '/helper-dashboard');
  assert.equal(legacyDashboardTarget('/investor/dashboard'), '/dashboard');
  assert.equal(legacyDashboardTarget('/consulting/portal'), '/business-hub');
  assert.equal(legacyDashboardTarget('/franchise/status'), '/business-hub');
  assert.equal(legacyDashboardTarget('/business-dashboard'), null);
  assert.equal(legacyDashboardTarget('/dashboard'), null);
});

test('the register redirect is wired in App.jsx and the join page uses the index', async () => {
  const app = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/register\/:mode"/);
  assert.match(app, /LegacyRegisterRedirect/);
  assert.match(app, /resolveLegacyRegisterPath/);
  const join = await readFile(new URL('../pages/JoinPage.jsx', import.meta.url), 'utf8');
  assert.match(join, /joinModeForLegacyMode\(presetMode\)/);
});
