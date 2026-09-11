'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  STALE_MINUTES,
  BATCH_SIZE,
  recoverStaleSupportChannelDeliveries,
} = require('../services/supportChannelDeliveryRecovery');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('marks stale provider attempts failed and makes their messages retryable', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [
      { id: 'delivery-1', message_id: 'message-1' },
      { id: 'delivery-2', message_id: null },
    ] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(recoverStaleSupportChannelDeliveries()).resolves.toEqual({ recovered: 2 });
  expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining("SET status = 'failed'"), [STALE_MINUTES, BATCH_SIZE]);
  expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("SET status = 'failed'"), ['message-1']);
});

test('does not issue message updates when no delivery is stale', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await expect(recoverStaleSupportChannelDeliveries()).resolves.toEqual({ recovered: 0 });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});
