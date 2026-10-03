'use strict';

/**
 * server/__tests__/foodRestaurantMessaging.test.js
 *
 * Covers the Message-the-restaurant flow (POST /food/restaurants/:id/messages):
 *  1. Conversation creation is idempotent: one legacy thread per
 *     customer+restaurant, with the correct participants, and every message is
 *     bridged into the business inbox (business_conversations/business_messages).
 *  2. The creation path is rate-limited by profileChatLimiter (genuine gap:
 *     the route previously had no limiter at all).
 *  3. Offline behavior: the message is queued in the business inbox even when
 *     nobody is on the socket, and no SLA promises are made anywhere.
 *  4. The restaurant side sees the bridged thread in the business inbox and
 *     claim/release work for this conversation type.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/businessConversationSync', () => ({
  ensureBusinessConversation: jest.fn(),
  mirrorMessage: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

const foodController = require('../controllers/foodController');
const businessMessagingController = require('../controllers/businessMessagingController');
const businessConversationAssignmentController = require('../controllers/businessConversationAssignmentController');
const { ensureBusinessConversation, mirrorMessage } = require('../services/businessConversationSync');
const notificationService = require('../services/notificationService');
const socketService = require('../services/socketService');
const { authenticate } = require('../middleware/auth');
const { profileChatLimiter } = require('../middleware/rateLimiter');
const foodRoutes = require('../routes/food');

const USER = {
  id: '00000000-0000-4000-8000-000000000123',
  first_name: 'Test',
  last_name: 'Customer',
  email: 'customer@example.com',
  phone: '+15551234567',
};
const OWNER_ID = '00000000-0000-4000-8000-000000000456';
const MEMBER_ID = '00000000-0000-4000-8000-000000000789';
const RESTAURANT = {
  id: 3,
  business_id: 7,
  owner_user_id: OWNER_ID,
  display_name: 'Ox Burger Lab',
  status: 'active',
};

function buildFoodApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { ...USER };
    next();
  });
  app.post('/api/food/restaurants/:restaurantId/messages', foodController.createRestaurantCustomerMessage);
  app.use(errorHandler);
  return app;
}

function queueRestaurantLookup() {
  mockQuery.mockResolvedValueOnce({ rows: [RESTAURANT] });
}

function queueFirstMessageFlow({ clientMessageId, conversationId, chatMessageId, recordId }) {
  // replay check -> none
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // existing conversation lookup -> none (first message)
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // INSERT INTO conversations
  mockQuery.mockResolvedValueOnce({ rows: [{ id: conversationId }] });
  // INSERT INTO messages
  mockQuery.mockResolvedValueOnce({ rows: [{ id: chatMessageId }] });
  // UPDATE conversations last_message_at
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // INSERT INTO food_restaurant_customer_messages
  mockQuery.mockResolvedValueOnce({
    rows: [{
      id: recordId,
      restaurant_id: RESTAURANT.id,
      business_id: RESTAURANT.business_id,
      customer_user_id: USER.id,
      subject: 'Question for Ox Burger Lab',
      message: 'Are you open on Sunday?',
      status: 'open',
      conversation_id: conversationId,
      chat_message_id: chatMessageId,
      client_message_id: clientMessageId,
      created_at: '2026-10-03T12:00:00.000Z',
    }],
  });
  // business_members lookup
  mockQuery.mockResolvedValueOnce({ rows: [{ member_id: MEMBER_ID }] });
}

function queueSecondMessageFlow({ clientMessageId, conversationId, chatMessageId, recordId }) {
  // replay check -> none (fresh idempotency key)
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // existing conversation lookup -> the same thread
  mockQuery.mockResolvedValueOnce({ rows: [{ id: conversationId }] });
  // INSERT INTO messages
  mockQuery.mockResolvedValueOnce({ rows: [{ id: chatMessageId }] });
  // UPDATE conversations last_message_at
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // INSERT INTO food_restaurant_customer_messages
  mockQuery.mockResolvedValueOnce({
    rows: [{
      id: recordId,
      restaurant_id: RESTAURANT.id,
      business_id: RESTAURANT.business_id,
      customer_user_id: USER.id,
      subject: 'Question for Ox Burger Lab',
      message: 'Do you do catering?',
      status: 'open',
      conversation_id: conversationId,
      chat_message_id: chatMessageId,
      client_message_id: clientMessageId,
      created_at: '2026-10-03T12:05:00.000Z',
    }],
  });
  // business_members lookup
  mockQuery.mockResolvedValueOnce({ rows: [{ member_id: MEMBER_ID }] });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  socketService.broadcastToConversation = jest.fn();
  socketService.broadcastToUser = jest.fn();
  ensureBusinessConversation.mockResolvedValue('bizconv-1');
  mirrorMessage.mockResolvedValue('bizmsg-1');
});

describe('restaurant message conversation creation', () => {
  test('creates one thread per customer+restaurant and reuses it for later messages', async () => {
    const app = buildFoodApp();
    const firstKey = '00000000-0000-4000-8000-000000000a01';
    const secondKey = '00000000-0000-4000-8000-000000000a02';

    queueRestaurantLookup();
    queueFirstMessageFlow({ clientMessageId: firstKey, conversationId: 'conv-1', chatMessageId: 'msg-1', recordId: 11 });
    const first = await request(app)
      .post('/api/food/restaurants/3/messages')
      .send({ message: 'Are you open on Sunday?', clientMessageId: firstKey });

    expect(first.status).toBe(201);
    expect(first.body.conversationId).toBe('conv-1');

    // The inserted legacy thread has the customer, the restaurant owner, and
    // the business as participants.
    const convInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO conversations/.test(sql));
    expect(convInsert).toBeDefined();
    expect(convInsert[1]).toEqual([USER.id, OWNER_ID, RESTAURANT.business_id]);

    queueRestaurantLookup();
    queueSecondMessageFlow({ clientMessageId: secondKey, conversationId: 'conv-1', chatMessageId: 'msg-2', recordId: 12 });
    const second = await request(app)
      .post('/api/food/restaurants/3/messages')
      .send({ message: 'Do you do catering?', clientMessageId: secondKey });

    expect(second.status).toBe(201);
    expect(second.body.conversationId).toBe('conv-1');

    // One thread per customer+restaurant: the second message did NOT create
    // another legacy conversation row.
    const convInserts = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO conversations/.test(sql));
    expect(convInserts).toHaveLength(1);

    // Both messages were bridged into the business inbox with the same
    // legacy conversation id.
    expect(ensureBusinessConversation).toHaveBeenCalledTimes(2);
    expect(ensureBusinessConversation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        businessId: RESTAURANT.business_id,
        legacyConversationId: 'conv-1',
        customerId: USER.id,
        customerEmail: USER.email,
      })
    );
    expect(ensureBusinessConversation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        businessId: RESTAURANT.business_id,
        legacyConversationId: 'conv-1',
      })
    );
    expect(mirrorMessage).toHaveBeenCalledTimes(2);
    expect(mirrorMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ businessConversationId: 'bizconv-1', senderId: USER.id, senderType: 'customer' })
    );
  });

  test('requires the message body', async () => {
    const app = buildFoodApp();
    queueRestaurantLookup();
    const res = await request(app)
      .post('/api/food/restaurants/3/messages')
      .send({ message: '   ', clientMessageId: '00000000-0000-4000-8000-000000000a03' });
    expect(res.status).toBe(400);
  });
});

describe('restaurant message rate limiting', () => {
  test('the real route wires authenticate + profileChatLimiter in front of the handler', () => {
    const layer = foodRoutes.stack.find(
      (l) => l.route && l.route.path === '/restaurants/:restaurantId/messages' && l.route.methods.post
    );
    expect(layer).toBeDefined();
    const handles = layer.route.stack.map((s) => s.handle);
    expect(handles).toContain(authenticate);
    expect(handles).toContain(profileChatLimiter);
    // The limiter runs before the controller, never after.
    expect(handles.indexOf(profileChatLimiter)).toBeLessThan(handles.length - 1);
  });

  test('profileChatLimiter allows a burst of 5 messages per minute per user, then 429s', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: req.get('X-Test-User') || 'rl-user' };
      next();
    });
    app.post('/test', profileChatLimiter, (_req, res) => res.sendStatus(204));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post('/test').set('X-Test-User', 'rl-user-a').expect(204);
    }
    const blocked = await request(app).post('/test').set('X-Test-User', 'rl-user-a');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      error: 'Too many messages sent. Please wait a moment before trying again.',
      retryAfter: '1 minute',
    });
    // A different user keeps their own budget.
    await request(app).post('/test').set('X-Test-User', 'rl-user-b').expect(204);
  });
});

describe('offline restaurant behavior', () => {
  test('message is queued in the business inbox when nobody is on the socket', async () => {
    const app = buildFoodApp();
    // Nobody from the restaurant team is connected: broadcasts reach zero
    // sockets but resolve fine, exactly like the real socket service.
    socketService.broadcastToConversation.mockReturnValue(0);
    socketService.broadcastToUser.mockReturnValue(0);

    const key = '00000000-0000-4000-8000-000000000b01';
    queueRestaurantLookup();
    queueFirstMessageFlow({ clientMessageId: key, conversationId: 'conv-1', chatMessageId: 'msg-1', recordId: 11 });

    const res = await request(app)
      .post('/api/food/restaurants/3/messages')
      .send({ message: 'Are you open on Sunday?', clientMessageId: key });
    expect(res.status).toBe(201);

    // The durable rows that power the business inbox were written: the
    // message waits there for the next team member who opens the inbox.
    expect(ensureBusinessConversation).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: RESTAURANT.business_id, legacyConversationId: 'conv-1' })
    );
    expect(mirrorMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessConversationId: 'bizconv-1',
        content: expect.stringContaining('Are you open on Sunday?'),
      })
    );
    const recordInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO food_restaurant_customer_messages/.test(sql));
    expect(recordInsert).toBeDefined();
    expect(res.body.message).toMatchObject({ status: 'open' });

    // Owner + team members are notified through the durable notification
    // queue so they learn about it when they come online.
    const notified = notificationService.sendNotification.mock.calls.map(([payload]) => payload.userId);
    expect(notified).toEqual(expect.arrayContaining([OWNER_ID, MEMBER_ID]));
    expect(notified).not.toContain(USER.id);
  });

  test('no reply-time promises are made to the customer or the restaurant', async () => {
    const app = buildFoodApp();
    const key = '00000000-0000-4000-8000-000000000b02';
    queueRestaurantLookup();
    queueFirstMessageFlow({ clientMessageId: key, conversationId: 'conv-1', chatMessageId: 'msg-1', recordId: 11 });

    const res = await request(app)
      .post('/api/food/restaurants/3/messages')
      .send({ message: 'Are you open on Sunday?', clientMessageId: key });
    expect(res.status).toBe(201);

    const notifyCalls = notificationService.sendNotification.mock.calls;
    expect(notifyCalls.length).toBeGreaterThan(0);
    const bodies = notifyCalls.map(([payload]) => `${payload.title} ${payload.body}`);
    for (const text of bodies) {
      expect(text).not.toMatch(/replies? in|typically|usually|within \d|minutes?|hours?/i);
    }
  });
});

describe('restaurant side visibility and claim/release', () => {
  const BIZ_CONV = {
    id: 'bizconv-1',
    business_id: 7,
    conversation_type: 'customer',
    status: 'active',
    customer_id: USER.id,
    customer_name: 'Test Customer',
    customer_email: USER.email,
    subject: 'Question for Ox Burger Lab',
    legacy_conversation_id: 'conv-1',
    last_message_at: '2026-10-03T12:00:00.000Z',
    created_at: '2026-10-03T12:00:00.000Z',
    message_count: '1',
    unread_count: '1',
    last_message: 'Are you open on Sunday?',
  };

  function buildBusinessApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: MEMBER_ID };
      req.business = { id: 7 };
      req.businessRole = 'owner';
      next();
    });
    return app;
  }

  test('the bridged customer thread appears in the business inbox listing', async () => {
    const app = buildBusinessApp();
    app.get('/api/businesses/:businessId/messages', businessMessagingController.getConversations);
    app.use(errorHandler);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...BIZ_CONV }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/api/businesses/7/messages');
    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
    expect(res.body.conversations[0]).toMatchObject({
      id: 'bizconv-1',
      conversation_type: 'customer',
      customer_email: USER.email,
      legacy_conversation_id: 'conv-1',
    });
  });

  test('claim and release work on the customer conversation type', async () => {
    const app = buildBusinessApp();
    app.post(
      '/api/businesses/:businessId/messages/:conversationId/claim',
      businessConversationAssignmentController.claimConversation
    );
    app.post(
      '/api/businesses/:businessId/messages/:conversationId/release',
      businessConversationAssignmentController.releaseConversation
    );
    app.use(errorHandler);

    // claim: found unclaimed -> assigned to the current team member
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'bizconv-1', business_id: 7, assigned_to_user_id: null, assigned_at: null, status: 'active' }],
      }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // UPDATE assignment
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // audit log
    const claim = await request(app).post('/api/businesses/7/messages/bizconv-1/claim');
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({
      conversation_id: 'bizconv-1',
      assigned_to_user_id: MEMBER_ID,
    });

    // release by the claimer
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'bizconv-1', business_id: 7, assigned_to_user_id: MEMBER_ID, assigned_at: '2026-10-03T12:00:00.000Z', status: 'active' }],
      }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // UPDATE release
      .mockResolvedValueOnce({ rows: [{ id: 2 }] }); // audit log
    const release = await request(app).post('/api/businesses/7/messages/bizconv-1/release');
    expect(release.status).toBe(200);
    expect(release.body).toMatchObject({
      conversation_id: 'bizconv-1',
      assigned_to_user_id: null,
    });

    const releaseUpdate = mockQuery.mock.calls
      .map(([sql, params]) => ({ sql, params }))
      .find(({ sql }) => /UPDATE business_conversations[\s\S]*assigned_to_user_id = NULL/.test(sql));
    expect(releaseUpdate).toBeDefined();
  });
});
