import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/admin/pages/AdminSearch.jsx', import.meta.url), 'utf8');

test('admin search derives visible types from the same grant scopes as the API', () => {
  assert.match(source, /useMyScopes/);
  assert.match(source, /const ENTITY_GRANT_REQUIREMENTS =/);
  assert.match(source, /ALL_TYPES\.filter\(\(type\) => granted\.has\(ENTITY_GRANT_REQUIREMENTS\[type\]\)\)/);
  assert.match(source, /const permittedTypes = useMemo/);
});
