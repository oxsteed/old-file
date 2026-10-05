'use strict';

function isDisposableDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

function disposableDatabaseOptIn(alias) {
  const value = process.env.STATEMENT_TEST_DATABASE_URL || process.env[alias] || '';
  if (value && !isDisposableDatabase(value)) {
    throw new Error('Statement DB tests require an explicit loopback credit_statement_test database');
  }
  if (!value && process.env.STATEMENT_REQUIRE_DB_TESTS === 'true') {
    throw new Error('Required statement DB tests have no disposable database opt-in');
  }
  return value;
}

async function assertMigratedSchema(pool) {
  const { rows } = await pool.query(
    "SELECT filename FROM _migrations WHERE status='applied' AND filename IN ('691_settlement_issuance_schema.sql','695_statement_run_recovery.sql')");
  if (rows.length !== 2) throw new Error('Apply all repository migrations before running statement integration tests');
}

module.exports = { isDisposableDatabase, disposableDatabaseOptIn, assertMigratedSchema };
