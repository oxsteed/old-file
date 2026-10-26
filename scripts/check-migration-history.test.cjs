'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { violations } = require('./check-migration-history.cjs');
const base = new Map([['server/migrations/99987_existing.sql', 'original']]);
test('rejects edits, removals, duplicate numbers and backwards-sorting additions', () => {
  assert.match(violations(base, new Map()).join(), /changed or removed/);
  assert.match(violations(base, new Map([['server/migrations/99987_existing.sql', 'edited']])).join(), /changed or removed/);
  for (const name of ['99987_other.sql', '99986_backwards.sql', 'A00001_letter_band.sql']) {
    assert.ok(violations(base, new Map([...base, [`server/migrations/${name}`, 'new']])).length, name);
  }
});
test('allows historical duplicate prefixes unchanged and new timestamp files appended', () => {
  const historical = new Map([...base, ['server/migrations/100_a.sql', 'a'], ['server/migrations/100_b.sql', 'b']]);
  assert.deepEqual(violations(historical, new Map([...historical, ['server/migrations/20261026170000_new.sql', 'new']])), []);
});
test('Q11: new server migrations need a real YYYYMMDDHHMMSS_ timestamp prefix', () => {
  const tail = new Map([['server/migrations/99994_last_numeric.sql', 'x']]);
  // A plain larger number now sorts correctly but is still refused: new files use timestamps.
  assert.match(violations(tail, new Map([...tail, ['server/migrations/100000_plain.sql', 'w']])).join(), /YYYYMMDDHHMMSS/);
  // Not a real date/time.
  assert.ok(violations(tail, new Map([...tail, ['server/migrations/20261399000000_bad_month.sql', 'w']])).length);
  assert.deepEqual(violations(tail, new Map([...tail, ['server/migrations/20261026170000_careers.sql', 'n']])), []);
  const stamped = new Map([...tail, ['server/migrations/20261026170000_careers.sql', 'n']]);
  // Two new files in one change are each checked in runner order.
  assert.deepEqual(violations(stamped, new Map([...stamped,
    ['server/migrations/20261026170200_b.sql', 'b'], ['server/migrations/20261026170100_a.sql', 'a']])), []);
  // A timestamp older than the newest already on the default branch is out of order.
  assert.match(violations(stamped, new Map([...stamped, ['server/migrations/20261026160000_older.sql', 'o']])).join(), /must sort after/);
  // Duplicate timestamp prefix.
  assert.ok(violations(stamped, new Map([...stamped, ['server/migrations/20261026170000_dup.sql', 'd']])).length);
});
test('ClickHouse migrations keep their letter-prefixed text order', () => {
  const ch = new Map([['server/migrations-clickhouse/C002_activity_events.sql', 'x']]);
  assert.deepEqual(violations(ch, new Map([...ch, ['server/migrations-clickhouse/C003_next.sql', 'n']])), []);
  assert.ok(violations(ch, new Map([...ch, ['server/migrations-clickhouse/C001_old.sql', 'n']])).length);
});
