// Domain 7 #12: the compliance queue must page each list independently —
// one shared queuePage/offset with a max-of-three total desyncs the lists.
// The page must hold three page states and render three pagers, each
// driven by its own list total.
//
// Run: node --test scripts/domain7CompliancePager.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(
  path.join(root, 'src', 'admin', 'pages', 'super', 'oxsteedCredit', 'CompliancePage.jsx'),
  'utf8',
);

test('three independent page states, one per list', () => {
  for (const name of ['verificationsPage', 'sanctionsPage', 'casesPage']) {
    assert.match(page, new RegExp(`useState\\(0\\)`, 'g'), 'page states missing');
    assert.ok(page.includes(name), `missing page state ${name}`);
  }
  assert.doesNotMatch(page, /const \[queuePage, setQueuePage\]/, 'shared queuePage still present');
});

test('load sends a separate offset per list', () => {
  assert.match(page, /verificationsOffset/, 'verifications offset not sent');
  assert.match(page, /sanctionsOffset/, 'sanctions offset not sent');
  assert.match(page, /casesOffset/, 'cases offset not sent');
});

test('no pager derives its total from the max of the three counts', () => {
  assert.doesNotMatch(page, /Math\.max\(\s*Number\(counts\.pendingVerifications/, 'max-of-three pager total still present');
});

test('three pagers, each driven by its own list total', () => {
  // Three <QueuePager> usages, one under each table, each with its own total.
  const usages = page.match(/<QueuePager[^/]*\/>/g) || [];
  assert.equal(usages.length, 3, `expected 3 QueuePager usages, found ${usages.length}`);
  for (const total of ['counts.pendingVerifications', 'counts.pendingSanctions', 'counts.openCases']) {
    assert.ok(usages.some((u) => u.includes(`total={${total}}`)), `no pager driven by ${total}`);
  }
});
