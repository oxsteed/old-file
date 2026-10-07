'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const {
  sendBusinessInvoicePreDueReminder,
  sendBusinessInvoiceOverdueReminder,
} = require('../utils/businessInvoiceEmail');

const ADVISORY_LOCK_KEY = 419;
const ADVISORY_LOCK_SCOPE = 6;
const PRE_DUE_MILESTONES = [
  { days: 7, code: 'd7' },
  { days: 3, code: 'd3' },
  { days: 1, code: 'd1' },
];

async function resolveIssuerContext(client, inv) {
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
  return { issuerName, language };
}

async function recordMilestone(client, invoiceId, code) {
  const { rowCount } = await client.query(
    `UPDATE business_invoices
        SET payment_reminder_milestones = array_append(payment_reminder_milestones, $2),
            updated_at = NOW()
      WHERE id = $1
        AND NOT ($2 = ANY(payment_reminder_milestones))`,
    [invoiceId, code]
  );
  return rowCount === 1;
}

/**
 * Mark overdue, then send pre-due (7/3/1 day) and overdue payment reminders.
 */
async function processBusinessInvoicePaymentReminders() {
  const client = await pool.connect();
  let locked = false;
  let markedOverdue = 0;
  let reminded = 0;
  try {
    locked = Boolean((await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [ADVISORY_LOCK_KEY, ADVISORY_LOCK_SCOPE]
    )).rows[0]?.locked);
    if (!locked) return { locked: false, markedOverdue: 0, reminded: 0 };

    const { rowCount: overdueCount } = await client.query(`
      UPDATE business_invoices
         SET status = 'overdue',
             updated_at = NOW()
       WHERE status IN ('sent', 'partial')
         AND due_date IS NOT NULL
         AND due_date < CURRENT_DATE
         AND COALESCE(amount_paid, 0) < total - 0.009
    `);
    markedOverdue = overdueCount || 0;

    for (const { days, code } of PRE_DUE_MILESTONES) {
      const { rows } = await client.query(
        `SELECT bi.id, bi.invoice_number, bi.client_email, bi.public_token,
                bi.total, bi.due_date, bi.currency_code, bi.business_id, bi.user_id
           FROM business_invoices bi
          WHERE bi.status IN ('sent', 'partial')
            AND bi.due_date IS NOT NULL
            AND bi.due_date - CURRENT_DATE = $1
            AND bi.client_email IS NOT NULL
            AND bi.public_token IS NOT NULL
            AND COALESCE(bi.amount_paid, 0) < bi.total - 0.009
            AND NOT ($2 = ANY(bi.payment_reminder_milestones))`,
        [days, code]
      );

      for (const inv of rows) {
        const { issuerName, language } = await resolveIssuerContext(client, inv);
        const emailResult = await sendBusinessInvoicePreDueReminder({
          invoice: inv,
          recipientEmail: inv.client_email,
          issuerName,
          language,
          daysBeforeDue: days,
        });
        if (emailResult.success && await recordMilestone(client, inv.id, code)) {
          reminded += 1;
        }
      }
    }

    const { rows: overdueRows } = await client.query(
      `SELECT bi.id, bi.invoice_number, bi.client_email, bi.public_token,
              bi.total, bi.due_date, bi.currency_code, bi.business_id, bi.user_id
         FROM business_invoices bi
        WHERE bi.status = 'overdue'
          AND bi.client_email IS NOT NULL
          AND bi.public_token IS NOT NULL
          AND COALESCE(bi.amount_paid, 0) < bi.total - 0.009
          AND NOT ('overdue' = ANY(bi.payment_reminder_milestones))`
    );

    for (const inv of overdueRows) {
      const { issuerName, language } = await resolveIssuerContext(client, inv);
      const emailResult = await sendBusinessInvoiceOverdueReminder({
        invoice: inv,
        recipientEmail: inv.client_email,
        issuerName,
        language,
      });
      if (emailResult.success && await recordMilestone(client, inv.id, 'overdue')) {
        reminded += 1;
      }
    }

    return { locked: true, markedOverdue, reminded };
  } catch (err) {
    logger.error('Business invoice payment reminder worker failed', { error: err.message });
    throw err;
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_KEY, ADVISORY_LOCK_SCOPE]);
      } catch (unlockErr) {
        logger.warn('Business invoice payment reminder unlock failed', { error: unlockErr.message });
      }
    }
    client.release();
  }
}

module.exports = { processBusinessInvoicePaymentReminders };
