import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve('src/admin/pages/JobsList.jsx'),
  'utf8',
);

test('admin jobs delete workflow declares all modal state', () => {
  for (const name of ['deleting', 'deleteReason', 'deleteError', 'deleteLoading']) {
    assert.match(source, new RegExp(`const \\[${name}, set${name[0].toUpperCase()}${name.slice(1)}\\] = useState`));
  }
  assert.match(source, /handleDeleteConfirm/);
});
