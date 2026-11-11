import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAUNCH_VISIBILITY,
  LAUNCH_DEFAULTS,
  applyServerLaunchVisibility,
  getLaunchRedirect,
} from '../src/utils/launchScope.js';

// Review P3-7-F09: the server is the single source of truth for launch state.
// main.jsx fetches /api/launch-visibility at boot and applies it here before
// first render.
function restoreLaunchVisibility() {
  for (const key of Object.keys(LAUNCH_DEFAULTS)) {
    LAUNCH_VISIBILITY[key] = LAUNCH_DEFAULTS[key];
  }
}

test('server launch state overrides the build-time media default', () => {
  try {
    // All-launch flip (2026-11-04): the build-time default is now true
    // (matching the server); the server map still overrides it, and an
    // explicit server false still bounces media to /.
    assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, true); // build default
    assert.equal(getLaunchRedirect('/media'), null);
    applyServerLaunchVisibility({ media: false });
    assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, false);
    assert.equal(getLaunchRedirect('/media'), '/');
    assert.equal(getLaunchRedirect('/media/feed'), '/');
    applyServerLaunchVisibility({ media: true });
    assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, true);
    assert.equal(getLaunchRedirect('/media'), null);
  } finally {
    restoreLaunchVisibility();
  }
});

test('non-boolean or missing patch values are ignored', () => {
  try {
    // Start from launched state explicitly; the build default is true
    // since the all-launch flip, so this also covers the default.
    applyServerLaunchVisibility({ media: true });
    applyServerLaunchVisibility(null);
    applyServerLaunchVisibility({ media: 'false' });
    assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, true);
    applyServerLaunchVisibility({});
    assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, true);
  } finally {
    restoreLaunchVisibility();
  }
});

test('live visibility object preserves every default key for existing read patterns', () => {
  assert.deepEqual(Object.keys(LAUNCH_VISIBILITY).sort(), Object.keys(LAUNCH_DEFAULTS).sort());
  assert.deepEqual({ ...LAUNCH_VISIBILITY }, { ...LAUNCH_DEFAULTS });
  assert.ok('oxsteedMedia' in LAUNCH_VISIBILITY);
});

test('Vortex defaults on when the optional build variable is absent', () => {
  assert.equal(LAUNCH_DEFAULTS.businessHubVortexAccess, true);
  assert.equal(LAUNCH_DEFAULTS.vortexWorkspaceEntry, true);
});

// Review P3-7-F14: /orders/:id must reach the router's canonical redirect
// (/food/orders/:id), not bounce to /orders via the launch gate.
test('order detail paths are not rewritten to the order list', () => {
  assert.equal(getLaunchRedirect('/orders'), null);
  assert.equal(getLaunchRedirect('/orders/abc123'), null);
  assert.equal(getLaunchRedirect('/orders/abc123/'), null);
});

// The specialty intake redirect stays wired to its launch flag.
test('specialty intake paths still honor the specializedProfileTemplates flag', () => {
  try {
    // All-launch flip (2026-11-04): renders by default; bounces only
    // while the flag is explicitly off.
    assert.equal(getLaunchRedirect('/business/acme/maintenance-request'), null);
    LAUNCH_VISIBILITY.specializedProfileTemplates = false;
    assert.equal(getLaunchRedirect('/business/acme/maintenance-request'), '/business/acme');
    LAUNCH_VISIBILITY.specializedProfileTemplates = true;
    assert.equal(getLaunchRedirect('/business/acme/maintenance-request'), null);
  } finally {
    restoreLaunchVisibility();
  }
  assert.equal(getLaunchRedirect('/jobs'), null);
});
