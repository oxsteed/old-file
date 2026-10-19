'use strict';

// Decision 2: platform promo codes at job and booking checkout. The discount
// is platform-funded: on jobs it comes out of the application fee so the
// helper's net (charge - application fee) is unchanged; on bookings the
// customer is charged the net and the booking keeps its gross value.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_promo';
process.env.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_promo';
const { mockQuery, resetMocks } = require('./setup');
const stripe = require('stripe');
const paymentCtrl = require('../controllers/paymentController');
const mobileCtrl = require('../controllers/mobileController');

const PROMO = { id: 77, code: 'SAVE20', description: null, discount_type: 'percentage', discount_amount: '20',
  max_discount_cents: null, usage_limit: null, usage_count: 0, min_order_cents: '0', max_order_cents: null,
  status: 'active', per_user_limit: 1, currency_code: null, applicable_surfaces: null, started: true, not_expired: true };

function dispatcher(handlers) {
  return async (sql, params) => {
    const text = String(sql);
    for (const [re, fn] of handlers) if (re.test(text)) return typeof fn === 'function' ? fn(params, text) : fn;
    return { rows: [], rowCount: 0 };
  };
}
const promoHandlers = (counts = { total: 0, mine: 0 }) => [
  [/SELECT \* FROM promo_redemptions WHERE idempotency_key/, { rows: [] }],
  [/FROM discount_codes WHERE UPPER\(code\) = \$1/, { rows: [PROMO] }],
  [/COUNT\(\*\) FILTER \(WHERE user_id = \$2\)/, { rows: [counts] }],
  [/INSERT INTO promo_redemptions/, (p) => ({ rows: [{ id: 501, discount_cents: p[8], status: 'reserved' }] })],
];

beforeEach(() => { resetMocks(); jest.clearAllMocks(); });

