'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sendBusinessInvoiceOverdueReminder } = require('../utils/businessInvoiceEmail');

const ADVISORY_LOCK_KEY = 418;
const ADVISORY_LOCK_SCOPE = 6;

/**
 * Mark sent/partial invoices past due_date as overdue (once per day per replica).
 * Sends a one-time overdue email to clients when an invoice newly becomes overdue.
 */
async function processBusinessInvoiceOverdue() {
  const client = await pool.connect();
  let locked = false;
  let reminded = 0;
  try {
    locked = Boolean((await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [ADVISORY_LOCK_KEY, ADVISORY_LOCK_SCOPE]
    )).rows[0]?.locked);
    if (!locked) return { locked: false, updated: 0, reminded: 0 };

    const { rows: updatedRows } = await client.query(`
      UPDATE business_invoices bi
         SET status = 'overdue',
             updated_at = NOW()
       WHERE bi.status IN ('sent', 'partial')
         AND bi.due_date IS NOT NULL
         AND bi.due_date < CURRENT_DATE
         AND COALESCE(bi.amount_paid, 0) < bi.total - 0.009
      RETURNING bi.id, bi.invoice_number, bi.client_email, bi.client_name, bi.public_token,
                bi.total, bi.due_date, bi.currency_code, bi.business_id, bi.user_id
    `);

    for (const inv of updatedRows) {
      if (!inv.client_email || !inv.public_token) continue;
      try {
        let issuerName = 'OxSteed';
        let language = 'en';
        if (inv.business_id) {
          const { rows: [biz] } = await client.query(
            `SELECT b.business_name, u.preferred_language
               FROM businesses b
               JOIN users u ON u.id = b.user_id
              WHERE b.id = $1`,
            [inv.business_id]
          );
          issuerName = biz?.business_name || issuerName;
          language = biz?.preferred_language || language;
        } else {
          const { rows: [helper] } = await client.query(
            'SELECT first_name, last_name, preferred_language FROM users WHERE id = $1',
            [inv.user_id]
          );
          if (helper) {
            issuerName = `${helper.first_name} ${helper.last_name}`.trim();
            language = helper.preferred_language || language;
          }
        }

        const emailResult = await sendBusinessInvoiceOverdueReminder({
          invoice: inv,
          recipientEmail: inv.client_email,
          issuerName,
          language,
        });
        if (emailResult.success) reminded += 1;
      } catch (emailErr) {
        logger.warn('Overdue invoice reminder failed', { invoiceId: inv.id, error: emailErr.message });
      }
    }

    return { locked: true, updated: updatedRows.length, reminded };
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
