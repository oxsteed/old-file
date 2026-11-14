'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { violations, pgConstraintGuardViolations } = require('./check-migration-history.cjs');
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

test('new migrations must scope pg_constraint guards with conrelid or connamespace', () => {
  const file = 'server/migrations/20261113120000_x.sql';
  const unscoped = `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='x_fk') THEN
      ALTER TABLE t ADD CONSTRAINT x_fk FOREIGN KEY (a) REFERENCES o(id);
    END IF;
  END $$;`;
  assert.match(pgConstraintGuardViolations(new Map([[file, unscoped]])).join(), /unscoped pg_constraint guard/);
  const scopedRelid = unscoped.replace("WHERE conname='x_fk'", "WHERE conname='x_fk' AND conrelid = 't'::regclass");
  assert.deepEqual(pgConstraintGuardViolations(new Map([[file, scopedRelid]])), []);
  const scopedJoin = `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE c.conname='x_fk') THEN
      ALTER TABLE t ADD CONSTRAINT x_fk FOREIGN KEY (a) REFERENCES o(id);
    END IF;
  END $$;`;
  assert.deepEqual(pgConstraintGuardViolations(new Map([[file, scopedJoin]])), []);
  const scopedNamespace = unscoped.replace("WHERE conname='x_fk'", "WHERE conname='x_fk' AND connamespace = 'public'::regnamespace");
  assert.deepEqual(pgConstraintGuardViolations(new Map([[file, scopedNamespace]])), []);
  // A comment mentioning pg_constraint does not trip the check.
  assert.deepEqual(pgConstraintGuardViolations(new Map([[file, '-- see pg_constraint docs\nSELECT 1;']])), []);
  // Two guards in one DO block: one scoped guard does not mask an unscoped one.
  const mixed = `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='a_fk' AND conrelid = 't'::regclass) THEN
      ALTER TABLE t ADD CONSTRAINT a_fk FOREIGN KEY (a) REFERENCES o(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='b_fk') THEN
      ALTER TABLE t ADD CONSTRAINT b_fk FOREIGN KEY (b) REFERENCES o(id);
    END IF;
  END $$;`;
  assert.match(pgConstraintGuardViolations(new Map([[file, mixed]])).join(), /unscoped pg_constraint guard/);
});

test('allows only both byte-identical PR #699 renames from the failed baseline', () => {
  const failedBase = 'd11ee1568168de95474eb9bc839a4b76a647b10f';
  const latest = ['server/migrations/20261109080000_customer360_worker_heartbeats.sql', 'latest'];
  const index = 'stripe_chargebacks_payment_intent_index.sql';
  const payout = 'payout_transactions_completed_at.sql';
  const indexBlob = '5e7a6dbc1e9ad0a4a1a955a50a86339f0373320b';
  const payoutBlob = '85a2fe3faed37ce159592aab72671c2b530fd912';
  const before = new Map([latest,
    [`server/migrations/20261109020000_${index}`, indexBlob],
    [`server/migrations/20261109020100_${payout}`, payoutBlob]]);
  const newIndex = `server/migrations/20261109231751_${index}`;
  const newPayout = `server/migrations/20261109231752_${payout}`;
  const after = new Map([latest, [newIndex, indexBlob], [newPayout, payoutBlob]]);
  assert.deepEqual(violations(before, after, failedBase), []);
  assert.match(violations(before, after).join(), /changed or removed/);
  assert.match(violations(before, new Map(after).set(newIndex, 'changed'), failedBase).join(), /changed or removed/);
  assert.match(violations(before, new Map([latest, [newIndex, indexBlob]]), failedBase).join(), /changed or removed/);
  assert.match(violations(before, new Map(after).set(latest[0], 'changed'), failedBase).join(), /changed or removed/);
  const backdated = 'server/migrations/20261109060000_other.sql';
  assert.match(violations(before, new Map(after).set(backdated, 'new'), failedBase).join(), /must sort after/);
});
