import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve('src/admin/pages/AdminSearch.jsx'),
  'utf8',
);

test('admin search resolves domain grants before sending explicit type filters', () => {
  assert.match(source, /useMyScopes/);
  assert.match(source, /const ENTITY_GRANT_REQUIREMENTS =/);
  assert.match(source, /const permittedTypes = useMemo/);
  assert.match(source, /if \(!scopesLoading && types\.length && q\.trim\(\)\.length >= 2\)/);
  assert.match(source, /entityTypes\.join\(',?'\)/);
  assert.match(source, /permittedTypes\.map/);
});
