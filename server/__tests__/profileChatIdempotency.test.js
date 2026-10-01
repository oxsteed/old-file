'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const chatController = require('../controllers/chatController');
const socketService = require('../services/socketService');

const clientMessageId = '11111111-1111-4111-8111-111111111111';
const message = {
  id: 'profile-message-1',
  conversation_id: 'conversation-1',
  sender_id: 'customer-1',
  content: 'I need help with this job.',
  client_message_id: clientMessageId,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1', email: 'customer@example.com' };
    next();
  });
  app.post('/api/chat/profile-message', chatController.profileChatMessage);
  app.post('/api/chat/sessions/guest', chatController.guestProfileChatSession);
  app.post('/api/chat/sessions/guest/claim', chatController.claimGuestProfileChatSessions);
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  });
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  socketService.isOnline = jest.fn().mockReturnValue(true);
  socketService.broadcastToUser = jest.fn();
});

describe('profile chat delivery', () => {
  test('recovers a shared conversation when two guest claims converge concurrently', async () => {
    const session = {
      id: 'guest-session-1',
      helper_id: 'helper-1',
      business_id: null,
      guest_name: 'Guest One',
      guest_email: 'customer@example.com',
      message: 'Can you help?',
      created_at: '2026-09-22T12:00:00.000Z',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ first_name: 'Customer', last_name: 'One', email: session.guest_email }] })
      .mockResolvedValueOnce({ rows: [session] })
      .mockResolvedValueOnce({ rows: [] }) // no conversation before the race
      .mockResolvedValueOnce({ rows: [] }) // another claim inserted it first
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-shared' }] })
      .mockResolvedValueOnce({ rows: [{ sender_type: 'guest', sender_name: session.guest_name, message: session.message, created_at: session.created_at }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1' }] })
      .mockResolvedValueOnce({ rows: [] }) // conversation timestamp
      .mockResolvedValueOnce({ rows: [] }); // mark inquiry claimed

    const res = await request(buildApp()).post('/api/chat/sessions/guest/claim');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ count: 1 }));
    expect(res.body.claimed[0]).toEqual(expect.objectContaining({ conversationId: 'conversation-shared' }));
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO conversations/.test(sql) && /ON CONFLICT DO NOTHING/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM conversations/.test(sql) && /FOR UPDATE/.test(sql))).toBe(true);
  });

  test('replays a guest messenger booking before creating another appointment or mirror message', async () => {
    const requestId = '33333333-3333-4333-8333-333333333333';
    const booking = {
      id: 'booking-1',
      appointment_id: 44,
      guest_session_id: 'guest-session-1',
      helper_id: 'helper-1',
      business_id: 7,
      service_name: 'Ceiling fan installation',
      service_id: 'service-1',
      requested_date: '2026-09-25',
      requested_start_time: '10:00:00',
      requested_end_time: '11:00:00',
      status: 'pending',
    };
    const appointment = { id: 44, status: 'requested' };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // agreement gate
      .mockResolvedValueOnce({ rows: [booking] })
      .mockResolvedValueOnce({ rows: [appointment] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [booking] })
      .mockResolvedValueOnce({ rows: [appointment] });

    const req = {
      body: {
        helperId: 'helper-1',
        businessId: 7,
        clientRequestId: requestId,
        requestedDate: '2026-09-25',
        requestedStartTime: '10:00',
        requestedEndTime: '11:00',
      },
      guestSession: {
        id: 'guest-session-1',
        helper_id: 'helper-1',
        business_id: 7,
        guest_name: 'Guest One',
        guest_email: 'guest@example.com',
      },
      user: null,
      get: jest.fn(() => undefined),
    };
    const first = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const retry = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    await chatController.createMessengerGuestBooking(req, first, jest.fn());
    await chatController.createMessengerGuestBooking(req, retry, jest.fn());

    expect(first.status).toHaveBeenCalledWith(200);
    expect(retry.status).toHaveBeenCalledWith(200);
    expect(retry.json).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: booking.id,
      appointmentId: appointment.id,
      idempotent: true,
    }));
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO appointments/.test(sql))).toHaveLength(0);
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO guest_profile_chat_messages/.test(sql))).toHaveLength(0);
  });

  test('rejects a malformed guest booking request id before touching the database', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await chatController.createMessengerGuestBooking({
      body: { clientRequestId: 'booking-retry-1' },
      user: null,
      get: jest.fn(() => undefined),
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'validation_failed' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('replays a committed live message without duplicate side effects', async () => {
    mockQuery
      // First request: admin-hidden check, availability, conversation, insert, timestamp, sender.
      .mockResolvedValueOnce({ rows: [] }) // not admin-hidden
      .mockResolvedValueOnce({ rows: [{ is_available_now: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1' }] })
      .mockResolvedValueOnce({ rows: [message] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ first_name: 'Customer', last_name: 'One', profile_photo_url: null }] })
      .mockResolvedValueOnce({ rows: [] }) // message notification outbox
      // Retry: admin-hidden check, availability, conversation, conflict, original message, sender.
      .mockResolvedValueOnce({ rows: [] }) // not admin-hidden
      .mockResolvedValueOnce({ rows: [{ is_available_now: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [message] })
      .mockResolvedValueOnce({ rows: [{ first_name: 'Customer', last_name: 'One', profile_photo_url: null }] });

    const app = buildApp();
    const body = {
      helperId: 'helper-1',
      destination: 'helper',
      clientMessageId,
      messages: [{ role: 'user', content: message.content }],
    };

    const first = await request(app).post('/api/chat/profile-message').send(body);
    const retry = await request(app).post('/api/chat/profile-message').send(body);

    expect(first.status).toBe(201);
    expect(first.body).toEqual(expect.objectContaining({ type: 'live', idempotent: false }));
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(expect.objectContaining({
      type: 'live',
      idempotent: true,
      message,
    }));
    expect(socketService.broadcastToUser).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE conversations/.test(sql))).toHaveLength(1);
  });

  test('rejects a malformed client message id before touching the database', async () => {
    const res = await request(buildApp())
      .post('/api/chat/profile-message')
      .send({
        helperId: 'helper-1',
        clientMessageId: 'retry-1',
        messages: [{ role: 'user', content: 'Hello' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('replays a public guest inquiry without sending duplicate notifications', async () => {
    const requestId = '22222222-2222-4222-8222-222222222222';
    mockQuery
      // First request: contact gate, inquiry insert, helper lookup, helper name.
      .mockResolvedValueOnce({ rows: [{ allow_guest_contact: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'guest-inquiry-1', created_at: '2026-09-22T12:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ first_name: 'Helper', last_name: 'One' }] })
      // Retry: contact gate, conflict, original inquiry.
      .mockResolvedValueOnce({ rows: [{ allow_guest_contact: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'guest-inquiry-1', created_at: '2026-09-22T12:00:00.000Z' }] });

    const app = buildApp();
    const body = {
      helperId: 'helper-1',
      guestName: 'Guest One',
      guestEmail: 'guest@example.com',
      message: 'Can you help?',
      clientRequestId: requestId,
    };
    const first = await request(app).post('/api/chat/sessions/guest').send(body);
    const retry = await request(app).post('/api/chat/sessions/guest').send(body);


    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(expect.objectContaining({ id: 'guest-inquiry-1', idempotent: true }));
    expect(socketService.broadcastToUser).toHaveBeenCalledTimes(1);
  });
});
