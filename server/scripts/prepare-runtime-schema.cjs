'use strict';

const { runtimeRole } = require('../utils/runtimeRole');

async function verifyUsingEnvironment(env) {
  const { Pool } = require('pg');
  const { getDatabaseSslConfig } = require('../utils/databaseConfig');
  const { verifyWebSchema } = require('../services/webSchemaPreflight');
  const pool = new Pool({ connectionString: env.DATABASE_URL,
    ssl: getDatabaseSslConfig(env.DATABASE_URL, env.NODE_ENV), max: 1,
    connectionTimeoutMillis: 5000, statement_timeout: 10000,
    idle_in_transaction_session_timeout: 15000,
    application_name: 'oxsteed-web-schema-preflight' });
  try { return await verifyWebSchema({ pool }); } finally { await pool.end(); }
}

async function prepareRuntimeSchema({ env = process.env, verify = verifyUsingEnvironment,
  migrate = () => require('../migrate').migrate() } = {}) {
  // Resolve the role before importing either database path. A web replacement
  // never loads the writer, including its checksum backfill and marker DDL.
  if (runtimeRole(env) === 'web') return verify(env);
  return migrate();
}

module.exports = { prepareRuntimeSchema, verifyUsingEnvironment };
if (require.main === module) {
  require('dotenv').config();
  prepareRuntimeSchema().then(result => {
    if (result?.appliedMigrations != null) console.log(JSON.stringify(result));
  }).catch(error => {
    // Do not echo database errors, connection strings or environment values.
    console.error(JSON.stringify({ error: 'Runtime schema preparation refused',
      code: error.code === 'WEB_SCHEMA_NOT_READY' ? error.code : 'SCHEMA_PREPARATION_FAILED',
      ...(error.counts ? { counts: error.counts } : {}) }));
    process.exitCode = 1;
  });
}
