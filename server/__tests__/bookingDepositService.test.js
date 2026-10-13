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
    .mockResolvedValueOnce({ rows: [booking({ status: 'declined' })] })
    .mockResolvedValue({ rows: [] });
  mockStripe.refunds.create.mockResolvedValue({ id: 're_late' });
  await svc.applyBookingIntentWebhook('payment_intent.succeeded', {
    id: 'pi_b', amount: 2000, metadata: { booking_request_id: 'b1', source: 'mobile_booking' },
  });
  expect(mockStripe.refunds.create).toHaveBeenCalled();
});

test('non-booking intents are not claimed', async () => {
  expect(await svc.applyBookingIntentWebhook('payment_intent.succeeded', { id: 'pi_x', metadata: {} })).toBe(false);
});
