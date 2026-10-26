// N-10: guard against CI test globs that silently skip nested folders.
// GitHub Actions runs `run:` steps in bash without `globstar`, so an
// unquoted `**/` behaves like `*/` and only matches one directory level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ci = fs.readFileSync(path.resolve(here, '../../.github/workflows/ci.yml'), 'utf8');

test('no CI shell step relies on an unquoted ** glob', () => {
  const offenders = ci.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !line.trim().startsWith('#'))
    .filter(({ line }) => /(^|\s)[^\s'"]*\*\*\/[^\s'"]*/.test(line))
    .filter(({ line }) => !/shopt -s globstar/.test(ci));
  assert.deepEqual(offenders, [], `unquoted ** globs: ${offenders.map((o) => `${o.n}: ${o.line.trim()}`).join('; ')}`);
});

test('client src unit tests are discovered at every depth', () => {
  assert.match(ci, /find src -name '\*\.test\.mjs'/);
});
