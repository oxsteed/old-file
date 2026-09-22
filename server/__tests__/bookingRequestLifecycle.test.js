'use strict';

/**
 * Unit tests for shared booking-request lifecycle helpers (no DB).
 * Marker/status gates live in chatBookingRequests; lifecycle re-exports them.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../services/socketService', () => ({
  broadcastToUser: jest.fn(),
  broadcastToConversation: jest.fn(),
  io: null,
}));

const pool = require('../db');
const socketService = require('../services/socketService');
const lifecycle = require('../services/bookingRequestLifecycle');

describe('bookingRequestLifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('toCalendarBooking maps conversation/source/status', () => {
    const card = lifecycle.toCalendarBooking({
      id: 'br-1',
      customer_id: 'c1',
      helper_id: 'h1',
      service_name: 'Cut',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
      status: 'counter_proposed',
      conversation_id: 'conv-1',
      source: 'messenger_picker',
      customer_name: 'Ada Lovelace',
    });
    expect(card.id).toBe('br-1');
    expect(card.status).toBe('counter_proposed');
    expect(card.conversationId).toBe('conv-1');
    expect(card.source).toBe('messenger_picker');
    expect(card.customerName).toBe('Ada Lovelace');
    expect(card.canRespond).toBe(true);
    expect(card.canCustomerRespond).toBe(true);
  });

  test('listIncomingForProvider defaults to pending + counter_proposed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // resolveProviderBusinessIds
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'a',
            helper_id: 'h1',
            customer_id: null,
            service_name: 'Guest cut',
            requested_date: '2026-09-22',
            requested_start_time: '09:00',
            requested_end_time: '10:00',
            status: 'pending',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            source: 'guest_chat',
            customer_name: null,
          },
          {
            id: 'b',
            helper_id: 'h1',
            customer_id: 'c1',
            service_name: 'Paint',
            requested_date: '2026-09-23',
            requested_start_time: '11:00',
            requested_end_time: '12:00',
            status: 'counter_proposed',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            conversation_id: 'conv-9',
            source: 'messenger',
            customer_name: 'Bob',
          },
        ],
      });

    const rows = await lifecycle.listIncomingForProvider('h1');
    expect(pool.query).toHaveBeenCalledTimes(2);
    const bizSql = pool.query.mock.calls[0][0];
    expect(bizSql).toMatch(/businesses/);
    const sql = pool.query.mock.calls[1][0];
    expect(sql).toMatch(/LEFT JOIN users/);
    expect(sql).toMatch(/br\.business_id = ANY/);
    expect(pool.query.mock.calls[1][1][0]).toBe('h1');
    expect(pool.query.mock.calls[1][1][1]).toEqual([]);
    expect(pool.query.mock.calls[1][1][2]).toEqual(['pending', 'counter_proposed']);
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBe('guest_chat');
    expect(rows[1].conversationId).toBe('conv-9');
  });

  test('listIncomingForProvider includes business-scoped rows for members', async () => {
    const bizId = '00000000-0000-4000-8000-000000000b01';
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: bizId }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'biz-br',
            helper_id: 'owner-h',
            business_id: bizId,
            customer_id: 'c1',
            service_name: 'Biz cut',
            requested_date: '2026-09-22',
            requested_start_time: '09:00',
            requested_end_time: '10:00',
            status: 'pending',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            source: 'messenger',
            customer_name: 'Cara',
          },
        ],
      });

    const rows = await lifecycle.listIncomingForProvider('member-1');
    expect(pool.query.mock.calls[1][1][0]).toBe('member-1');
    expect(pool.query.mock.calls[1][1][1]).toEqual([bizId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].businessId).toBe(bizId);
    expect(rows[0].canRespond).toBe(true);
  });

  test('isProviderForBooking allows business member via business_id', async () => {
    const booking = {
      id: 'br-biz',
      helper_id: 'owner-h',
      business_id: 'biz-1',
      status: 'pending',
    };
    // assertBusinessAccess query
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'biz-1', user_id: 'owner-h', business_name: 'Salon' }],
    });
    await expect(lifecycle.isProviderForBooking('member-1', booking)).resolves.toBe(true);
    await expect(lifecycle.isProviderForBooking('member-1', { helper_id: 'other' })).resolves.toBe(
      false,
    );
    await expect(lifecycle.isProviderForBooking('owner-h', { helper_id: 'owner-h' })).resolves.toBe(
      true,
    );
  });

  test('acceptBookingRequest updates status and emits booking:updated', async () => {
    const booking = {
      id: 'br-accept',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'pending',
      service_name: 'Trim',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
      source: 'calendar',
    };
    pool.query
      .mockResolvedValueOnce({
        rows: [{ ...booking, status: 'accepted', accepted_at: new Date().toISOString() }],
      }) // UPDATE accept
      .mockResolvedValueOnce({
        rows: [{ id: 99, status: 'confirmed' }],
      }) // INSERT appointment
      .mockResolvedValueOnce({ rows: [] }) // link appointment_id
      .mockResolvedValueOnce({ rows: [] }); // audit

    const result = await lifecycle.acceptBookingRequest({
      booking,
      actorId: 'h1',
      appointmentSource: 'calendar_accept',
    });

    expect(result.booking.status).toBe('accepted');
    expect(result.appointment.id).toBe(99);
    expect(socketService.broadcastToUser).toHaveBeenCalledWith(
      'h1',
      'booking:updated',
      expect.objectContaining({ event: 'accepted', bookingId: 'br-accept' }),
    );
    expect(socketService.broadcastToUser).toHaveBeenCalledWith(
      'c1',
      'booking:chat_updated',
      expect.any(Object),
    );
  });

  test('acceptBookingRequest rejects already accepted', async () => {
    await expect(
      lifecycle.acceptBookingRequest({
        booking: { id: 'x', status: 'accepted', helper_id: 'h' },
        actorId: 'h',
      }),
    ).rejects.toMatchObject({ code: 'already_accepted', status: 409 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('proposeBookingTime sets counter_proposed and syncs legacy counter_*', async () => {
    const booking = {
      id: 'br-prop',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'pending',
      service_name: 'Paint',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
    };
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            ...booking,
            status: 'counter_proposed',
            requested_date: '2026-09-24',
            requested_start_time: '14:00:00',
            requested_end_time: '15:00:00',
            counter_status: 'pending',
            counter_date: '2026-09-24',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // audit

    const result = await lifecycle.proposeBookingTime({
      booking,
      actorId: 'h1',
      date: '2026-09-24',
      start: '14:00',
      end: '15:00',
      note: 'Later?',
    });

    expect(result.booking.status).toBe('counter_proposed');
    const updateSql = pool.query.mock.calls[0][0];
    expect(updateSql).toMatch(/status = 'counter_proposed'/);
    expect(updateSql).toMatch(/counter_status = 'pending'/);
    expect(socketService.broadcastToUser).toHaveBeenCalledWith(
      'h1',
      'booking:updated',
      expect.objectContaining({ event: 'counter_proposed' }),
    );
  });

  test('declineBookingRequest cancels linked appointment', async () => {
    const booking = {
      id: 'br-dec',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'counter_proposed',
      appointment_id: 55,
      service_name: 'Cut',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
    };
    pool.query
      .mockResolvedValueOnce({
        rows: [{ ...booking, status: 'declined' }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 55, status: 'cancelled' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await lifecycle.declineBookingRequest({
      booking,
      actorId: 'h1',
      reason: 'Busy',
    });
    expect(result.booking.status).toBe('declined');
    const cancelSql = pool.query.mock.calls[1][0];
    expect(cancelSql).toMatch(/UPDATE appointments/);
    expect(cancelSql).toMatch(/cancelled/);
  });

  test('customerAccept only for counter_proposed (or legacy counter_status)', async () => {
    await expect(
      lifecycle.customerAcceptBookingRequest({
        booking: { id: 'x', status: 'pending', counter_status: null },
        actorId: 'c',
      }),
    ).rejects.toMatchObject({ code: 'awaiting_provider' });
  });

  test('re-exported status gates match chat service', () => {
    expect(lifecycle.canProviderRespond({ status: 'pending' }).ok).toBe(true);
    expect(lifecycle.canCustomerRespond({ status: 'counter_proposed' }).ok).toBe(true);
    expect(lifecycle.INBOX_STATUSES).toEqual(['pending', 'counter_proposed']);
  });
});
