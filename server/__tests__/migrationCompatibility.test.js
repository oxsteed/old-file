'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { loadCompatibility, filterReviewedFutureMigrations: filter } = require('../services/migrationCompatibility');
const required = '20261029000000_required.sql';
const future = '20261031000000_additive.sql';
const checksum = 'a'.repeat(64);
const old = { filename: required, status: 'applied', checksum };
const newer = { filename: future, status: 'applied', checksum };
const approved = { [future]: checksum };

test('only the exact reviewed, applied future migration is compatible; required rows remain visible', () => {
  expect(filter([old], [required], approved)).toEqual([old]);
  expect(filter([old, newer], [required], approved)).toEqual([old]);
  expect(filter([old, newer], [required, future], approved)).toEqual([old, newer]);
  expect(filter([old, newer], [required], {})).toEqual([old, newer]);
});
test.each([{ status: 'applying' }, { status: 'failed' }, { checksum: null },
  { checksum: 'b'.repeat(64) }, { filename: '20261101000000_unreviewed.sql' }])(
  'unapproved, changed or incomplete metadata is never hidden: %j', patch => {
    const row = { ...newer, ...patch };
    expect(filter([old, row], [required], approved)).toEqual([old, row]);
  });
test('duplicate records remain visible to the strict startup checker', () => {
  expect(filter([old, newer, newer], [required], approved)).toEqual([old, newer, newer]);
});
test('the immutable manifest fails closed if malformed and normal images have no allowance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-compatibility-'));
  const file = path.join(dir, 'manifest.json');
  try {
    expect(loadCompatibility(file)).toEqual({});
    fs.writeFileSync(file, JSON.stringify({ version: 1, migrations: approved }));
    expect(loadCompatibility(file)).toEqual(approved);
    for (const value of [{}, { version: 1, migrations: [] }, { version: 1, migrations: { '../a.sql': checksum } },
      { version: 1, migrations: { [future]: 'latest' } }]) {
      fs.writeFileSync(file, JSON.stringify(value));
      expect(() => loadCompatibility(file)).toThrow();
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
