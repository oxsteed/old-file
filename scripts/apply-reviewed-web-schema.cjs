'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sortMigrationFiles } = require('../server/migrationOrder');
const PLAN = require('../deploy/web-schema-bridge.json');
const checksum = sql => crypto.createHash('sha256').update(sql).digest('hex');

// Operator-run only, after the bridge is live. All reviewed additions and their
// markers commit together: the serving bridge never sees partially applied DDL.
// Do not establish a checksum baseline for legacy rows during this operation.
async function applyReviewedSchema({ pool, apply = false,
  migrationsDir = path.join(__dirname, '../server/migrations'),
  reviewedDir = process.env.REVIEWED_MIGRATIONS_DIR || null, plan = PLAN }) {
  const files = sortMigrationFiles(fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')));
  const sources = new Map(files.map(f => [f, fs.readFileSync(path.join(migrationsDir, f), 'utf8')]));
  if (reviewedDir && fs.existsSync(reviewedDir)) {
    for (const file of fs.readdirSync(reviewedDir).filter(f => f.endsWith('.sql'))) {
      if (!sources.has(file)) { files.push(file); sources.set(file, fs.readFileSync(path.join(reviewedDir, file), 'utf8')); }
    }
    files.splice(0, files.length, ...sortMigrationFiles(files));
  }
  const statements = new Map();
  for (const [name, hash] of Object.entries(plan.migrations)) {
    if (!sources.has(name) || checksum(sources.get(name)) !== hash) throw Error('Reviewed migration source changed');
    let sql = sources.get(name);
    if (plan.transactionWrapped?.includes(name)) {
      // Keep the original file and checksum for migration history. Replace
      // only the reviewed outer transaction with the bridge's transaction.
      const wrapper = /^(?:\s|--[^\n]*\n)*BEGIN;([\s\S]+)\nCOMMIT;\s*$/i.exec(sql);
      if (!wrapper) throw Error('Reviewed migration has an unexpected transaction wrapper');
      sql = wrapper[1];
    }
    const executable = sql.replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, '');
    if (/(?:^|;)\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|PREPARE\s+TRANSACTION)\b/i.test(executable)) {
      throw Error('Migration controls its own transaction');
    }
    statements.set(name, sql);
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
          || (Object.hasOwn(plan.migrations, row.filename) && row.checksum !== plan.migrations[row.filename])
          || (row.checksum && row.checksum !== checksum(sources.get(row.filename)))) throw Error('Existing migration metadata is incompatible');
    }
    const pending = files.filter(file => !recorded.has(file));
    if (pending.some(file => !Object.hasOwn(plan.migrations, file))) throw Error('Unreviewed pending migration');
    if (apply) {
      for (const file of pending) {
        await client.query(statements.get(file));
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

if (require.main === module) {
  const apply = process.argv.length === 3 && process.argv[2] === '--apply';
  if (!apply && !(process.argv.length === 2)) {
    console.error('Use --apply to commit the reviewed schema plan, or no arguments for read-only preflight.');
    process.exitCode = 1;
  } else if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required inside the serving runtime.');
    process.exitCode = 1;
  } else {
    const { Pool } = require('../server/node_modules/pg');
    const { getDatabaseSslConfig } = require('../server/utils/databaseConfig');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL,
      ssl: getDatabaseSslConfig(process.env.DATABASE_URL, process.env.NODE_ENV),
      max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    applyReviewedSchema({ pool, apply }).then(result => {
      console.log(JSON.stringify(result));
    }).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    }).finally(() => pool.end());
  }
}
