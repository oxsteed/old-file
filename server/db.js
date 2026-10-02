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
  // E04: pool-wide guardrails so no unbounded query can exhaust the pool.
  // Postgres kills any statement running longer than statement_timeout and
  // any session idling inside a transaction past
  // idle_in_transaction_session_timeout. Per-workload budgets and tighter
  // timeouts live in utils/dbBudgets.js.
  statement_timeout: (() => {
    const raw = Number.parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10);
    return Number.isFinite(raw) ? Math.max(1000, Math.min(raw, 600000)) : 30000;
  })(),
  idle_in_transaction_session_timeout: (() => {
    const raw = Number.parseInt(process.env.DB_IDLE_TX_TIMEOUT_MS, 10);
    return Number.isFinite(raw) ? Math.max(1000, Math.min(raw, 600000)) : 60000;
  })(),
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
