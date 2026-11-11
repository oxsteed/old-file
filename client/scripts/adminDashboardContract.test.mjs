import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/admin/pages/super/Dashboard.jsx'),
  'utf8',
);

test('regular admin dashboard renders only fields returned by its stats contract', () => {
  assert.match(source, /!isSuper\s*&&\s*\(/);
  assert.match(source, /s\?\.new_users_7d/);
  assert.match(source, /s\?\.new_jobs_7d/);
  assert.match(source, /\{isSuper\s*&&\s*\(<section>/);
  assert.doesNotMatch(source, /!isSuper[\s\S]{0,500}s\?\.new_users_period/);
});
