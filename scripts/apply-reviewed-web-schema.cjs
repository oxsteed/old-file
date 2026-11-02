'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sortMigrationFiles } = require('../server/migrationOrder');
const PLAN = require('../deploy/web-schema-bridge-20261102.json');
const checksum = sql => crypto.createHash('sha256').update(sql).digest('hex');

// Operator-run only, after the bridge is live. All reviewed additions and their
// markers commit together: the serving bridge never sees partially applied DDL.
// Do not establish a checksum baseline for legacy rows during this operation.
async function applyReviewedSchema({ pool, apply = false,
  migrationsDir = path.join(__dirname, '../server/migrations'), plan = PLAN }) {
  const files = sortMigrationFiles(fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')));
  const sources = new Map(files.map(f => [f, fs.readFileSync(path.join(migrationsDir, f), 'utf8')]));
  for (const [name, hash] of Object.entries(plan.migrations)) {
    if (!sources.has(name) || checksum(sources.get(name)) !== hash) throw Error('Reviewed migration source changed');
    // This release plan contains no transaction controls. A future plan must
    // be reviewed separately instead of weakening this atomic boundary.
    const sql = sources.get(name).replace(/--[^\n]*/g, '');
    if (/\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(sql.replace(/\$\$[\s\S]*?\$\$/g, ''))) throw Error('Migration controls its own transaction');
  }
  const client = await pool.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    await client.query("SET LOCAL lock_timeout = '1s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const locked = await client.query('SELECT pg_try_advisory_xact_lock(88421931::bigint) AS locked');
    if (!locked.rows[0]?.locked) throw Error('Another migration operation is active');
    const { rows } = await client.query('SELECT filename, status, checksum FROM _migrations');
    const recorded = new Map(rows.map(row => [row.filename, row]));
    if (rows.length !== recorded.size) throw Error('Duplicate migration markers');
    for (const row of rows) {
      if (!sources.has(row.filename) || row.status !== 'applied'
          || (row.checksum && row.checksum !== checksum(sources.get(row.filename)))) throw Error('Existing migration metadata is incompatible');
    }
    const pending = files.filter(file => !recorded.has(file));
    if (pending.some(file => !Object.hasOwn(plan.migrations, file))) throw Error('Unreviewed pending migration');
    if (apply) {
      for (const file of pending) {
        await client.query(sources.get(file));
        await client.query("INSERT INTO _migrations(filename,status,checksum,started_at,applied_at,error) VALUES($1,'applied',$2,now(),now(),NULL)", [file, plan.migrations[file]]);
      }
    }
    await client.query('COMMIT');
    return { ok: true, applied: apply ? pending : [], pending: apply ? [] : pending,
      legacyUnverified: rows.filter(row => !row.checksum).map(row => row.filename) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

module.exports = { applyReviewedSchema };
