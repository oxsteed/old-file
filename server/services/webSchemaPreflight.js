'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sortMigrationFiles } = require('../migrationOrder');

async function verifyWebSchema({ pool, migrationsDir = path.join(__dirname, '../migrations'), schema = 'public' }) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new TypeError('Invalid migration schema');
  const files = sortMigrationFiles(fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')));
  if (!files.length) throw Object.assign(new Error('Migration catalog is empty'), { code: 'WEB_SCHEMA_CATALOG_EMPTY' });
  const expected = new Map(files.map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDir, file), 'utf8')).digest('hex')]));
  const client = await pool.connect();
  let transaction = false;
  try {
    // The web process must be unable to execute migration SQL or establish a
    // checksum baseline, even if this checker later gains another query.
    await client.query('BEGIN READ ONLY'); transaction = true;
    await client.query("SET LOCAL statement_timeout = '10s'");
    const { rows } = await client.query(`SELECT filename, status, checksum FROM "${schema}"._migrations`);
    const recorded = new Map(rows.map(row => [row.filename, row]));
    const counts = { pending: 0, unexpected: 0, incomplete: 0, unverified: 0, changed: 0, duplicate: rows.length - recorded.size };
    for (const [file, checksum] of expected) {
      const row = recorded.get(file);
      if (!row) { counts.pending++; continue; }
      if (row.status !== 'applied') counts.incomplete++;
      if (!row.checksum) counts.unverified++;
      else if (row.checksum !== checksum) counts.changed++;
    }
    for (const file of recorded.keys()) if (!expected.has(file)) counts.unexpected++;
    // The established runner accepts legacy applied rows without a checksum
    // and logs that historical bytes are unverified. Preserve that policy,
    // but never write its forward baseline from a web-only replacement.
    if (Object.entries(counts).some(([name, value]) => name !== 'unverified' && value !== 0)) {
      throw Object.assign(new Error('Web schema requires a coordinated migration release'), { code: 'WEB_SCHEMA_NOT_READY', counts });
    }
    await client.query('COMMIT'); transaction = false;
    return { ok: true, appliedMigrations: files.length,
      checksumVerified: files.length - counts.unverified, legacyUnverified: counts.unverified };
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

module.exports = { verifyWebSchema };
