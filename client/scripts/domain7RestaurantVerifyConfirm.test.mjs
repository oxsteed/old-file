// Domain 7 #21: restaurant Verify / Unverify must confirm through the same
// ConfirmDialog as Suspend / Restore, instead of flipping on one click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(
  path.join(clientRoot, 'src/admin/pages/AdminRestaurantDetail.jsx'), 'utf8');

test('Verify/Unverify routes through setConfirm, not a direct runAction call', () => {
  assert.doesNotMatch(src, /runAction\('\/verify'/,
    'Verify/Unverify must not call runAction directly');
  assert.match(src, /onClick=\{\(\) => setConfirm\(\{\s*path: '\/verify'/,
    'Verify/Unverify button must open the ConfirmDialog with path /verify');
});

test('the verify confirm carries the toggled verified value and the success key', () => {
  const confirmCall = src.match(/setConfirm\(\{\s*path: '\/verify'[\s\S]*?\}\)/);
  assert.ok(confirmCall, 'no setConfirm call for /verify found');
  assert.match(confirmCall[0], /verified: !restaurant\.is_verified/);
  assert.match(confirmCall[0], /success: 'adminRestaurantDetail\.verifyDone'/);
  assert.match(confirmCall[0], /title: t\(restaurant\.is_verified \? 'adminRestaurantDetail\.unverify' : 'adminRestaurantDetail\.verify'\)/);
});

test('the shared ConfirmDialog still executes the confirmed action', () => {
  assert.match(src, /onConfirm=\{async \(\) => \{\s*setConfirm\(null\);\s*await runAction\(confirm\.path, confirm\.body, confirm\.success\);/);
});

test('Suspend and Restore still confirm through the same dialog', () => {
  assert.match(src, /setConfirm\(\{\s*path: '\/suspend'/);
  assert.match(src, /setConfirm\(\{\s*path: '\/restore'/);
});
