// Migration runner for OxSteed v2
// Runs all SQL migration files in order, skipping already-applied ones
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./utils/logger');
const {
  classifyDatabaseError,
  describeDatabaseTarget,
  getDatabaseSslConfig,
} = require('./utils/databaseConfig');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: getDatabaseSslConfig(process.env.DATABASE_URL, process.env.NODE_ENV),
  connectionTimeoutMillis: Math.max(1000, Math.min(Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 5000, 30000)),
});

const MIGRATION_LOCK_KEY = 88421931;

function migrationChecksum(sql) {
  return crypto.createHash('sha256').update(String(sql)).digest('hex');
}

function listMigrationFiles(migrationsDir) {
  return fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

async function migrate() {
  // Hold one database-level lock for the complete run. This protects both the
  // pending-migration read and the marker writes across multiple deploy
  // processes or application replicas.
  let lockClient;
  try {
    lockClient = await pool.connect();
    await lockClient.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    await lockClient.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT now(),
        status VARCHAR(20) NOT NULL DEFAULT 'applied',
        checksum CHAR(64),
        started_at TIMESTAMPTZ,
        error TEXT
      )
    `);
    // Existing installations predate the status/checksum fields.
    await lockClient.query(`
      ALTER TABLE _migrations
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'applied',
        ADD COLUMN IF NOT EXISTS checksum CHAR(64),
        ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS error TEXT
    `);
    const { rows: applied } = await lockClient.query(
      'SELECT filename, status, checksum FROM _migrations ORDER BY filename'
    );
    const migrationStates = new Map(applied.map((row) => [row.filename, row]));
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = listMigrationFiles(migrationsDir);

    logger.info('Migration runner started', {
      totalFiles: files.length,
      alreadyApplied: applied.filter((row) => row.status === 'applied').length,
    });

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const checksum = migrationChecksum(sql);
      const state = migrationStates.get(file);

      if (state?.status === 'applied') {
        if (state.checksum && state.checksum !== checksum) {
          throw new Error(`Migration ${file} checksum changed after it was applied; restore the original file or add a new migration.`);
        }
        logger.info('Migration already applied, skipping', { filename: file });
        continue;
      }

      if (state?.status === 'applying' || state?.status === 'failed') {
        throw new Error(`Migration ${file} is marked ${state.status}; reconcile the database before retrying. Previous error: ${state.error || 'none recorded'}`);
      }

      // Persist intent before executing SQL. If a migration contains its own
      // COMMIT and the process dies afterward, the next run stops safely for
      // reconciliation instead of silently executing it twice.
      await lockClient.query(
        `INSERT INTO _migrations (filename, status, checksum, started_at, error)
         VALUES ($1, 'applying', $2, NOW(), NULL)
         ON CONFLICT (filename) DO UPDATE SET
           status = 'applying', checksum = EXCLUDED.checksum,
           started_at = NOW(), error = NULL`,
        [file, checksum]
      );

      logger.info('Applying migration', { filename: file, checksum });
      const migClient = await pool.connect();
      try {
        await migClient.query(sql);
        await lockClient.query(
          `UPDATE _migrations
              SET status = 'applied', checksum = $2, applied_at = NOW(), error = NULL
            WHERE filename = $1`,
          [file, checksum]
        );
        migClient.release();
        logger.info('Migration applied successfully', { filename: file });
      } catch (err) {
        logger.error('Migration failed: ' + file + ' - ' + err.message);
        try { await migClient.query('ROLLBACK'); } catch (e) { /* ignore */ }
        migClient.release();
        await lockClient.query(
          `UPDATE _migrations SET status = 'failed', error = $2 WHERE filename = $1`,
          [file, String(err.message || 'Migration failed').slice(0, 4000)]
        ).catch((markerError) => logger.error('Failed to persist migration failure marker', {
          filename: file,
          error: markerError.message,
        }));
        const migrationError = new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
        migrationError.code = err.code;
        throw migrationError;
      }
    }

    logger.info('All migrations complete');
  } finally {
    if (lockClient) {
      await lockClient.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]).catch(() => {});
      lockClient.release();
    }
    await pool.end();
  }
}

module.exports = { MIGRATION_LOCK_KEY, migrationChecksum, listMigrationFiles, migrate };

if (require.main === module) migrate().catch(async (err) => {
  const databaseFailure = classifyDatabaseError(err);
  const databaseTarget = describeDatabaseTarget(process.env.DATABASE_URL);
  logger.error('Migration process failed', {
    category: databaseFailure.category,
    code: err.code || null,
    databaseTarget,
    error: String(err.message || 'Migration failed').slice(0, 500),
    hint: databaseFailure.hint,
  });
  console.error(`Migration startup failed (${databaseFailure.category}) for ${databaseTarget.user}@${databaseTarget.host}:${databaseTarget.port}/${databaseTarget.database}. ${databaseFailure.hint}`);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
