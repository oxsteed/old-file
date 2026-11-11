import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/admin/pages/UsersList.jsx'),
  'utf8',
);

test('bulk user status actions send explicit desired state', () => {
  assert.match(source, /adminApi\.post\(`\/admin\/users\/\$\{id\}\/ban`,\s*\{\s*is_active:\s*suspend\s*\}\)/);
});
