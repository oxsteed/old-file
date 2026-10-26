'use strict';

// Q11 / careers spec §6.14 and §19: the runner sorts by numeric prefix, the
// historical order is preserved exactly, and new files use timestamps.
const fs = require('fs');
const path = require('path');
const { listMigrationFiles } = require('../migrate');
const {
  sortMigrationFiles,
  compareMigrationFiles,
  migrationPrefix,
  isValidTimestampMigration,
  listOrderingProblems,
} = require('../migrationOrder');
const legacy = require('../migrationOrderLegacy.json');

const DIR = path.join(__dirname, '..', 'migrations');
const onDisk = () => fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'));
const LEGACY_MAX = BigInt(legacy.legacyMaxPrefix);

describe('migration ordering (Q11)', () => {
  test('numeric sort fixes the 6-digit text-sort trap', () => {
    const files = ['101_b.sql', '100000_late.sql', '099_a.sql', '99994_tail.sql', '20261026170000_ts.sql'];
    expect([...files].sort()).toEqual(['099_a.sql', '100000_late.sql', '101_b.sql', '20261026170000_ts.sql', '99994_tail.sql']);
    expect(sortMigrationFiles(files)).toEqual(['099_a.sql', '101_b.sql', '99994_tail.sql', '100000_late.sql', '20261026170000_ts.sql']);
  });

  test('ties on the numeric prefix keep the historical text order (610_ < 610b_)', () => {
    expect(compareMigrationFiles('610_audit.sql', '610b_repair.sql')).toBeLessThan(0);
    expect(sortMigrationFiles(['611_x.sql', '610b_r.sql', '610_a.sql'])).toEqual(['610_a.sql', '610b_r.sql', '611_x.sql']);
  });

  test('unprefixed filenames are refused rather than placed arbitrarily', () => {
    expect(() => migrationPrefix('runOnce.sql')).toThrow(/numeric prefix/);
  });

  test('the runner replays every historical file in exactly the old text order', () => {
    const runner = listMigrationFiles(DIR).filter((f) => migrationPrefix(f) <= LEGACY_MAX);
    expect(runner).toEqual(legacy.legacyFiles);
    expect([...legacy.legacyFiles].sort()).toEqual(legacy.legacyFiles);
  });

  test('99994 runs before every timestamp migration on a fresh database', () => {
    const files = listMigrationFiles(DIR);
    const tail = files.indexOf('99994_staff_minor_profiles_schedule_changes.sql');
    expect(tail).toBeGreaterThan(-1);
    for (const file of files.slice(tail + 1)) {
      expect(isValidTimestampMigration(file)).toBe(true);
    }
  });

  test('no new low-numbered file may slip in among the frozen historical files', () => {
    const lowNew = onDisk().filter((f) => migrationPrefix(f) <= LEGACY_MAX && !legacy.legacyFiles.includes(f));
    expect(lowNew).toEqual([]);
  });

  test('no duplicate prefixes beyond the frozen historical set', () => {
    expect(listOrderingProblems(onDisk(), { allowedDuplicatePrefixes: legacy.allowedDuplicatePrefixes })).toEqual([]);
    // The check really fires on a new duplicate and on an unprefixed name.
    expect(listOrderingProblems(['20261026170000_a.sql', '20261026170000_b.sql'])).toHaveLength(1);
    expect(listOrderingProblems(['notes.sql'])).toHaveLength(1);
  });

  test('timestamp validation rejects impossible dates and wrong widths', () => {
    expect(isValidTimestampMigration('20261026170000_careers_profiles.sql')).toBe(true);
    expect(isValidTimestampMigration('20261332170000_bad.sql')).toBe(false);
    expect(isValidTimestampMigration('2026102617000_short.sql')).toBe(false);
    expect(isValidTimestampMigration('20261026170000-dash.sql')).toBe(false);
  });
});
