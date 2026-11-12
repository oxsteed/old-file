import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/pages/LifeDashboard.jsx', import.meta.url), 'utf8');

test('Life dashboard uses the server-supported planned-needs filters', () => {
  assert.match(source, /\/planned-needs\?status=planned,funding,activating_soon/);
  assert.match(source, /\/planned-needs\/projection\?window=3m/);
  assert.doesNotMatch(source, /\/planned-needs\?status=active/);
  assert.doesNotMatch(source, /\/planned-needs\/projection\?days=90/);
});
