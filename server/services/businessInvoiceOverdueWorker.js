'use strict';

const pool = require('../db');
const logger = require('../utils/logger');

const ADVISORY_LOCK_KEY = 418;
const ADVISORY_LOCK_SCOPE = 6;

/**
 * Mark sent/partial invoices past due_date as overdue (once per day per replica).
 */
async function processBusinessInvoiceOverdue() {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = Boolean((await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [ADVISORY_LOCK_KEY, ADVISORY_LOCK_SCOPE]
    )).rows[0]?.locked);
    if (!locked) return { locked: false, updated: 0 };

    const { rowCount } = await client.query(`
      UPDATE business_invoices
         SET status = 'overdue',
             updated_at = NOW()
       WHERE status IN ('sent', 'partial')
         AND due_date IS NOT NULL
         AND due_date < CURRENT_DATE
         AND COALESCE(amount_paid, 0) < total - 0.009
    `);

    return { locked: true, updated: rowCount || 0 };
  } catch (err) {
    logger.error('Business invoice overdue worker failed', { error: err.message });
    throw err;
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_KEY, ADVISORY_LOCK_SCOPE]);
      } catch (unlockErr) {
        logger.warn('Business invoice overdue worker unlock failed', { error: unlockErr.message });
      }
    }
    client.release();
  }
}

module.exports = { processBusinessInvoiceOverdue };
