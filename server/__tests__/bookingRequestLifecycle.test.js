'use strict';

/**
 * Unit tests for shared booking-request lifecycle helpers (no DB).
 * Marker/status gates live in chatBookingRequests; lifecycle re-exports them.
 */

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../services/socketService', () => ({
  broadcastToUser: jest.fn(),
  broadcastToConversation: jest.fn(),
  broadcastToBusinessCalendar: jest.fn(),
  io: null,
}));
jest.mock('../services/helperAvailabilityService', () => ({
  isSlotFree: jest.fn(),
}));

const pool = require('../db');
const socketService = require('../services/socketService');
const availabilityService = require('../services/helperAvailabilityService');
const lifecycle = require('../services/bookingRequestLifecycle');

describe('bookingRequestLifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    availabilityService.isSlotFree.mockResolvedValue({ free: true });
  });

  // NOTE: __tests__/setup.js replaces withTransaction with a pass-through that
  // runs the operation callback using pool.query as the client (no real
  // BEGIN/COMMIT, pool.connect() is never called). Transactional tests
  // therefore queue every query on pool.query in exact call order.
  function queueTx(values) {
    for (const v of values) pool.query.mockResolvedValueOnce(v);
  }
  function txSql() {
    return pool.query.mock.calls.map((c) => String(c[0])).join('\n');
  }

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
    queueTx([
      { rows: [] }, // advisory lock
      { rows: [booking] }, // re-read inside txn (still pending)
      { rows: [] }, // pre-accept overlap check
      // isSlotFree mocked -> free
      { rows: [{ ...booking, status: 'accepted', accepted_at: new Date().toISOString() }] }, // UPDATE accept
      { rows: [] }, // confirm: overlap check
      // isSlotFree mocked -> free
      { rows: [{ id: 99, status: 'confirmed' }] }, // INSERT appointment
      { rows: [] }, // link appointment_id
      { rows: [] }, // audit
    ]);

    const result = await lifecycle.acceptBookingRequest({
      booking,
      actorId: 'h1',
      appointmentSource: 'calendar_accept',
    });

    expect(result.booking.status).toBe('accepted');
    expect(result.booking.appointment_id).toBe(99);
    expect(result.appointment.id).toBe(99);
    // The slot was conflict-checked before the status flip.
    const sql = txSql();
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql.indexOf('pg_advisory_xact_lock')).toBeLessThan(sql.indexOf("status = 'accepted'"));
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

  test('acceptBookingRequest rejects an already auto-posted booking', async () => {
    await expect(
      lifecycle.acceptBookingRequest({
        booking: { id: 'x', status: 'pending', helper_id: 'h', converted_to_job_id: 'job-1' },
        actorId: 'h',
      }),
    ).rejects.toMatchObject({ code: 'already_posted', status: 409 });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('acceptBookingRequest refuses a stale pending booking and expires it', async () => {
    const booking = {
      id: 'br-stale',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'pending',
      service_name: 'Trim',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
      expires_at: new Date(Date.now() - 3600_000).toISOString(),
      auto_post_on_expiry: false,
    };
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...booking, status: 'expired' }] }) // expireIfStale UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit

    await expect(
      lifecycle.acceptBookingRequest({ booking, actorId: 'h1' }),
    ).rejects.toMatchObject({ code: 'expired', status: 409 });
    // The accept transaction never started; the row was expired on the read path.
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query.mock.calls[0][0]).toMatch(/status = 'expired'/);
  });

  test('acceptBookingRequest transitions a booking whose window lapsed inside the transaction', async () => {
    jest.useFakeTimers();
    try {
      const T = new Date('2026-09-29T12:00:00Z').getTime();
      jest.setSystemTime(T);
      const booking = {
        id: 'br-race',
        helper_id: 'h1',
        customer_id: 'c1',
        status: 'pending',
        service_name: 'Trim',
        requested_date: '2026-09-29',
        requested_start_time: '13:00:00',
        requested_end_time: '14:00:00',
        expires_at: new Date(T + 60_000).toISOString(), // lapses after the accept starts
        auto_post_on_expiry: false,
      };
      const staleRow = { ...booking, expires_at: new Date(T - 1000).toISOString() };
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // advisory lock
        .mockImplementationOnce(async () => {
          // The window lapses between the outer pre-check and the re-read.
          jest.setSystemTime(T + 120_000);
          return { rows: [staleRow] };
        })
        .mockResolvedValueOnce({ rows: [{ ...booking, status: 'expired' }] }) // expireIfStale UPDATE
        .mockResolvedValueOnce({ rows: [] }); // audit

      await expect(
        lifecycle.acceptBookingRequest({ booking, actorId: 'h1' }),
      ).rejects.toMatchObject({ code: 'expired', status: 409 });

      const sql = txSql();
      expect(sql).toMatch(/SET status = 'expired'/);
      expect(sql).not.toMatch(/status = 'accepted'/);
    } finally {
      jest.useRealTimers();
    }
  });

  test('acceptBookingRequest requires an agreed time (request-only)', async () => {
    const booking = {
      id: 'br-no-time',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'pending',
      service_name: 'Consult',
      availability_mode: 'request_only',
      requested_date: null,
      requested_start_time: null,
      requested_end_time: null,
    };
    queueTx([
      { rows: [] }, // advisory lock
      { rows: [booking] }, // re-read: still no time
    ]);

    await expect(
      lifecycle.acceptBookingRequest({ booking, actorId: 'h1' }),
    ).rejects.toMatchObject({ code: 'time_required', status: 409 });
    // The accept UPDATE never ran, so the booking stays pending for a
    // counter-proposal first.
    expect(txSql()).not.toMatch(/status = 'accepted'/);
  });

  test('acceptBookingRequest excludes the own linked appointment from the conflict check', async () => {
    const booking = {
      id: 'br-linked',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'pending',
      service_name: 'Trim',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
      appointment_id: 55,
    };
    queueTx([
      { rows: [] }, // advisory lock
      { rows: [booking] }, // re-read
      { rows: [] }, // pre-accept overlap check (own appointment excluded)
      { rows: [{ ...booking, status: 'accepted', accepted_at: new Date().toISOString() }] }, // UPDATE accept
      { rows: [{ id: 55, status: 'confirmed' }] }, // confirm existing appointment
      { rows: [] }, // audit
    ]);

    const result = await lifecycle.acceptBookingRequest({ booking, actorId: 'h1' });
    expect(result.booking.status).toBe('accepted');
    const overlapCall = pool.query.mock.calls.find((c) =>
      /FROM appointments/.test(c[0]) && /scheduled_start_time/.test(c[0]),
    );
    expect(overlapCall[0]).toMatch(/id <> \$4/);
    expect(overlapCall[1][3]).toBe(55);
    // Confirming the linked appointment, not inserting a second one.
    const inserts = pool.query.mock.calls.filter((c) => /INSERT INTO appointments/.test(c[0]));
    expect(inserts).toHaveLength(0);
  });

  test('acceptBookingRequest creates a business_appointments row for business bookings', async () => {
    const booking = {
      id: 'br-biz-accept',
      helper_id: 'owner-h',
      customer_id: 'c1',
      business_id: 7,
      status: 'pending',
      service_name: 'Biz cut',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
      source: 'messenger_picker',
    };
    const service = { id: 'svc-1', name: 'Biz cut', base_price_cents: 5000 };
    queueTx([
      { rows: [] }, // advisory lock
      { rows: [booking] }, // re-read
      { rows: [] }, // pre-accept business overlap check
      { rows: [service] }, // pre-accept service resolution (name match)
      { rows: [{ ...booking, status: 'accepted', accepted_at: new Date().toISOString() }] }, // UPDATE accept
      { rows: [] }, // create: business overlap check
      { rows: [service] }, // create: service resolution
      { rows: [] }, // create: customer lookup
      { rows: [{ id: 'ba-1', status: 'confirmed' }] }, // INSERT business_appointments
      { rows: [] }, // link business_appointment_id
      { rows: [] }, // audit
    ]);

    const result = await lifecycle.acceptBookingRequest({
      booking,
      actorId: 'owner-h',
      appointmentSource: 'messenger_accept',
    });

    expect(result.booking.status).toBe('accepted');
    expect(result.booking.business_appointment_id).toBe('ba-1');
    expect(result.appointment.id).toBe('ba-1');
    const businessInserts = pool.query.mock.calls.filter((c) =>
      /INSERT INTO business_appointments/.test(c[0]),
    );
    expect(businessInserts).toHaveLength(1);
    // Never touches the owner's personal appointments table.
    const helperInserts = pool.query.mock.calls.filter((c) =>
      /INSERT INTO appointments(?!\w)/.test(c[0]),
    );
    expect(helperInserts).toHaveLength(0);
    // The business advisory lock scopes to the business calendar.
    expect(pool.query.mock.calls[0][1][0]).toBe('business_appointments:7');
  });

  test('acceptBookingRequest rolls back when the business service is gone', async () => {
    const booking = {
      id: 'br-biz-nosvc',
      helper_id: 'owner-h',
      customer_id: 'c1',
      business_id: 7,
      status: 'pending',
      service_name: 'Retired cut',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
    };
    queueTx([
      { rows: [] }, // advisory lock
      { rows: [booking] }, // re-read
      { rows: [] }, // pre-accept business overlap check
      { rows: [] }, // service name lookup: no match
    ]);

    await expect(
      lifecycle.acceptBookingRequest({ booking, actorId: 'owner-h' }),
    ).rejects.toMatchObject({ code: 'business_service_missing', status: 409 });
    const sql = txSql();
    expect(sql).not.toMatch(/status = 'accepted'/);
    expect(sql).not.toMatch(/INSERT INTO business_appointments/);
  });

  test('acceptBookingRequest fails cleanly on a double-booked slot', async () => {
    const booking = {
      id: 'br-conflict',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'pending',
      service_name: 'Trim',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
    };
    queueTx([
      { rows: [] }, // advisory lock
      { rows: [booking] }, // re-read
      { rows: [{ 1: 1 }] }, // pre-check finds overlap
    ]);
    await expect(
      lifecycle.acceptBookingRequest({ booking, actorId: 'h1' }),
    ).rejects.toMatchObject({ code: 'SCHEDULING_CONFLICT', status: 409 });
    expect(txSql()).not.toMatch(/status = 'accepted'/);
  });

  test('acceptBookingRequest rejects already accepted', async () => {
    await expect(
      lifecycle.acceptBookingRequest({
        booking: { id: 'x', status: 'accepted', helper_id: 'h' },
        actorId: 'h',
      }),
    ).rejects.toMatchObject({ code: 'already_accepted', status: 409 });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
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
    const future = new Date(Date.now() + 5 * 86400000);
    const futureStr = future.toISOString().slice(0, 10);
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // counter-proposal slot availability check
      // isSlotFree mocked -> free
      .mockResolvedValueOnce({
        rows: [
          {
            ...booking,
            status: 'counter_proposed',
            requested_date: futureStr,
            requested_start_time: '14:00:00',
            requested_end_time: '15:00:00',
            counter_status: 'pending',
            counter_date: futureStr,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // audit

    const result = await lifecycle.proposeBookingTime({
      booking,
      actorId: 'h1',
      date: futureStr,
      start: '14:00',
      end: '15:00',
      note: 'Later?',
    });

    expect(result.booking.status).toBe('counter_proposed');
    const updateSql = pool.query.mock.calls[1][0];
    expect(updateSql).toMatch(/status = 'counter_proposed'/);
    expect(updateSql).toMatch(/counter_status = 'pending'/);
    expect(socketService.broadcastToUser).toHaveBeenCalledWith(
      'h1',
      'booking:updated',
      expect.objectContaining({ event: 'counter_proposed' }),
    );
  });

  test('proposeBookingTime rejects a past date', async () => {
    const booking = {
      id: 'br-prop-past',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'pending',
      service_name: 'Paint',
    };
    await expect(
      lifecycle.proposeBookingTime({
        booking,
        actorId: 'h1',
        date: '2020-01-01',
        start: '14:00',
        end: '15:00',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed', status: 400 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('proposeBookingTime rejects a conflicting time', async () => {
    const booking = {
      id: 'br-prop-conflict',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'pending',
      service_name: 'Paint',
    };
    const future = new Date(Date.now() + 5 * 86400000);
    const futureStr = future.toISOString().slice(0, 10);
    pool.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // overlap found
    await expect(
      lifecycle.proposeBookingTime({
        booking,
        actorId: 'h1',
        date: futureStr,
        start: '14:00',
        end: '15:00',
      }),
    ).rejects.toMatchObject({ code: 'slot_conflict', status: 409 });
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

  test('customerAccept rolls back on a double-booked slot', async () => {
    const booking = {
      id: 'br-cust-conflict',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'counter_proposed',
      service_name: 'Trim',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
    };
    queueTx([
      { rows: [] }, // advisory lock
      { rows: [{ 1: 1 }] }, // pre-accept overlap check finds a conflict
    ]);

    await expect(
      lifecycle.customerAcceptBookingRequest({ booking, actorId: 'c1' }),
    ).rejects.toMatchObject({ code: 'SCHEDULING_CONFLICT', status: 409 });
    expect(txSql()).not.toMatch(/status = 'accepted'/);
  });

  test('declineBookingRequest cancels the linked business appointment', async () => {
    const booking = {
      id: 'br-biz-dec',
      helper_id: 'owner-h',
      customer_id: 'c1',
      business_id: 7,
      business_appointment_id: 'ba-9',
      status: 'counter_proposed',
      service_name: 'Biz cut',
    };
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...booking, status: 'declined' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ba-9', status: 'cancelled' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await lifecycle.declineBookingRequest({ booking, actorId: 'owner-h' });
    expect(result.booking.status).toBe('declined');
    const cancelSql = pool.query.mock.calls[1][0];
    expect(cancelSql).toMatch(/UPDATE business_appointments/);
    expect(cancelSql).toMatch(/cancelled/);
  });

  test('proposeBookingTime refuses a stale pending booking', async () => {
    const booking = {
      id: 'br-prop-stale',
      helper_id: 'h1',
      customer_id: 'c1',
      status: 'pending',
      service_name: 'Paint',
      expires_at: new Date(Date.now() - 3600_000).toISOString(),
      auto_post_on_expiry: false,
    };
    const future = new Date(Date.now() + 5 * 86400000);
    const futureStr = future.toISOString().slice(0, 10);
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...booking, status: 'expired' }] }) // expireIfStale UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit

    await expect(
      lifecycle.proposeBookingTime({
        booking,
        actorId: 'h1',
        date: futureStr,
        start: '14:00',
        end: '15:00',
      }),
    ).rejects.toMatchObject({ code: 'expired', status: 409 });
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

  test('emitBookingEvent fans out to business calendar room + other members', async () => {
    const booking = {
      id: 'br-biz',
      helper_id: 'owner-h',
      customer_id: 'c1',
      business_id: 'biz-1',
      status: 'pending',
      service_name: 'Cut',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
    };
    // listBusinessMemberUserIds query
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'owner-h' }, { id: 'member-2' }, { id: 'member-3' }],
    });

    await lifecycle.emitBookingEvent({ booking, event: 'requested', actorId: 'c1' });

    expect(socketService.broadcastToBusinessCalendar).toHaveBeenCalledWith(
      'biz-1',
      'booking:updated',
      expect.objectContaining({ bookingId: 'br-biz', businessId: 'biz-1', event: 'requested' }),
    );
    expect(socketService.broadcastToBusinessCalendar).toHaveBeenCalledWith(
      'biz-1',
      'booking:new',
      expect.any(Object),
    );
    // helper + customer notified
    expect(socketService.broadcastToUser).toHaveBeenCalledWith(
      'owner-h',
      'booking:new',
      expect.any(Object),
    );
    expect(socketService.broadcastToUser).toHaveBeenCalledWith(
      'c1',
      'booking:updated',
      expect.any(Object),
    );
    // other members get user-room fanout; helper not double-counted as extra loop target
    expect(socketService.broadcastToUser).toHaveBeenCalledWith(
      'member-2',
      'booking:updated',
      expect.any(Object),
    );
    expect(socketService.broadcastToUser).toHaveBeenCalledWith(
      'member-3',
      'booking:new',
      expect.any(Object),
    );
  });

  test('emitBookingEvent skips business fanout when business_id unset', async () => {
    await lifecycle.emitBookingEvent({
      booking: {
        id: 'br-solo',
        helper_id: 'h1',
        customer_id: 'c1',
        status: 'accepted',
        service_name: 'Cut',
        requested_date: '2026-09-22',
        requested_start_time: '09:00:00',
        requested_end_time: '10:00:00',
      },
      event: 'accepted',
    });
    expect(socketService.broadcastToBusinessCalendar).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
