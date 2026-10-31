'use strict';

// Review P3-962: booking deposits are never stranded.
const { mockQuery, resetMocks } = require('./setup');

const mockStripe = {
  refunds: { create: jest.fn() },
  paymentIntents: { cancel: jest.fn(), retrieve: jest.fn() },
};
jest.mock('stripe', () => () => mockStripe);

const svc = require('../services/bookingDepositService');

beforeEach(() => {
  resetMocks();
  Object.values(mockStripe).forEach((o) => Object.values(o).forEach((f) => f.mockReset()));
});

function booking(over = {}) {
  return { id: 'b1', status: 'cancelled', payment_status: 'paid', stripe_payment_intent_id: 'pi_b', appointment_id: null, ...over };
}

test('a paid deposit on a cancelled booking is refunded with a per-booking key', async () => {
  mockQuery.mockImplementation(async (sql) => (String(sql).startsWith('SELECT * FROM booking_requests') ? { rows: [booking()] } : { rows: [], rowCount: 1 }));
  mockStripe.refunds.create.mockResolvedValue({ id: 're_b' });
  await expect(svc.settleTerminalBooking('b1')).resolves.toBe('refunded');
  expect(mockStripe.refunds.create).toHaveBeenCalledWith(
    expect.objectContaining({ payment_intent: 'pi_b' }),
    { idempotencyKey: 'booking-deposit:b1:refund' }
  );
  expect(mockQuery.mock.calls.some(([sql]) => /SET payment_status = 'refunded'/.test(String(sql)))).toBe(true);
  // Decision 2: the refunded booking releases its promo redemption.
  const reversal = mockQuery.mock.calls.find(([sql]) => /UPDATE promo_redemptions SET status = 'reversed'/.test(String(sql)));
  expect(reversal[1]).toEqual(['booking', 'b1', null, 'booking_refunded']);
});

test('an unpaid intent on an ended booking is voided', async () => {
  mockQuery.mockImplementation(async (sql) => (String(sql).startsWith('SELECT * FROM booking_requests') ? { rows: [booking({ status: 'expired', payment_status: 'requires_payment' })] } : { rows: [] }));
  mockStripe.paymentIntents.cancel.mockResolvedValue({ status: 'canceled' });
  await expect(svc.settleTerminalBooking('b1')).resolves.toBe('voided');
  expect(mockStripe.refunds.create).not.toHaveBeenCalled();
});

test('accepted_cancelled with a completed appointment keeps the payment', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const t = String(sql);
    if (t.startsWith('SELECT * FROM booking_requests')) return { rows: [booking({ status: 'accepted_cancelled', appointment_id: 5 })] };
    if (t.includes('FROM appointments')) return { rows: [{ status: 'completed' }] };
    return { rows: [] };
  });
  await expect(svc.settleTerminalBooking('b1')).resolves.toBe('service_delivered');
  expect(mockStripe.refunds.create).not.toHaveBeenCalled();
});

test('active bookings are left alone', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [booking({ status: 'accepted' })] });
  await expect(svc.settleTerminalBooking('b1')).resolves.toBe('not_terminal');
});

test('webhook marks a booking paid even if the client never confirmed', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'b1', status: 'pending' }] });
  const handled = await svc.applyBookingIntentWebhook('payment_intent.succeeded', {
    id: 'pi_b', amount: 2000, amount_received: 2000, metadata: { booking_request_id: 'b1', source: 'mobile_booking' },
  });
  expect(handled).toBe(true);
  expect(String(mockQuery.mock.calls[0][0])).toMatch(/SET payment_status = 'paid'/);
});

test('payment landing after the booking ended is refunded immediately', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'b1', status: 'declined' }] })
    .mockResolvedValueOnce({ rows: [] }) // promo markRedeemed
    .mockResolvedValueOnce({ rows: [booking({ status: 'declined' })] })
    .mockResolvedValue({ rows: [] });
  mockStripe.refunds.create.mockResolvedValue({ id: 're_late' });
  await svc.applyBookingIntentWebhook('payment_intent.succeeded', {
    id: 'pi_b', amount: 2000, metadata: { booking_request_id: 'b1', source: 'mobile_booking' },
  });
  expect(mockStripe.refunds.create).toHaveBeenCalled();
});

