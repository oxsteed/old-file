'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const worker = require('../services/abandonedRecoveryWorker');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  worker.stopAbandonedRecoveryWorker();
});

test('sends cart recovery with idempotent delivery key', async () => {
  db.query.mockResolvedValueOnce({
    rows: [{
      id: 7,
      customer_id: 'user-1',
      restaurant_id: 42,
      amount_cents: 2500,
      currency_code: 'USD',
      restaurant_name: 'Test Kitchen',
    }],
  });

  await worker._recoverAbandonedCheckouts();

  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user-1',
    type: 'cart_recovery',
    action_url: '/food/restaurants/42',
    idempotencyKey: 'cart-recovery:7',
  }));
});

test('sends draft recovery with idempotent delivery key', async () => {
  db.query.mockResolvedValueOnce({
    rows: [{ id: 'draft-1', client_id: 'user-2', wizard_step: 3 }],
  });

  await worker._recoverStaleDrafts();

  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user-2',
    type: 'draft_recovery',
    action_url: '/post-job',
    idempotencyKey: 'draft-recovery:draft-1',
  }));
});

test('queries target the abandonment windows', async () => {
  await worker._recoverAbandonedCheckouts();
  await worker._recoverStaleDrafts();

  const cartSql = db.query.mock.calls[0][0];
  expect(cartSql).toContain("INTERVAL '120 minutes'");
  expect(cartSql).toContain("INTERVAL '60 minutes'");
  expect(cartSql).toContain('food_card_payment_intents');

  const draftSql = db.query.mock.calls[1][0];
  expect(draftSql).toContain("INTERVAL '48 hours'");
  expect(draftSql).toContain("INTERVAL '24 hours'");
  expect(draftSql).toContain('job_drafts');
});

test('start/stop are idempotent', () => {
  worker.startAbandonedRecoveryWorker();
  worker.startAbandonedRecoveryWorker();
  worker.stopAbandonedRecoveryWorker();
  worker.stopAbandonedRecoveryWorker();
});
