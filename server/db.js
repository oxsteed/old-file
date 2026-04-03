// Database connection pool
// OxSteed v2

const { Pool } = require('pg');

const getSslConfig = () => {
  if (process.env.NODE_ENV !== 'production') return false;

  if (process.env.DATABASE_CA_CERT) {
    return {
      rejectUnauthorized: true,
      ca: process.env.DATABASE_CA_CERT,
    };
  }

  // TODO: provide DATABASE_CA_CERT in production to enable full cert verification
  // (rejectUnauthorized: false skips certificate validation — acceptable on private VPC)
  return { rejectUnauthorized: false };
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: getSslConfig(),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

module.exports = pool;
