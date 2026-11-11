import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/admin/pages/AdminSearch.jsx', import.meta.url), 'utf8');

test('admin search derives visible types from the same grant scopes as the API', () => {
  assert.match(source, /useMyScopes/);
  assert.match(source, /const TYPE_GRANTS =/);
  assert.match(source, /ALL_TYPES\.filter\(type => scopes\.includes\(TYPE_GRANTS\[type\]\)\)/);
  assert.match(source, /disabled=\{loading \|\| !searchReady/);
});
