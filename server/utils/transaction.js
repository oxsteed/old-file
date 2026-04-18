// Database transaction helper
// Provides safe transaction handling with automatic rollback on error

const logger = require('./logger');

/**
 * Execute a callback within a database transaction.
 * Automatically commits on success, rolls back on error.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {Function} callback - Async function(client) that performs DB operations
 * @returns {Promise} - Result of callback
 *
 * Usage:
 *   const result = await withTransaction(pool, async (client) => {
 *     await client.query('UPDATE users SET ...');
 *     await client.query('INSERT INTO logs ...');
 *     return { success: true };
 *   });
 */
const withTransaction = async (pool, callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('Transaction rollback failed', { error: rollbackErr.message });
    }
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Execute multiple queries atomically.
 * Wraps all queries in a single transaction.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {Array} queries - Array of { text, values } objects
 * @returns {Promise<Array>} - Array of results in same order as queries
 */
const executeTransaction = async (pool, queries) => {
  return withTransaction(pool, async (client) => {
    const results = [];
    for (const query of queries) {
      const result = await client.query(query.text, query.values);
      results.push(result);
    }
    return results;
  });
};

module.exports = {
  withTransaction,
  executeTransaction,
};
