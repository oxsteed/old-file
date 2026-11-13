// Domain 7 #23: a failed pay-run detail fetch must show its error (with a
// retry) on the run that was clicked, never under a different run's card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(
  path.join(clientRoot, 'src/admin/pages/super/RestaurantPayRuns.jsx'), 'utf8');

test('loadDetail records which run was requested', () => {
  assert.match(src, /const \[detailRunId, setDetailRunId\] = useState\(null\)/);
  assert.match(src, /setDetailRunId\(id\)/);
});

test('a failed detail load clears any stale detail from another run', () => {
  const loadDetail = src.slice(src.indexOf('const loadDetail'), src.indexOf('useEffect(() => { setOffset'));
  assert.match(loadDetail, /catch \(err\) \{/);
  assert.match(loadDetail, /setDetail\(null\)/);
});

test('detailError renders outside the detail block, keyed to the requested run', () => {
  // The error block must be a sibling of the detail block, not nested in it.
  const detailBlock = src.indexOf('{detail?.id === run.id && (');
  assert.ok(detailBlock > 0, 'detail block not found');
  const errorBlock = src.indexOf('{detailRunId === run.id && detailError && (');
  assert.ok(errorBlock > 0, 'keyed error block not found');
  assert.ok(errorBlock < detailBlock || errorBlock > src.indexOf(')}', detailBlock),
    'error block must sit outside the detail block');
  // And no error render may remain inside the detail block.
  const inside = src.slice(detailBlock, src.indexOf(')}', detailBlock));
  assert.doesNotMatch(inside, /detailError/);
});

test('the keyed error block offers a retry that reloads the same run', () => {
  const at = src.indexOf('{detailRunId === run.id && detailError && (');
  const block = src.slice(at, at + 800);
  assert.match(block, /role="alert"/);
  assert.match(block, /onClick=\{\(\) => loadDetail\(run\.id\)\}/);
  assert.match(block, /common\.retry/);
});
