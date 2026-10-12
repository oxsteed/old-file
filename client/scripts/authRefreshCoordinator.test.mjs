import test from 'node:test';
import assert from 'node:assert/strict';
import { withCrossTabRefreshLock } from '../src/api/authRefreshCoordinator.js';

test('runs the refresh operation when browser locks are unavailable', async () => {
  const result = await withCrossTabRefreshLock(async () => 'refreshed');
  assert.equal(result, 'refreshed');
});