describe('job checkout promo', () => {
  function jobMocks(counts) {
    stripe.__mockInstance.accounts.retrieve.mockResolvedValue({
      charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } });
    stripe.__mockInstance.paymentIntents.create.mockResolvedValue({ id: 'pi_promo', client_secret: 'cs_promo' });
    mockQuery.mockImplementation(dispatcher([
      ...promoHandlers(counts),
      [/FROM jobs/i, { rows: [{ id: 10, client_id: 1, job_value: 100, assigned_helper_id: 2 }] }],
      [/connect_accounts/i, { rows: [{ user_id: 2, stripe_account_id: 'acct_x', charges_enabled: true, payouts_enabled: true, onboarding_complete: true }] }],
      [/balance_cents/i, { rows: [{ balance_cents: '0' }] }],
      [/attempt_count/, { rows: [{ attempt_count: 0 }] }],
      [/INSERT INTO payments/i, { rows: [{ id: 7 }] }],
    ]));
  }

  test('discount reduces the charge and the application fee by the same cents', async () => {
    jobMocks();
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();
    // Baseline without promo.
    await paymentCtrl.createPaymentIntent({ body: { job_id: 10 }, user: { id: 1 } }, res, next);
    expect(next).not.toHaveBeenCalled();
    const base = stripe.__mockInstance.paymentIntents.create.mock.calls[0][0];

    jobMocks();
    stripe.__mockInstance.paymentIntents.create.mockClear();
    await paymentCtrl.createPaymentIntent({ body: { job_id: 10, promo_code: 'save20' }, user: { id: 1 } }, res, next);
    expect(next).not.toHaveBeenCalled();
    const withPromo = stripe.__mockInstance.paymentIntents.create.mock.calls[0][0];
    const promoCents = base.amount - withPromo.amount;
    expect(promoCents).toBeGreaterThan(0);
    expect(Number.isInteger(promoCents)).toBe(true);
    // Capped by the platform fee: never more than the fee, helper net unchanged.
    const fee = (pi) => Number(pi.application_fee_amount || 0);
    expect(promoCents).toBeLessThanOrEqual(fee(base));
    expect(withPromo.amount - fee(withPromo)).toBe(base.amount - fee(base));
    expect(withPromo.metadata).toMatchObject({ promo_discount_cents: String(promoCents), promo_redemption_id: '501' });
    expect(res.json).toHaveBeenLastCalledWith(expect.objectContaining({ promo_discount_cents: promoCents }));
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO promo_redemptions/.test(sql));
    expect(insert[1].slice(3, 6)).toEqual(['job', '10', 'job-payment:10:1:promo']);
    expect(insert[1][10]).toBe('platform');
    expect(mockQuery.mock.calls.some(([sql, p]) => /SET provider_reference = \$2/.test(sql) && p[1] === 'pi_promo')).toBe(true);
  });

  test('a per-user limit rejects the checkout before any Stripe call', async () => {
    jobMocks({ total: 3, mine: 1 });
    const next = jest.fn();
    await paymentCtrl.createPaymentIntent({ body: { job_id: 10, promo_code: 'SAVE20' }, user: { id: 1 } },
      { json: jest.fn(), status: jest.fn().mockReturnThis() }, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'promo_user_limit_reached' }));
    expect(stripe.__mockInstance.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('booking checkout promo', () => {
  const booking = { id: 'b1', customer_id: 1, helper_id: 2, status: 'accepted', payment_status: 'unpaid',
    stripe_payment_intent_id: null, payment_requirement: 'deposit' };

  test('charges the net, records gross + promo, and attaches the intent', async () => {
    stripe.__mockInstance.paymentIntents.create.mockResolvedValue({ id: 'pi_bk', client_secret: 'cs_bk' });
    mockQuery.mockImplementation(dispatcher([
      ...promoHandlers(),
      [/FOR UPDATE/, { rows: [booking] }],
      [/FROM booking_requests/i, { rows: [booking] }],
    ]));
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await mobileCtrl.createBookingPaymentIntent({ params: { bookingId: 'b1' },
      body: { amountCents: 5000, paymentRequirement: 'deposit', promoCode: 'save20' }, user: { id: 1, email: 'c@x.test' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    const pi = stripe.__mockInstance.paymentIntents.create.mock.calls[0][0];
    expect(pi.amount).toBe(4000);
    expect(pi.metadata).toMatchObject({ gross_amount_cents: '5000', promo_discount_cents: '1000', promo_redemption_id: '501' });
    const update = mockQuery.mock.calls.find(([sql]) => /gross_amount_cents = \$5/.test(sql));
    expect(update[1]).toEqual(['deposit', 4000, 'pi_bk', 'b1', 5000, 1000]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amountCents: 4000, grossAmountCents: 5000, promoDiscountCents: 1000 }) }));
    expect(mockQuery.mock.calls.some(([sql]) => /^COMMIT/.test(String(sql)))).toBe(true);
  });

  test('a Stripe failure rolls the reservation back', async () => {
    stripe.__mockInstance.paymentIntents.create.mockRejectedValue(new Error('card network down'));
    mockQuery.mockImplementation(dispatcher([
      ...promoHandlers(),
      [/FOR UPDATE/, { rows: [booking] }],
      [/FROM booking_requests/i, { rows: [booking] }],
    ]));
    const next = jest.fn();
    await mobileCtrl.createBookingPaymentIntent({ params: { bookingId: 'b1' },
      body: { amountCents: 5000, promoCode: 'SAVE20' }, user: { id: 1 } }, { json: jest.fn() }, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'card network down' }));
    const sqls = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });
});

describe('food checkout platform codes', () => {
  const { resolveFoodPromotionDiscount } = require('../controllers/foodController');
  const client = (handlers) => ({ query: jest.fn(dispatcher([[/food_restaurant_promotions/, { rows: [] }], ...handlers])) });

  test('a platform code goes through the promo engine and is restaurant-funded', async () => {
    const db = client(promoHandlers());
    const result = await resolveFoodPromotionDiscount(db, 5, 'save20', 2599, { userId: 1, currency: 'USD' });
    expect(result).toMatchObject({ discountCents: 519, promotionId: null,
      metadata: { code: 'SAVE20', discountCodeId: 77, source: 'discount_codes', fundedBy: 'restaurant' } });
  });

  test('guests must sign in; limits surface as promo errors; unknown codes are ignored', async () => {
    await expect(resolveFoodPromotionDiscount(client(promoHandlers()), 5, 'SAVE20', 2000, { currency: 'USD' }))
      .rejects.toMatchObject({ code: 'promo_sign_in_required' });
    await expect(resolveFoodPromotionDiscount(client(promoHandlers({ total: 1, mine: 1 })), 5, 'SAVE20', 2000,
      { userId: 1, currency: 'USD' })).rejects.toMatchObject({ code: 'promo_user_limit_reached' });
    const none = client([[/FROM discount_codes/, { rows: [] }]]);
    await expect(resolveFoodPromotionDiscount(none, 5, 'NOPE', 2000, { userId: 1, currency: 'USD' }))
      .resolves.toMatchObject({ discountCents: 0, metadata: null });
  });
});
