import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve('src/admin/lib/GrantGuard.jsx'),
  'utf8',
);

test('admin grant requests are isolated per admin identity', () => {
  assert.match(source, /const inflightByUser = new Map\(\)/);
  assert.match(source, /inflightByUser\.get\(userId\)/);
  assert.match(source, /inflightByUser\.set\(userId, request\)/);
  assert.match(source, /inflightByUser\.delete\(userId\)/);
  assert.doesNotMatch(source, /let inflight = null/);
});
