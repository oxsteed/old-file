import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve('src/admin/pages/AdminSearch.jsx'), 'utf8');

test('admin search surfaces unavailable sources instead of presenting incomplete results as empty', () => {
  assert.match(source, /source_status/);
  assert.match(source, /state === 'unavailable'/);
  assert.match(source, /adminSearch\.sourcesUnavailable/);
  assert.match(source, /role="alert"/);
});
