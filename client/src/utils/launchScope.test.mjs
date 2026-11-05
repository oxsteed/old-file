import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyServerLaunchVisibility,
  getLaunchRedirect,
  isBusinessHubTabLaunched,
  LAUNCH_BUSINESS_HUB_TABS,
  LAUNCH_DEFAULTS,
  LAUNCH_VISIBILITY,
  normalizeLaunchDashboardMode,
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

test('weekly self-audit 2026-11-04 item 1: flag-gated redirects lift when their flag turns on', () => {
  try {
    assert.equal(getLaunchRedirect('/discover'), '/jobs');
    assert.equal(getLaunchRedirect('/templates'), '/business-hub');
    assert.equal(getLaunchRedirect('/franchise/status'), '/business-hub');
    assert.equal(getLaunchRedirect('/consulting/portal'), '/business-hub');
    assert.equal(getLaunchRedirect('/consultant-availability'), '/calendar');
    // Marketplace checkout flip (2026-11-04): the purchase path defaults on,
    // so cart/shared-cart/checkout render by default and bounce only while
    // productMarketplace is explicitly off.
    assert.equal(getLaunchRedirect('/cart/abc'), null);
    assert.equal(getLaunchRedirect('/shared-cart/abc'), null);
    assert.equal(getLaunchRedirect('/checkout/abc'), null);
    LAUNCH_VISIBILITY.productMarketplace = false;
    assert.equal(getLaunchRedirect('/cart/abc'), '/restaurants');
    assert.equal(getLaunchRedirect('/shared-cart/abc'), '/restaurants');
    assert.equal(getLaunchRedirect('/checkout/abc'), '/restaurants');
    LAUNCH_VISIBILITY.productMarketplace = true;
    LAUNCH_VISIBILITY.discoverEverything = true;
    LAUNCH_VISIBILITY.templates = true;
    LAUNCH_VISIBILITY.franchise = true;
    LAUNCH_VISIBILITY.consulting = true;
    assert.equal(getLaunchRedirect('/discover'), null);
    assert.equal(getLaunchRedirect('/templates'), null);
    assert.equal(getLaunchRedirect('/franchise/status'), null);
    assert.equal(getLaunchRedirect('/consulting/portal'), null);
    assert.equal(getLaunchRedirect('/consultant-availability'), null);
    assert.equal(getLaunchRedirect('/cart/abc'), null);
    // Entries with no owning flag stay unconditional.
    assert.equal(getLaunchRedirect('/network'), '/dashboard');
  } finally {
    restoreLaunchVisibility();
  }
});

test('weekly self-audit 2026-11-04 item 2: the four restored modes normalize to themselves', () => {
  assert.equal(normalizeLaunchDashboardMode('life_only', 'customer'), 'life_only');
  assert.equal(normalizeLaunchDashboardMode('tool_owner', 'helper'), 'tool_owner');
  assert.equal(normalizeLaunchDashboardMode('consultant', 'helper'), 'consultant');
  assert.equal(normalizeLaunchDashboardMode('franchise_applicant', 'customer'), 'franchise_applicant');
  // Existing mappings are untouched.
  assert.equal(normalizeLaunchDashboardMode('customer', 'customer'), 'customer');
  assert.equal(normalizeLaunchDashboardMode('helper', 'helper'), 'helper');
  assert.equal(normalizeLaunchDashboardMode('business_owner', 'helper'), 'business_owner');
  assert.equal(normalizeLaunchDashboardMode('admin', 'admin'), 'admin');
});

test('OxSteed Media routes remain available after launch', () => {
  // Weekly self-audit 2026-11-04 item 12: the build-time default is now
  // false (matching the server); the routes open once the server launch
  // map turns media on, as the boot fetch does in production.
  try {
    LAUNCH_VISIBILITY.oxsteedMedia = true;
    assert.equal(getLaunchRedirect('/media'), null);
    assert.equal(getLaunchRedirect('/media/search'), null);
    assert.equal(getLaunchRedirect('/media/post/abc'), null);
  } finally {
    restoreLaunchVisibility();
  }
});

test('Business Hub media tab follows oxsteedMedia launch flag', () => {
  assert.equal(isBusinessHubTabLaunched('overview'), true);
  assert.equal(LAUNCH_BUSINESS_HUB_TABS.has('media'), false);
  try {
    assert.equal(isBusinessHubTabLaunched('media'), false);
    LAUNCH_VISIBILITY.oxsteedMedia = true;
    assert.equal(isBusinessHubTabLaunched('media'), true);
  } finally {
    restoreLaunchVisibility();
  }
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
  // Weekly self-audit 2026-11-04 item 12: build-time default is false.
  assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, false);
});