test('webhook success redeems the booking promo; a canceled intent releases it', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'b1', status: 'pending' }] }).mockResolvedValue({ rows: [] });
  await svc.applyBookingIntentWebhook('payment_intent.succeeded', {
    id: 'pi_b', amount: 1500, metadata: { booking_request_id: 'b1', source: 'mobile_booking' },
  });
  expect(String(mockQuery.mock.calls[1][0])).toMatch(/SET status = 'redeemed'/);
  expect(mockQuery.mock.calls[1][1]).toEqual(['booking', null, 'pi_b']);

  mockQuery.mockClear();
  await svc.applyBookingIntentWebhook('payment_intent.canceled', {
    id: 'pi_b', metadata: { booking_request_id: 'b1', source: 'mobile_booking' },
  });
  expect(String(mockQuery.mock.calls[1][0])).toMatch(/SET status = 'reversed'/);
  expect(mockQuery.mock.calls[1][1]).toEqual(['booking', null, 'pi_b', 'intent_canceled']);

  mockQuery.mockClear();
  await svc.applyBookingIntentWebhook('payment_intent.payment_failed', {
    id: 'pi_b', metadata: { booking_request_id: 'b1', source: 'mobile_booking' },
  });
  expect(mockQuery.mock.calls.some(([sql]) => /promo_redemptions/.test(String(sql)))).toBe(false);
});

test('non-booking intents are not claimed', async () => {
  expect(await svc.applyBookingIntentWebhook('payment_intent.succeeded', { id: 'pi_x', metadata: {} })).toBe(false);
});

test('the 20th failed settlement raises a critical reconciliation exception', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const t = String(sql);
    if (t.startsWith('SELECT * FROM booking_requests')) return { rows: [booking({ refund_attempts: 19 })] };
    if (t.includes('UPDATE booking_requests') && t.includes('RETURNING refund_attempts')) return { rows: [{ refund_attempts: 20 }] };
    if (t.startsWith('SELECT id FROM reconciliation_exceptions')) return { rows: [] };
    if (t.includes('INSERT INTO reconciliation_exceptions')) return { rows: [{ id: 'exc-1' }] };
    return { rows: [] };
  });
  mockStripe.refunds.create.mockRejectedValue(new Error('stripe down'));
  await expect(svc.settleTerminalBooking('b1')).rejects.toThrow('stripe down');
  const insert = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO reconciliation_exceptions'));
  expect(insert).toBeTruthy();
  expect(insert[1]).toEqual([
    'payment_refund',
    'b1',
    'critical',
    expect.stringContaining('exhausted 20 attempts'),
    expect.anything(),
    null,
  ]);
});

test('a capped booking is flagged for operators without another Stripe call', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const t = String(sql);
    if (t.startsWith('SELECT * FROM booking_requests')) return { rows: [booking({ refund_attempts: 20, refund_last_error: 'stripe down' })] };
    if (t.startsWith('SELECT id FROM reconciliation_exceptions')) return { rows: [] };
    if (t.includes('INSERT INTO reconciliation_exceptions')) return { rows: [{ id: 'exc-1' }] };
    return { rows: [] };
  });
  await expect(svc.flagExhaustedTerminalBooking('b1')).resolves.toBe('flagged');
  expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  expect(mockStripe.paymentIntents.cancel).not.toHaveBeenCalled();
});

test('flagging skips bookings below the attempt cap', async () => {
  mockQuery.mockImplementation(async (sql) => (
    String(sql).startsWith('SELECT * FROM booking_requests')
      ? { rows: [booking({ refund_attempts: 5 })] }
      : { rows: [] }
  ));
  await expect(svc.flagExhaustedTerminalBooking('b1')).resolves.toBe('not_exhausted');
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO reconciliation_exceptions'))).toBe(false);
});
