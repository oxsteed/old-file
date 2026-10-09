import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLaunchRedirect,
  isBusinessHubTabLaunched,
  LAUNCH_BUSINESS_HUB_TABS,
  LAUNCH_VISIBILITY,
} from './launchScope.js';

test('business workspace URLs are not redirected to the public profile', () => {
  assert.equal(getLaunchRedirect('/business/1/workspace'), null);
  assert.equal(getLaunchRedirect('/business/1/workspace/profile'), null);
  assert.equal(getLaunchRedirect('/business/1/maintenance-request'), '/business/1');
});

test('hiring is available in Business Hub for owners and managers', () => {
  assert.equal(LAUNCH_BUSINESS_HUB_TABS.has('hiring'), true);
  assert.equal(LAUNCH_BUSINESS_HUB_TABS.has('team'), true);
});

test('launched surfaces are not redirected (footer links stay live)', () => {
  assert.equal(getLaunchRedirect('/learn'), null);
  assert.equal(getLaunchRedirect('/learn/some-guide'), null);
  assert.equal(getLaunchRedirect('/products'), null);
});

test('OxSteed Media routes redirect home while launch flag is off', () => {
  assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, false);
  assert.equal(getLaunchRedirect('/media'), '/');
  assert.equal(getLaunchRedirect('/media/search'), '/');
  assert.equal(getLaunchRedirect('/media/post/abc'), '/');
});

test('Business Hub media tab follows oxsteedMedia launch flag', () => {
  assert.equal(isBusinessHubTabLaunched('overview'), true);
  assert.equal(isBusinessHubTabLaunched('media'), LAUNCH_VISIBILITY.oxsteedMedia);
  assert.equal(LAUNCH_BUSINESS_HUB_TABS.has('media'), false);
});
