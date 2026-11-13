// Nov 10 #4 (STILL LIVE): a TeamBoard load failure early-returns with only
// a message, no retry, and QueueSetup renders only in the success branch.
// The error state must offer a retry that re-runs the load; on success the
// board (and QueueSetup for super admins) renders again.
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
  // A named retry handler: clears the error (back to the loading state) and
  // re-runs the board + saved-views loads.
  assert.match(board, /const retryBoard = \(\) => \{[^}]*setBoard\(null\)[^}]*loadBoard\(filters, viewId\)/s);
  assert.match(board, /loadViews\(\)\.catch\(\(\) => \{\}\)/);
  // The error branch renders the message AND the retry button.
  const errorBranch = board.split('if (board?.error)')[1].split('\n')[0];
  assert.match(errorBranch, /role="alert"/);
  assert.match(errorBranch, /<button type="button" onClick=\{retryBoard\}>/);
  assert.match(errorBranch, /copy\("retry"\)/);
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
