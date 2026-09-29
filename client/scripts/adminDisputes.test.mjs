import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve('src/admin/pages/Disputes.jsx'),
  'utf8',
);

test('admin dispute review refreshes the authoritative query result', () => {
  assert.match(source, /await adminApi\.post\(`\/disputes\/admin\/\$\{disputeId\}\/review`\)/);
  assert.match(source, /await reload\(\)/);
  assert.doesNotMatch(source, /setDisputes\(/);
});

test('admin disputes uses translated labels and locale-aware dates', () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /adminDisputes\.count/);
  assert.match(source, /adminDisputes\.evidenceDeadline/);
  assert.match(source, /adminDate\(/);
});
