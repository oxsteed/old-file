'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/reconciliationExceptions', () => ({ recordException: jest.fn().mockResolvedValue(1) }));
jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: async (_name, fn) => fn({ assertActive() {}, db: require('../db') }),
}));

const { recordException } = require('../services/reconciliationExceptions');
const { runWebhookReceiptRecovery } = require('../jobs/webhookReceiptRecovery');

beforeEach(() => resetMocks());

test('stalled processing receipts are released to failed and raised for operators', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, provider: 'stripe', event_id: 'evt_1', event_type: 'payment_intent.succeeded' }] });
  const out = await runWebhookReceiptRecovery();
  expect(out.released).toBe(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toMatch(/SET status = 'failed'/);
  expect(sql).toMatch(/status = 'processing'/);
  expect(params[1]).toBe(15);
  expect(recordException).toHaveBeenCalledWith(expect.objectContaining({ domain: 'webhook_receipt', referenceId: 'stripe:evt_1' }));
});
