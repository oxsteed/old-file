// Migration runner for OxSteed v2
// Runs all SQL migration files in order, skipping already-applied ones
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
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

async function migrate() {
  // Use one client just for the _migrations tracking table
  const setupClient = await pool.connect();
  try {
    await setupClient.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT now()
      )
    `);
  } finally {
    setupClient.release();
  }

  // Get already-applied migrations
  const { rows: applied } = await pool.query(
    'SELECT filename FROM _migrations ORDER BY filename'
  );
  const appliedSet = new Set(applied.map(r => r.filename));

  // Read migration files
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  logger.info('Migration runner started', { totalFiles: files.length, alreadyApplied: appliedSet.size });

  for (const file of files) {
    if (appliedSet.has(file)) {
      logger.info('Migration already applied, skipping', { filename: file });
      continue;
    }

    logger.info('Applying migration', { filename: file });
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    // Use a FRESH client for each migration to avoid transaction state issues
    const migClient = await pool.connect();
    try {
      await migClient.query(sql);
      await migClient.query(
        'INSERT INTO _migrations (filename) VALUES ($1)',
        [file]
      );
      migClient.release();
      logger.info('Migration applied successfully', { filename: file });
    } catch (err) {
      logger.error('Migration failed: ' + file + ' - ' + err.message);
      // Rollback any open transaction on this client
      try { await migClient.query('ROLLBACK'); } catch (e) { /* ignore */ }
      migClient.release();
      const migrationError = new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      // Preserve PostgreSQL's machine-readable code for startup diagnostics.
      migrationError.code = err.code;
      throw migrationError;
    }
  }

  logger.info('All migrations complete');
  await pool.end();
}

migrate().catch(async (err) => {
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
