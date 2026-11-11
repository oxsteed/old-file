import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/admin/pages/Moderation.jsx', import.meta.url), 'utf8');

test('moderation only offers dismiss for rows carrying an admin flag', () => {
  assert.match(source, /item\.admin_flagged && \(/);
  assert.match(source, /action: 'unflag'/);
});
