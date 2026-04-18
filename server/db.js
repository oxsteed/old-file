// Database connection pool
// OxSteed v2

const { Pool } = require('pg');

// Determine SSL config from DATABASE_URL.
// Local Docker PostgreSQL (sslmode=disable) needs ssl: false.
// Managed/remote databases need ssl: true (with proper CA cert).
const dbUrl = process.env.DATABASE_URL || '';
const needsSsl = !dbUrl.includes('sslmode=disable') && process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: true } : false,
  max: Math.min(parseInt(process.env.DB_POOL_MAX, 10) || 30, 100),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  require('./utils/logger').error('Unexpected database pool error', err);
});

module.exports = pool;

