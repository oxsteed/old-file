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
test('D-ENG-11: after 99999 the next band is a letter prefix that still sorts last', () => {
  const tail = new Map([['server/migrations/99999_last_numeric.sql', 'x']]);
  assert.deepEqual(violations(tail, new Map([...tail, ['server/migrations/A00001_first_letter_band.sql', 'n']])), []);
  const lettered = new Map([...tail, ['server/migrations/A00001_first.sql', 'a']]);
  assert.deepEqual(violations(lettered, new Map([...lettered, ['server/migrations/A00002_second.sql', 'b']])), []);
  // A longer numeric prefix sorts BEFORE 99999 lexically and is refused.
  assert.ok(violations(tail, new Map([...tail, ['server/migrations/100000_wrong.sql', 'w']])).length);
  // The runner sorts with the same plain string order the guard checks.
  assert.deepEqual(['A00001_a.sql', '99999_z.sql', '99991_y.sql'].sort(), ['99991_y.sql', '99999_z.sql', 'A00001_a.sql']);
});
