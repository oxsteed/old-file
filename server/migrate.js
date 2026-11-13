// Migration runner for OxSteed v2
// Runs all SQL migration files in order, skipping already-applied ones
// Rehearsal may pass --through <exact-filename> to stop at a historical base.
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./utils/logger');
const { sortMigrationFiles, isValidTimestampMigration, migrationPrefix } = require('./migrationOrder');
// Frozen at the Q11 runner change (careers spec 6.14): every file in this
// list keeps its historical name and order, whatever the current rules
// say. Only files outside this set are subject to the timestamp rule.
const legacyOrder = require('./migrationOrderLegacy.json');
const LEGACY_FILES = new Set(legacyOrder.legacyFiles || []);
const LEGACY_MAX_PREFIX = BigInt(legacyOrder.legacyMaxPrefix || '99994');
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

// Nov 3 audit item 9: the timestamp and append-only rule used to be
// enforced by CI only (scripts/check-migration-history.cjs). The runtime
// path enforces it too, so a deploy that runs migrate without the CI
// gate cannot land a mis-ordered or misnamed migration on production
// before anyone notices. Frozen legacy files are exempt; everything else
// must be a valid 14-digit UTC timestamp name sorting after the legacy
// band (99994). A violation fails startup before any migration applies.
function validateMigrationFiles(files) {
  for (const file of files) {
    if (LEGACY_FILES.has(file)) continue;
    if (!isValidTimestampMigration(file)) {
      throw new Error(`Migration ${file} is not a valid UTC timestamp migration (expected YYYYMMDDHHMMSS_name.sql); refusing to run.`);
    }
    if (migrationPrefix(file) <= LEGACY_MAX_PREFIX) {
      throw new Error(`Migration ${file} sorts before the frozen legacy tail (99994); new migrations must sort after it. Refusing to run.`);
    }
  }
}

function listMigrationFiles(migrationsDir, through = null) {
  // Q11: numeric leading-prefix order (identical to the historical text
  // order for every pre-existing file; see migrationOrder.js).
  const files = sortMigrationFiles(
    fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'))
  );
  validateMigrationFiles(files);
  if (through === null) return files;
  const last = files.indexOf(through);
  if (last < 0) throw new Error(`Unknown migration boundary: ${through}`);
  return files.slice(0, last + 1);
}

// Domain 8 #5: a migration's RAISE WARNING used to vanish. The F-13
// migration skipped its unique index with only a warning, and no notice
// handler meant the skip left no record anywhere. Attach this to the
// client running a migration so every NOTICE/WARNING the server sends is
// logged durably with the migration that produced it. `log` is injectable
// so tests can capture notices without touching the real logger.
function attachMigrationNoticeHandler(client, filename, log = logger) {
  client.on('notice', (notice) => {
    log.warn('Migration notice', {
      filename,
      severity: notice.severity || null,
      message: notice.message || String(notice),
    });
  });
  return client;
}
// Pure function so the policy is unit-testable without a database.
//   skip  - already applied; verify the checksum below.
//   abort - a previous run died mid-migration ('applying'); the database may
//           be partially migrated, so a human must reconcile before retrying.
//   retry - a previous run recorded a clean failure ('failed'); the runner
//           rolls back after a failure and repo migrations are written
//           idempotently, so re-attempting is safe and lets a later repair
//           migration unblock the next deploy instead of halting every boot.
//   apply - never attempted before.
function resolveMigrationPlan(state) {
  if (state?.status === 'applied') return 'skip';
  if (state?.status === 'applying') return 'abort';
  if (state?.status === 'failed') return 'retry';
  return 'apply';
}

async function migrate({ through = null } = {}) {
  // Hold one database-level lock for the complete run. This protects both the
  // pending-migration read and the marker writes across multiple deploy
  // processes or application replicas.
  let lockClient;
  try {
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = listMigrationFiles(migrationsDir, through);
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

    logger.info('Migration runner started', {
      totalFiles: files.length,
      alreadyApplied: applied.filter((row) => row.status === 'applied').length,
    });

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const checksum = migrationChecksum(sql);
      const state = migrationStates.get(file);
      const plan = resolveMigrationPlan(state);

      if (plan === 'skip') {
        if (state.checksum && state.checksum !== checksum) {
          throw new Error(`Migration ${file} checksum changed after it was applied; restore the original file or add a new migration.`);
        }
        if (!state.checksum) {
          // Establish a forward baseline, not proof of historically applied bytes.
          await lockClient.query('UPDATE _migrations SET checksum=$2 WHERE filename=$1 AND checksum IS NULL', [file, checksum]);
          logger.warn('Legacy migration checksum baseline recorded; historical applied bytes remain unverified', { filename: file });
        }
        logger.info('Migration already applied, skipping', { filename: file });
        continue;
      }

      if (plan === 'abort') {
        throw new Error(`Migration ${file} is marked applying; reconcile the database before retrying. Previous error: ${state.error || 'none recorded'}`);
      }

      if (plan === 'retry') {
        logger.warn('Retrying previously failed migration', {
          filename: file,
          previousError: state.error || null,
        });
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
        attachMigrationNoticeHandler(migClient, file);
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

module.exports = { MIGRATION_LOCK_KEY, migrationChecksum, listMigrationFiles, resolveMigrationPlan, attachMigrationNoticeHandler, migrate };

if (require.main === module) migrate({
  through: process.argv.length === 2 ? null
    : process.argv.length === 4 && process.argv[2] === '--through' ? process.argv[3]
      : '__invalid_migration_arguments__',
}).catch(async (err) => {
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
