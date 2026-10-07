'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { processBusinessInvoicePaymentReminders } = require('../services/businessInvoicePaymentReminderWorker');

jest.mock('../utils/businessInvoiceEmail', () => ({
  sendBusinessInvoicePreDueReminder: jest.fn().mockResolvedValue({ success: true }),
  sendBusinessInvoiceOverdueReminder: jest.fn().mockResolvedValue({ success: true }),
}));

beforeEach(() => resetMocks());

test('processBusinessInvoicePaymentReminders locks and queries pre-due milestones', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({ rowCount: 0 })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(processBusinessInvoicePaymentReminders()).resolves.toMatchObject({
    locked: true,
    markedOverdue: 0,
    reminded: 0,
  });
  expect(mockQuery.mock.calls[2][0]).toMatch(/due_date - CURRENT_DATE = \$1/);
});
