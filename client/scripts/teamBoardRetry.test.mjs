// Nov 10 #4 (STILL LIVE): a TeamBoard load failure early-returns with only
// a message, no retry, and QueueSetup renders only in the success branch.
// The error state must offer a retry that re-runs the load; on success the
// board (and QueueSetup for super admins) renders again.
//
// Union with Domain 1 audit #4: the retry is retryLoad, which resets the
// filters and re-runs the board + saved-views loads (restoring the error
// branch on failure); the Nov 10 retryBoard handler is subsumed by it.
// QueueSetup stays rendered in the error branch for super admins.
//
// Run: node --test scripts/teamBoardRetry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFile(join(root, rel), 'utf8');

test('the board error state offers a retry that re-runs the load', async () => {
  const board = await src('src/admin/pages/customer360/upgrades/TeamBoard.jsx');
  // The retry handler: resets the filters and re-runs the board + saved-views
  // loads, restoring the error branch on failure.
  assert.match(board, /const retryLoad = \(\) => run\(async \(\) => \{[\s\S]*?loadBoard\(EMPTY_FILTERS, "", undefined\)[\s\S]*?loadViews\(\)[\s\S]*?setBoard\(\{ error:/);
  // The error branch renders the message, the retry button, and QueueSetup
  // (reachable for super admins even while the board is down).
  const errorBranch = board.slice(board.indexOf('if (board?.error)'), board.indexOf('if (!board)'));
  assert.ok(errorBranch.length > 0, 'error branch exists');
  assert.match(errorBranch, /role="alert"/);
  assert.match(errorBranch, /<button type="button"[^>]*onClick=\{retryLoad\}[^>]*>/);
  assert.match(errorBranch, /copy\("retry"\)/);
  assert.match(errorBranch, /<QueueSetup /);
  assert.match(errorBranch, /queuesLoaded=\{false\}/);
});

test('a successful retry renders the board and QueueSetup again', async () => {
  const board = await src('src/admin/pages/customer360/upgrades/TeamBoard.jsx');
  // The success branch (after the error/loading early returns) still mounts
  // QueueSetup for super admins, so a retry that succeeds restores it.
  assert.match(board, /\{isSuper && <QueueSetup queues=\{board\.queues\}/);
  // The loading branch is what the retry shows while the reload is in flight.
  assert.match(board, /if \(!board\) return[\s\S]*?copy\("loading"\)/);
});

test('the retry label exists in all five locales', async () => {
  for (const code of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await src(`src/locales/${code}.json`));
    const retry = catalog?.customerWorkspace?.retry;
    assert.equal(typeof retry, 'string', `${code}: missing customerWorkspace.retry`);
    assert.ok(retry.length > 0, `${code}: empty customerWorkspace.retry`);
  }
});
