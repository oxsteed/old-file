'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { violations } = require('./check-migration-history.cjs');
const base = new Map([['server/migrations/99987_existing.sql', 'original']]);
test('rejects edits, removals, duplicate numbers and backwards-sorting additions', () => {
  assert.match(violations(base, new Map()).join(), /changed or removed/);
  assert.match(violations(base, new Map([['server/migrations/99987_existing.sql', 'edited']])).join(), /changed or removed/);
  for (const name of ['99987_other.sql', '100000_backwards.sql']) {
    assert.ok(violations(base, new Map([...base, [`server/migrations/${name}`, 'new']])).length);
  }
});
test('allows historical duplicate prefixes unchanged and new monotonically appended files', () => {
  const historical = new Map([...base, ['server/migrations/100_a.sql', 'a'], ['server/migrations/100_b.sql', 'b']]);
  assert.deepEqual(violations(historical, new Map([...historical, ['server/migrations/99988_new.sql', 'new']])), []);
});
