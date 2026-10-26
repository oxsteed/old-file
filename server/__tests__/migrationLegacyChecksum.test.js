'use strict';
const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');
const { migrate, migrationChecksum, listMigrationFiles } = require('../migrate');
beforeEach(resetMocks);
test('legacy applied rows receive a forward checksum baseline without rerunning SQL', async () => {
  const directory = path.join(__dirname,'../migrations');
  const files = listMigrationFiles(directory);
  const rows = files.map((filename, i) => ({ filename, status: 'applied', checksum: i === 0 ? null : migrationChecksum(fs.readFileSync(path.join(directory,filename),'utf8')) }));
  mockQuery.mockImplementation(async sql => ({ rows: sql.includes('SELECT filename, status, checksum') ? rows : [] }));
  await migrate();
  const backfill = mockQuery.mock.calls.filter(([sql]) => sql.includes('checksum IS NULL'));
  expect(backfill).toHaveLength(1);
  expect(backfill[0][1]).toEqual([files[0],migrationChecksum(fs.readFileSync(path.join(directory,files[0]),'utf8'))]);
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes("VALUES ($1, 'applying'"))).toBe(false);
});
