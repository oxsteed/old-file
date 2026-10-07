'use strict';

const { processBusinessInvoicePaymentReminders } = require('./businessInvoicePaymentReminderWorker');

/**
 * @deprecated Use processBusinessInvoicePaymentReminders — kept for tests/callers.
 */
async function processBusinessInvoiceOverdue() {
  const result = await processBusinessInvoicePaymentReminders();
  return {
    locked: result.locked,
    updated: result.markedOverdue,
    reminded: result.reminded,
  };
}

module.exports = { processBusinessInvoiceOverdue, processBusinessInvoicePaymentReminders };
