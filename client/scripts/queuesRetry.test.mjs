// Nov 10 #5 (STILL LIVE): a Queues load failure renders only loadFailed,
// no retry, and the per-customer list and add form never render. The error
// state must offer a retry; after a successful retry the list and add form
// render again.
//
// Union with Domain 1 audit #5: the retry is reloadMine, the re-runnable
// per-customer fetch (abort-aware); the Nov 10 retryMine handler is subsumed
// by it. The retry button renders inside the alert.
//
// Run: node --test scripts/queuesRetry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFile(join(root, rel), 'utf8');

test('the Queues error state offers a retry that re-runs the load', async () => {
  const queues = await src('src/admin/pages/customer360/upgrades/Queues.jsx');
  // The re-runnable fetch: back to loading, re-fetch the per-customer queues,
  // ready on success, error again on failure.
  assert.match(queues, /const reloadMine = async \(signal\) => \{[\s\S]{0,400}?await loadMine\(signal\)/);
  const errorBranch = queues.slice(queues.indexOf('state === "error"'), queues.indexOf('{mine && ('));
  assert.match(errorBranch, /role="alert"/);
  assert.match(errorBranch, /<button type="button" onClick=\{\(\) => reloadMine\(\)\}>/);
  assert.match(errorBranch, /copy\("retry"\)/);
});

test('a successful retry restores the list and the add form', async () => {
  const queues = await src('src/admin/pages/customer360/upgrades/Queues.jsx');
  // The list and the add form render only when `mine` is set, which the
  // retry's loadMine() sets on success.
  const mineSection = queues.split('{mine && (')[1];
  assert.match(mineSection, /mine\.items\.map/);
  assert.match(mineSection, /copy\("queues\.add"\)/);
  assert.match(mineSection, /adminApi\.post\(`\$\{api\}\/queue-items`/);
});
