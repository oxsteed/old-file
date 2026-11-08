'use strict';

// Background-jobs audit #39: the fleet fence is delivered to every
// worker in its options, but until this fix no worker accepted it.
// The money-adjacent five now take options.fence and route their
// writes through fence.db, so a worker that lost its lease stops
// instead of writing through the raw pool. Each test below hands a
// worker a fake fence whose db.query answers without ever touching
// the raw pool mock, and asserts the raw pool was never queried. All
// mocked: no real database, no real lock service.

const { mockQuery, resetMocks } = require('./setup');
const { LeaseLostError } = require('../jobs/jobLockingService');
const pool = require('../db');

jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../services/incidentStore', () => ({ recordIncident: jest.fn().mockResolvedValue({ persisted: true }) }));

const { escalateUnacknowledgedSOS } = require('../services/safetySOSService');

jest.mock('../services/restaurantGiftCardFulfillment', () => ({ enabled: () => true }));
const email = require('../utils/email');
email.emailDeliveryAvailable = () => true;
const { processGiftCardDelivery } = require('../services/restaurantGiftCardDelivery');

jest.mock('../services/restaurantAccountingProvider', () => ({
  tokens: jest.fn().mockResolvedValue({}),
  postDocument: jest.fn(),
}));
const { processExports } = require('../services/restaurantAccountingDelivery');

jest.mock('../services/restaurantPosTerminalService', () => ({
  resolveRestaurantConnectAccount: jest.fn(),
  searchConnectedIntentByOfflineId: jest.fn().mockResolvedValue([]),
}));
jest.mock('../services/restaurantTerminalOffline', () => ({
  reconcileForwarded: jest.fn(),
}));
jest.mock('../services/cardStoreForward', () => ({
  isGloballyEnabled: () => false,
  shouldHoldForManagerReview: jest.fn(() => false),
  getStoreForwardPolicy: jest.fn(),
}));
jest.mock('../services/restaurantPosPaymentLedgerService', () => ({
  reconcilePosOrderPayment: jest.fn(),
}));
const { sweep } = require('../services/restaurantTerminalOfflineLeases');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function losingFence() {
  return {
    assertActive: jest.fn(),
    db: { query: jest.fn(async () => { throw new LeaseLostError('fleet-worker'); }) },
    fencedTransaction: jest.fn(async () => { throw new LeaseLostError('fleet-worker'); }),
  };
}

describe('Background-jobs audit #39: money-adjacent fleet workers take the fence', () => {
  test('SOS escalation claims through fence.db, and a lost lease refuses the run', async () => {
    const fenceDbQuery = jest.fn(async () => ({ rows: [] }));
    const fence = { assertActive: jest.fn(), db: { query: fenceDbQuery } };
    const result = await escalateUnacknowledgedSOS({ limit: 50, fence });
    expect(result).toEqual({ escalated: 0 });
    expect(fenceDbQuery).toHaveBeenCalledTimes(1);
    expect(fenceDbQuery.mock.calls[0][0]).toContain('acknowledged_at IS NULL');
    expect(mockQuery).not.toHaveBeenCalled();

    await expect(escalateUnacknowledgedSOS({ limit: 50, fence: losingFence() }))
      .rejects.toThrow('lease lost');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('gift-card delivery claims through fence.db, and a lost lease refuses the run', async () => {
    const fenceDbQuery = jest.fn(async () => ({ rowCount: 0, rows: [] }));
    const fence = { assertActive: jest.fn(), db: { query: fenceDbQuery } };
    const send = jest.fn();
    const inspect = jest.fn();
    const result = await processGiftCardDelivery({ db: pool, send, inspect, fence });
    expect(result).toEqual({ claimed: 0, acknowledged: 0 });
    expect(fenceDbQuery).toHaveBeenCalled();
    expect(fenceDbQuery.mock.calls[0][0]).toContain('restaurant_gift_card_fulfillments');
    expect(send).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();

    await expect(processGiftCardDelivery({ db: pool, send, inspect, fence: losingFence() }))
      .rejects.toThrow('lease lost');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('accounting delivery claims through fence.db, and a lost lease refuses the run', async () => {
    const previous = process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED;
    process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED = 'true';
    try {
      const fenceDbQuery = jest.fn(async () => ({ rowCount: 0, rows: [] }));
      const fence = { assertActive: jest.fn(), db: { query: fenceDbQuery } };
      const result = await processExports({ fence });
      expect(result).toEqual({ claimed: 0, posted: 0 });
      expect(fenceDbQuery).toHaveBeenCalled();
      expect(fenceDbQuery.mock.calls[0][0]).toContain('restaurant_accounting_documents');
      expect(mockQuery).not.toHaveBeenCalled();

      await expect(processExports({ fence: losingFence() })).rejects.toThrow('lease lost');
      expect(mockQuery).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED;
      else process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED = previous;
    }
  });

  test('accounting delivery runs its per-batch journal transaction through fence.fencedTransaction', async () => {
    const previous = process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED;
    process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED = 'true';
    try {
      const batch = { id: 5, integration_id: 1, payload: { lines: [] }, currency_code: 'USD' };
      const fenceDbQuery = jest.fn(async (sql) => {
        const text = String(sql);
        if (text.includes('WITH candidates')) return { rows: [batch] };
        if (text.includes('FROM restaurant_accounting_integrations')) return { rows: [{ id: 1, status: 'active' }] };
        // The remaining-count select also mentions
        // restaurant_accounting_documents: check it before the
        // documents select below.
        if (text.includes("COUNT(*) FILTER(WHERE status<>'posted')")) return { rows: [{ remaining: 0 }] };
        if (text.includes('FROM restaurant_accounting_documents')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      });
      const fakeClient = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
      const fencedTransaction = jest.fn(async (work) => work(fakeClient));
      const fence = { assertActive: jest.fn(), db: { query: fenceDbQuery }, fencedTransaction };
      const result = await processExports({ fence });
      expect(result).toEqual({ claimed: 1, posted: 1 });
      expect(fencedTransaction).toHaveBeenCalledTimes(1);
      expect(mockQuery).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED;
      else process.env.RESTAURANT_ACCOUNTING_DELIVERY_ENABLED = previous;
    }
  });

  test('terminal offline sweep expires and selects through fence.db, and a lost lease refuses the run', async () => {
    const fenceDbQuery = jest.fn(async () => ({ rowCount: 0, rows: [] }));
    const fence = { assertActive: jest.fn(), db: { query: fenceDbQuery } };
    const result = await sweep({ fence });
    expect(result).toEqual({ expired: 0, attached: 0, reconciled: 0, flagged: 0 });
    expect(fenceDbQuery).toHaveBeenCalledTimes(3);
    expect(fenceDbQuery.mock.calls[0][0]).toContain('restaurant_terminal_offline_leases');
    expect(mockQuery).not.toHaveBeenCalled();

    await expect(sweep({ fence: losingFence() })).rejects.toThrow('lease lost');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
