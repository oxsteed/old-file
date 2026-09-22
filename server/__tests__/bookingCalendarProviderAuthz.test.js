'use strict';

/**
 * Calendar /bookings/* wrappers must use the same provider authz as chat
 * (business member / helper owner), not helper_id-only.
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
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../controllers/chatBookingRequestsController', () => ({
  postStatusToThreadForLifecycle: jest.fn().mockResolvedValue(undefined),
}));

const pool = require('../db');
const bookingController = require('../controllers/bookingController');
const lifecycle = require('../services/bookingRequestLifecycle');

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const MEMBER = '00000000-0000-4000-8000-0000000000a2';
const BIZ = '00000000-0000-4000-8000-0000000000b1';
const CUSTOMER = '00000000-0000-4000-8000-0000000000c1';
const BOOKING_ID = '00000000-0000-4000-8000-0000000000d1';

function resMock() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('calendar booking provider authz', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('business member can accept via /bookings/:id/accept wrapper', async () => {
    const pending = {
      id: BOOKING_ID,
      helper_id: OWNER,
      business_id: BIZ,
      customer_id: CUSTOMER,
      status: 'pending',
      service_name: 'Cut',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
      source: 'messenger',
      conversation_id: null,
      guest_session_id: null,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    const accepted = {
      ...pending,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    };

    // loadBooking
    pool.query.mockResolvedValueOnce({ rows: [pending] });
    // isProviderForBooking → assertBusinessAccess
    pool.query.mockResolvedValueOnce({
      rows: [{ id: BIZ, user_id: OWNER, business_name: 'Salon' }],
    });
    // accept UPDATE
    pool.query.mockResolvedValueOnce({ rows: [accepted] });
    // confirmOrCreateAppointment INSERT
    pool.query.mockResolvedValueOnce({ rows: [{ id: 77, status: 'confirmed' }] });
    // link appointment_id
    pool.query.mockResolvedValueOnce({ rows: [] });
    // audit
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = resMock();
    await bookingController.acceptBookingRequest(
      {
        params: { bookingId: BOOKING_ID },
        user: { id: MEMBER, first_name: 'Biz', last_name: 'Member' },
        body: {},
      },
      res,
    );

    expect(res.json).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe('accepted');
    expect(payload.appointmentId).toBe(77);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  test('non-provider is rejected on calendar accept', async () => {
    const pending = {
      id: BOOKING_ID,
      helper_id: OWNER,
      business_id: BIZ,
      customer_id: CUSTOMER,
      status: 'pending',
      service_name: 'Cut',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
    };
    pool.query
      .mockResolvedValueOnce({ rows: [pending] }) // load
      .mockResolvedValueOnce({ rows: [] }); // assertBusinessAccess deny

    const res = resMock();
    await bookingController.acceptBookingRequest(
      {
        params: { bookingId: BOOKING_ID },
        user: { id: '00000000-0000-4000-8000-000000000099' },
        body: {},
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('helper-only calendar still accepts assigned helper', async () => {
    const pending = {
      id: BOOKING_ID,
      helper_id: OWNER,
      business_id: null,
      customer_id: CUSTOMER,
      status: 'pending',
      service_name: 'Solo',
      requested_date: '2026-09-22',
      requested_start_time: '09:00:00',
      requested_end_time: '10:00:00',
      conversation_id: null,
      guest_session_id: null,
    };
    const accepted = { ...pending, status: 'accepted', accepted_at: new Date().toISOString() };

    pool.query
      .mockResolvedValueOnce({ rows: [pending] })
      .mockResolvedValueOnce({ rows: [accepted] })
      .mockResolvedValueOnce({ rows: [{ id: 88, status: 'confirmed' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = resMock();
    await bookingController.acceptBookingRequest(
      { params: { bookingId: BOOKING_ID }, user: { id: OWNER, first_name: 'H' }, body: {} },
      res,
    );
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  test('incoming list resolves business ids for provider scope', async () => {
    const spy = jest.spyOn(lifecycle, 'listIncomingForProvider').mockResolvedValueOnce([]);
    const res = resMock();
    await bookingController.getIncomingBookingRequests(
      { user: { id: MEMBER }, query: {} },
      res,
    );
    expect(spy).toHaveBeenCalledWith(MEMBER, expect.any(Object));
    spy.mockRestore();
  });
});
