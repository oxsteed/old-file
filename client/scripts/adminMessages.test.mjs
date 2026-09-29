import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve('src/admin/pages/AdminMessages.jsx'),
  'utf8',
);

test('admin messages uses localized and accessible controls', () => {
  assert.match(source, /useTranslation\(\)/);
  assert.match(source, /aria-label=\{t\('adminMessages\.searchPlaceholder'\)\}/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /role="status"/);
  assert.doesNotMatch(source, />Admin Messages</);
  assert.doesNotMatch(source, /placeholder="Search by name or email/);
});
