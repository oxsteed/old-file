'use strict';

/**
 * F-06: POS Stripe Terminal money must settle to the restaurant's Connect
 * account (destination charges), never to the platform account. When the
 * restaurant has no charges-enabled Connect account, the service fails
 * closed with a typed error and never creates a PaymentIntent.
 *
 * The pg pool and Stripe client are the shared suite mocks (setup.js);
 * the connect-account lookup is driven through mockQuery.
 */

const { mockQuery, resetMocks } = require('./setup');

const stripeMock = require('stripe').__mockInstance;
stripeMock.terminal = {
  connectionTokens: { create: jest.fn() },
};

const posTerminal = require('../services/restaurantPosTerminalService');

const RESTAURANT_ID = 77;
const ACCOUNT_ID = 'acct_1RestaurantConnect';

function mockConnectRow(row) {
  mockQuery.mockResolvedValueOnce({ rows: row ? [row] : [] });
}

beforeEach(() => {
  resetMocks();
  stripeMock.paymentIntents.create.mockReset();
  stripeMock.paymentIntents.create.mockResolvedValue({ id: 'pi_terminal_1', status: 'requires_payment_method' });
  stripeMock.terminal.connectionTokens.create.mockReset();
  stripeMock.terminal.connectionTokens.create.mockResolvedValue({ secret: 'pst_test_secret' });
  delete process.env.FOOD_CARD_FEE_BPS;
});

describe('restaurantPosTerminalService.createPaymentIntent (F-06)', () => {
  test('creates a destination charge to the restaurant Connect account', async () => {
    mockConnectRow({ stripe_account_id: ACCOUNT_ID, charges_enabled: true });
    const intent = await posTerminal.createPaymentIntent({
      amountCents: 2500,
      currency: 'USD',
      metadata: { restaurant_id: String(RESTAURANT_ID) },
      idempotencyKey: 'pos-intent:77:key-1',
      restaurantId: RESTAURANT_ID,
    });
    expect(intent.id).toBe('pi_terminal_1');
    const [params, options] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(params.transfer_data).toEqual({ destination: ACCOUNT_ID });
    expect(params.payment_method_types).toEqual(['card_present']);
    expect(params.capture_method).toBe('manual');
    expect(params.application_fee_amount).toBeUndefined();
    expect(options).toEqual({ idempotencyKey: 'pos-intent:77:key-1' });
  });

  test('applies the FOOD_CARD_FEE_BPS platform fee like the online path', async () => {
    process.env.FOOD_CARD_FEE_BPS = '200'; // 2%
    mockConnectRow({ stripe_account_id: ACCOUNT_ID, charges_enabled: true });
    await posTerminal.createPaymentIntent({
      amountCents: 10000,
      currency: 'USD',
      metadata: {},
      idempotencyKey: 'k',
      restaurantId: RESTAURANT_ID,
    });
    const [params] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(params.application_fee_amount).toBe(200);
    expect(params.transfer_data.destination).toBe(ACCOUNT_ID);
  });

  test('resolves the restaurant from metadata when no explicit id is passed', async () => {
    mockConnectRow({ stripe_account_id: ACCOUNT_ID, charges_enabled: true });
    await posTerminal.createPaymentIntent({
      amountCents: 900,
      currency: 'USD',
      metadata: { restaurant_id: String(RESTAURANT_ID) },
      idempotencyKey: 'k2',
    });
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/restaurant_connect_accounts/);
    expect(values).toEqual([RESTAURANT_ID]);
  });

  test('fails closed when the restaurant has no Connect account', async () => {
    mockConnectRow({ stripe_account_id: null, charges_enabled: null });
    await expect(posTerminal.createPaymentIntent({
      amountCents: 900,
      currency: 'USD',
      metadata: {},
      idempotencyKey: 'k3',
      restaurantId: RESTAURANT_ID,
    })).rejects.toMatchObject({ code: 'restaurant_connect_account_missing', statusCode: 409 });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('fails closed when charges are not enabled on the Connect account', async () => {
    mockConnectRow({ stripe_account_id: ACCOUNT_ID, charges_enabled: false });
    await expect(posTerminal.createPaymentIntent({
      amountCents: 900,
      currency: 'USD',
      metadata: {},
      idempotencyKey: 'k4',
      restaurantId: RESTAURANT_ID,
    })).rejects.toMatchObject({ code: 'restaurant_connect_account_missing' });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('fails closed when the restaurant does not exist', async () => {
    mockConnectRow(null);
    await expect(posTerminal.createPaymentIntent({
      amountCents: 900,
      currency: 'USD',
      metadata: {},
      idempotencyKey: 'k5',
      restaurantId: RESTAURANT_ID,
    })).rejects.toMatchObject({ code: 'restaurant_connect_account_missing' });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('restaurantPosTerminalService.createConnectionToken (F-06)', () => {
  test('mints the token on the restaurant Connect account', async () => {
    mockConnectRow({ stripe_account_id: ACCOUNT_ID, charges_enabled: true });
    const token = await posTerminal.createConnectionToken('tml_location_1', { restaurantId: RESTAURANT_ID });
    expect(token.secret).toBe('pst_test_secret');
    expect(stripeMock.terminal.connectionTokens.create).toHaveBeenCalledWith(
      { location: 'tml_location_1' },
      { stripeAccount: ACCOUNT_ID }
    );
  });

  test('fails closed without a Connect account', async () => {
    mockConnectRow({ stripe_account_id: null, charges_enabled: null });
    await expect(
      posTerminal.createConnectionToken(null, { restaurantId: RESTAURANT_ID })
    ).rejects.toMatchObject({ code: 'restaurant_connect_account_missing' });
    expect(stripeMock.terminal.connectionTokens.create).not.toHaveBeenCalled();
  });
});
