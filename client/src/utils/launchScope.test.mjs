import assert from 'node:assert/strict';
import test from 'node:test';
import { getLaunchRedirect } from './launchScope.js';

test('business workspace URLs are not redirected to the public profile', () => {
  assert.equal(getLaunchRedirect('/business/1/workspace'), null);
  assert.equal(getLaunchRedirect('/business/1/workspace/profile'), null);
  assert.equal(getLaunchRedirect('/business/1/maintenance-request'), '/business/1');
});
