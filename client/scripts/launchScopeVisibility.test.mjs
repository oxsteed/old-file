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
test('server launch state overrides the build-time media default', () => {
  assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, true); // build default
  applyServerLaunchVisibility({ media: false });
  assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, false);
  assert.equal(getLaunchRedirect('/media'), '/');
  assert.equal(getLaunchRedirect('/media/feed'), '/');
  applyServerLaunchVisibility({ media: true });
  assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, true);
  assert.equal(getLaunchRedirect('/media'), null);
});

test('non-boolean or missing patch values are ignored', () => {
  applyServerLaunchVisibility(null);
  applyServerLaunchVisibility({ media: 'false' });
  assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, true);
  applyServerLaunchVisibility({});
  assert.equal(LAUNCH_VISIBILITY.oxsteedMedia, true);
});

test('live visibility object preserves every default key for existing read patterns', () => {
  assert.deepEqual(Object.keys(LAUNCH_VISIBILITY).sort(), Object.keys(LAUNCH_DEFAULTS).sort());
  assert.deepEqual({ ...LAUNCH_VISIBILITY }, { ...LAUNCH_DEFAULTS });
  assert.ok('oxsteedMedia' in LAUNCH_VISIBILITY);
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
  assert.equal(getLaunchRedirect('/business/acme/maintenance-request'), '/business/acme');
  assert.equal(getLaunchRedirect('/jobs'), null);
});
