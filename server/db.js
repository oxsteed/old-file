// Database connection pool
// OxSteed v2

const { Pool } = require('pg');
const { createPoolMonitor, createTrackingPoolWrapper } = require('./utils/poolMonitor');
const { getDatabaseSslConfig } = require('./utils/databaseConfig');

// Determine SSL config from DATABASE_URL.
// Local Docker PostgreSQL (sslmode=disable) needs ssl: false.
// Managed/remote databases need ssl: true (with proper CA cert).
const dbUrl = process.env.DATABASE_URL || '';
const configuredConnectionTimeout = Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10);
const connectionTimeoutMillis = Number.isFinite(configuredConnectionTimeout)
  ? Math.max(1000, Math.min(configuredConnectionTimeout, 30000))
  : 5000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: getDatabaseSslConfig(dbUrl, process.env.NODE_ENV),
  max: Math.min(parseInt(process.env.DB_POOL_MAX, 10) || 10, 100),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis,
});

pool.on('error', (err) => {
  require('./utils/logger').error('Unexpected database pool error', err);
});

// Create pool monitor for health metrics
const poolMonitor = createPoolMonitor(pool);

// Wrap pool.query() to automatically track metrics
createTrackingPoolWrapper(pool, poolMonitor);

module.exports = pool;
module.exports.poolMonitor = poolMonitor;
