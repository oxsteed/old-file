import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyServerLaunchVisibility,
  getLaunchRedirect,
  isBusinessHubTabLaunched,
  LAUNCH_BUSINESS_HUB_TABS,
  LAUNCH_DEFAULTS,
  LAUNCH_VISIBILITY,
} from './launchScope.js';

function restoreLaunchVisibility() {
  for (const key of Object.keys(LAUNCH_DEFAULTS)) {
    LAUNCH_VISIBILITY[key] = LAUNCH_DEFAULTS[key];
  }
}

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

test('OxSteed Media routes remain available after launch', () => {
  assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, true);
  assert.equal(getLaunchRedirect('/media'), null);
  assert.equal(getLaunchRedirect('/media/search'), null);
  assert.equal(getLaunchRedirect('/media/post/abc'), null);
});

test('Business Hub media tab follows oxsteedMedia launch flag', () => {
  assert.equal(isBusinessHubTabLaunched('overview'), true);
  assert.equal(isBusinessHubTabLaunched('media'), true);
  assert.equal(LAUNCH_BUSINESS_HUB_TABS.has('media'), false);
});

test('P2-9-F04: intake triage tabs are launched so notification deep links open in-product', () => {
  for (const tab of ['beauty-ops', 'creative-ops', 'continuity-ops', 'professional-ops', 'trades-ops', 'maintenance']) {
    assert.equal(isBusinessHubTabLaunched(tab), true, `${tab} should be launched`);
  }
});

test('applyServerLaunchVisibility applies every known key from the server map', () => {
  try {
    applyServerLaunchVisibility({
      launches: {
        discoverEverything: true,
        templates: true,
        helperEarnings: false,
        toolRentals: false,
        unknownFutureKey: true,
      },
    });
    assert.equal(LAUNCH_VISIBILITY.discoverEverything, true);
    assert.equal(LAUNCH_VISIBILITY.templates, true);
    assert.equal(LAUNCH_VISIBILITY.helperEarnings, false);
    assert.equal(LAUNCH_VISIBILITY.toolRentals, false);
    assert.equal('unknownFutureKey' in LAUNCH_VISIBILITY, false);
  } finally {
    restoreLaunchVisibility();
  }
});

test('applyServerLaunchVisibility ignores non-boolean values and keeps the legacy media patch', () => {
  try {
    applyServerLaunchVisibility({
      media: false,
      launches: { templates: 'yes', subscriptions: 1, oxsteedMedia: 'true' },
    });
    assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, false);
    assert.equal(LAUNCH_VISIBILITY.templates, false);
    assert.equal(LAUNCH_VISIBILITY.subscriptions, false);
  } finally {
    restoreLaunchVisibility();
  }
});

test('applyServerLaunchVisibility ignores null, empty, and non-object patches', () => {
  assert.doesNotThrow(() => applyServerLaunchVisibility(null));
  assert.doesNotThrow(() => applyServerLaunchVisibility({}));
  assert.doesNotThrow(() => applyServerLaunchVisibility('on'));
  assert.equal(LAUNCH_VISIBILITY.templates, false);
  assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, true);
});
