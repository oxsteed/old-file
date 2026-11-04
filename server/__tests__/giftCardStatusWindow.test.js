'use strict';
// Cost audit 2026-11-04 item 11: gift-card status polling stops at 48h,
// not day 7, and a row that ages out raises an operator incident instead
// of polling silently into needs_review.
const { resetMocks } = require('./setup');
jest.mock('../services/restaurantGiftCardFulfillment', () => ({ enabled: () => true }));
jest.mock('../services/incidentStore', () => ({ recordIncident: jest.fn().mockResolvedValue(undefined) }));
const email = require('../utils/email');
email.emailDeliveryAvailable = () => true;
const { processGiftCardDelivery, STATUS_WINDOW_MS } = require('../services/restaurantGiftCardDelivery');
const { recordIncident } = require('../services/incidentStore');

beforeEach(() => { resetMocks(); jest.clearAllMocks(); });

test('the status window is 48 hours', () => {
  expect(STATUS_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
});

test('an accepted email past 48h moves to needs_review with an incident and no poll', async () => {
  const db = { query: jest.fn()
    .mockResolvedValueOnce({ rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ id: 7, status: 'accepted', provider_id: 'fixture', status_poll_count: 4, first_attempt_at: new Date(Date.now() - 49 * 3600000) }] })
    .mockResolvedValueOnce({ rowCount: 1 }) };
  const inspect = jest.fn();
  const send = jest.fn();
  const result = await processGiftCardDelivery({ db, send, inspect });
  expect(result).toEqual({ claimed: 1, acknowledged: 1 });
  expect(inspect).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(db.query.mock.calls[2][1][2]).toBe('needs_review');
  expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'restaurant_gift_card_needs_review',
    dedupeKey: 'restaurant-gift-card-needs-review:7',
  }));
});

test('an accepted email inside 48h still polls', async () => {
  const db = { query: jest.fn()
    .mockResolvedValueOnce({ rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ id: 8, status: 'accepted', provider_id: 'fixture', status_poll_count: 4, first_attempt_at: new Date(Date.now() - 26 * 3600000) }] })
    .mockResolvedValueOnce({ rowCount: 1 }) };
  const inspect = jest.fn().mockResolvedValue({ success: true, event: 'sent' });
  await processGiftCardDelivery({ db, send: jest.fn(), inspect });
  expect(inspect).toHaveBeenCalledWith('fixture');
  expect(recordIncident).not.toHaveBeenCalled();
});
