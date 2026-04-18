const logger = require('./logger');

/**
 * Transaction wrapper utility for ACID operations
 *
 * Wraps multi-step database operations in explicit BEGIN...COMMIT...ROLLBACK
 * to ensure atomicity and consistency.
 *
 * Usage:
 *   const result = await withTransaction(db, async (client) => {
 *     // client is the transaction connection, not the pool
 *     await client.query('UPDATE users SET ...');
 *     await client.query('INSERT INTO audit_log ...');
 *     return { success: true };
 *   });
 */

/**
 * Execute a function within a database transaction
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {Function} operation - Async function that receives a transaction client
 * @param {string} name - Operation name for logging
 * @returns {Promise} - Result of the operation
 *
 * @example
 * const result = await withTransaction(pool, async (client) => {
 *   // All queries in this block are in the same transaction
 *   const payment = await client.query('INSERT INTO payments ...');
 *   await client.query('UPDATE jobs SET status = ...');
 *   return payment;
 * }, 'capture_payment_and_update_job');
 *
 * If the operation throws or fails:
 * - ROLLBACK is automatically called
 * - The error is logged with context
 * - The error is re-thrown to the caller
 */
async function withTransaction(pool, operation, name = 'operation') {
  const client = await pool.connect();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');
    logger.debug('Transaction started', { operation: name });

    const result = await operation(client);

    await client.query('COMMIT');
    const duration = Date.now() - startTime;
    logger.info('Transaction committed', { operation: name, durationMs: duration });

    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
      logger.error('Transaction rolled back', {
        operation: name,
        error: err.message,
        durationMs: Date.now() - startTime,
      });
    } catch (rollbackErr) {
      logger.error('Rollback failed', {
        operation: name,
        originalError: err.message,
        rollbackError: rollbackErr.message,
      });
    }

    // Re-throw the original error so caller knows it failed
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a function within a transaction with retry logic
 *
 * Retries on deadlock errors (concurrent transaction conflicts).
 * Useful for high-concurrency operations.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {Function} operation - Async function
 * @param {string} name - Operation name
 * @param {number} maxRetries - Max retry attempts (default: 3)
 * @returns {Promise} - Result of the operation
 */
async function withTransactionRetry(pool, operation, name = 'operation', maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await withTransaction(pool, operation, `${name} [attempt ${attempt}/${maxRetries}]`);
    } catch (err) {
      lastError = err;

      // Check if error is a deadlock (error code 40P01)
      const isDeadlock = err.code === '40P01';

      if (!isDeadlock || attempt === maxRetries) {
        throw err;
      }

      // Exponential backoff: 10ms, 50ms, 250ms
      const delay = Math.pow(5, attempt) * 10;
      logger.warn('Deadlock detected, retrying', {
        operation: name,
        attempt,
        maxRetries,
        delayMs: delay,
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Helper for payment capture operations
 * Ensures payment is captured, job status is updated, and notifications are sent atomically
 */
async function withPaymentTransaction(pool, operation, operationName) {
  return withTransaction(pool, operation, `payment_${operationName}`);
}

/**
 * Helper for subscription operations
 * Ensures subscription state, user tier, and audit logs are consistent
 */
async function withSubscriptionTransaction(pool, operation, operationName) {
  return withTransaction(pool, operation, `subscription_${operationName}`);
}

/**
 * Helper for job lifecycle operations
 * Ensures job status, payment state, and notifications are consistent
 */
async function withJobTransaction(pool, operation, operationName) {
  return withTransaction(pool, operation, `job_${operationName}`);
}

module.exports = {
  withTransaction,
  withTransactionRetry,
  withPaymentTransaction,
  withSubscriptionTransaction,
  withJobTransaction,
};
