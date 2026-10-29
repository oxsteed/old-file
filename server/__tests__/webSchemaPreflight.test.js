'use strict';

const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { verifyWebSchema } = require('../services/webSchemaPreflight');
const { prepareRuntimeSchema } = require('../scripts/prepare-runtime-schema.cjs');
let migrationsDir;
const file = '20261029000000_synthetic.sql';
const sql = 'CREATE TABLE synthetic_must_not_execute(id int);';
const checksum = crypto.createHash('sha256').update(sql).digest('hex');
beforeEach(() => { migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-schema-')); fs.writeFileSync(path.join(migrationsDir, file), sql); });
afterEach(() => fs.rmSync(migrationsDir, { recursive: true, force: true }));
function fixture(rows) {
  const client = { query: jest.fn(async statement => ({ rows: statement.startsWith('SELECT ') ? rows : [] })), release: jest.fn() };
  return { client, pool: { connect: jest.fn().mockResolvedValue(client) }, migrationsDir };
}
test('a compatible catalog is inspected in a read-only transaction without importing or executing SQL', async () => {
  const f = fixture([{ filename: file, status: 'applied', checksum }]);
  await expect(verifyWebSchema(f)).resolves.toEqual({ ok: true, appliedMigrations: 1, checksumVerified: 1, legacyUnverified: 0 });
  expect(f.client.query.mock.calls.map(([statement]) => statement)).toEqual(['BEGIN READ ONLY',"SET LOCAL statement_timeout = '10s'",'SELECT filename, status, checksum FROM "public"._migrations','COMMIT']);
  expect(f.client.release).toHaveBeenCalledTimes(1);
});
test.each([
  [[], 'pending'],
  [[{ filename: file, status: 'failed', checksum }], 'incomplete'],
  [[{ filename: file, status: 'applying', checksum }], 'incomplete'],
  [[{ filename: file, status: 'applied', checksum: '0'.repeat(64) }], 'changed'],
  [[{ filename: file, status: 'applied', checksum }, { filename: 'unexpected.sql', status: 'applied', checksum }], 'unexpected'],
])('incompatible metadata refuses promotion without backfill, retry or DDL', async (rows, kind) => {
  const f = fixture(rows);
  await expect(verifyWebSchema(f)).rejects.toMatchObject({ code: 'WEB_SCHEMA_NOT_READY', counts: { [kind]: 1 } });
  expect(f.client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  expect(f.client.query.mock.calls.every(([statement]) => /^(BEGIN READ ONLY|SET LOCAL|SELECT|ROLLBACK)/.test(statement))).toBe(true);
  expect(f.client.release).toHaveBeenCalledTimes(1);
});
test('legacy applied rows preserve the runner policy without claiming historical verification or writing a baseline', async () => {
  const f = fixture([{ filename: file, status: 'applied', checksum: null }]);
  await expect(verifyWebSchema(f)).resolves.toEqual({ ok: true, appliedMigrations: 1, checksumVerified: 0, legacyUnverified: 1 });
  expect(f.client.query.mock.calls.some(([statement]) => /UPDATE|INSERT|CREATE|ALTER/.test(statement))).toBe(false);
});
test('an unavailable migration table is not created by the web checker', async () => {
  const f = fixture([]);
  f.client.query.mockImplementation(async statement => { if (statement.startsWith('SELECT ')) throw Object.assign(Error('Synthetic unavailable table'),{ code: '42P01' }); return { rows: [] }; });
  await expect(verifyWebSchema(f)).rejects.toMatchObject({ code: '42P01' });
  expect(f.client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  expect(f.client.query.mock.calls.some(([statement]) => /CREATE|ALTER|INSERT|UPDATE/.test(statement))).toBe(false);
});
test('startup dispatches web verification and combined migration independently, rejecting unknown roles first', async () => {
  const verify = jest.fn().mockResolvedValue({ ok: true }), migrate = jest.fn().mockResolvedValue(undefined);
  await prepareRuntimeSchema({ env: { OXSTEED_RUNTIME_ROLE: 'web' }, verify, migrate });
  expect(verify).toHaveBeenCalledTimes(1); expect(migrate).not.toHaveBeenCalled();
  await prepareRuntimeSchema({ env: {}, verify, migrate });
  expect(migrate).toHaveBeenCalledTimes(1);
  await expect(prepareRuntimeSchema({ env: { OXSTEED_RUNTIME_ROLE: 'unrecognized' }, verify, migrate })).rejects.toThrow('Invalid OXSTEED_RUNTIME_ROLE');
  expect(verify).toHaveBeenCalledTimes(1); expect(migrate).toHaveBeenCalledTimes(1);
});
