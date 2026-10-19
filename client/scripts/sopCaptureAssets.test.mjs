import test from 'node:test';
import assert from 'node:assert/strict';
import asset from './sop/capture-assets.cjs';
test('targeted guide refresh preserves an image referenced by another published guide', () => {
  const manifest = { 'payouts/step/desktop': { src: '/sop/screenshots/helper/earnings/step-desktop.jpg' } };
  const name = asset.screenshotName('step-desktop.jpg', 'helper/earnings', manifest, new Set(['earnings/step/desktop']), Buffer.from('new screenshot'));
  assert.notEqual(name, 'step-desktop.jpg');
  assert.equal(manifest['payouts/step/desktop'].src, '/sop/screenshots/helper/earnings/step-desktop.jpg');
  assert.equal(asset.screenshotName('step-desktop.jpg', 'helper/earnings', manifest, new Set(['payouts/step/desktop']), Buffer.from('new screenshot')), 'step-desktop.jpg');
});
