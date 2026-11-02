'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { applyReviewedSchema } = require('./apply-reviewed-web-schema.cjs');

test('reviewed additions and markers share one bounded transaction; dry runs and legacy rows never write', async () => {
  const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-schema-'));
  const old = '20261030000000_old.sql', next = '20261031000000_next.sql';
  const sql = 'ALTER TABLE example ADD COLUMN extra text;';
  fs.writeFileSync(path.join(migrationsDir, old), 'SELECT 1;');
  fs.writeFileSync(path.join(migrationsDir, next), sql);
  const plan = { migrations: { [next]: crypto.createHash('sha256').update(sql).digest('hex') } };
  let calls, fail = false;
  const client = { release() {}, async query(query) {
    calls.push(query);
    if (query.includes('pg_try_advisory')) return { rows: [{ locked: true }] };
    if (query.startsWith('SELECT filename')) return { rows: [{ filename: old, status: 'applied', checksum: null }] };
    if (fail && query === sql) throw Error('synthetic lock failure');
    return { rows: [] };
  } };
  const opts = { pool: { connect: async () => client }, migrationsDir, plan };
  try {
    calls = [];
    assert.deepEqual((await applyReviewedSchema(opts)).pending, [next]);
    assert.equal(calls[0], 'BEGIN READ ONLY');
    assert.equal(calls.some(q => /^(ALTER|INSERT|UPDATE)/.test(q)), false);
    calls = [];
    assert.deepEqual((await applyReviewedSchema({ ...opts, apply: true })).applied, [next]);
    assert.equal(calls[0], 'BEGIN'); assert.equal(calls.at(-1), 'COMMIT');
    assert.ok(calls.includes("SET LOCAL lock_timeout = '1s'"));
    assert.ok(calls.indexOf(sql) < calls.findIndex(q => q.startsWith('INSERT')));
    assert.equal(calls.some(q => q.startsWith('UPDATE')), false);
    calls = []; fail = true;
    await assert.rejects(applyReviewedSchema({ ...opts, apply: true }), /synthetic lock failure/);
    assert.equal(calls.at(-1), 'ROLLBACK');
    assert.equal(calls.some(q => q === 'COMMIT' || q.startsWith('INSERT')), false);
    fs.appendFileSync(path.join(migrationsDir, next), '-- changed');
    await assert.rejects(applyReviewedSchema(opts), /source changed/);
  } finally { fs.rmSync(migrationsDir, { recursive: true, force: true }); }
});
