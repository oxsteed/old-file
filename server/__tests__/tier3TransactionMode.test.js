'use strict';

// ITEM 20: creating the tier-3 protected (manual-capture) payment intent must
// deterministically mark jobs.transaction_mode = 'guided_protected' in the
// same transaction, so completeJob detects escrow via the enum instead of
// fragile label substring matching.

const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/paymentController');
const stripe = require('stripe');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('createPaymentIntent tier-3 enum write (ITEM 20)', () => {
  test('marks the job guided_protected in the same transaction as the intent', async () => {
    stripe.__mockInstance.accounts.retrieve.mockResolvedValueOnce({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [] },
    });
    stripe.__mockInstance.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_t3',
      client_secret: 'cs_t3_secret',
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 10, client_id: 1, job_value: 100, assigned_helper_id: 2 }] }) // job lookup
      .mockResolvedValueOnce({ rows: [{ user_id: 2, stripe_account_id: 'acct_x', charges_enabled: true, payouts_enabled: true, onboarding_complete: true }] }) // connect account
      .mockResolvedValueOnce({ rows: [{ locked: true }] }) // advisory lock
      .mockResolvedValueOnce({ rows: [{ balance_cents: '0' }] }) // credit balance
      .mockResolvedValueOnce({ rows: [] }) // no existing payment
      .mockResolvedValueOnce({ rows: [{ attempt_count: 0 }] }) // attempt count
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // INSERT payments
    // UPDATE jobs falls through to the default { rows: [], rowCount: 0 }

    const req = { body: { job_id: 10 }, user: { id: 1 } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();

    await ctrl.createPaymentIntent(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      client_secret: 'cs_t3_secret',
      payment_intent_id: 'pi_t3',
    }));

    const tierWrites = mockQuery.mock.calls.filter(([sql]) =>
      /UPDATE jobs SET transaction_mode = 'guided_protected'/.test(sql)
    );
    expect(tierWrites).toHaveLength(1);
    expect(tierWrites[0][1]).toEqual([10]);
  });
});
