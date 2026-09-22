'use strict';

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

const disputeController = require('../controllers/disputeController');
const foodController = require('../controllers/foodController');

function buildDisputeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000123',
      role: 'customer',
    };
    next();
  });
  app.post('/api/disputes/:disputeId/messages', disputeController.sendDisputeMessage);
  app.use(errorHandler);
  return app;
}

function buildFoodApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000123',
      first_name: 'Test',
      last_name: 'Customer',
      email: 'customer@example.com',
    };
    next();
  });
  app.post('/api/food/restaurants/:restaurantId/messages', foodController.createRestaurantCustomerMessage);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('communication edge idempotency', () => {
  test('replays a dispute message without inserting a second row', async () => {
    const clientMessageId = '00000000-0000-4000-8000-000000000321';
    const dispute = { id: 7, opened_by: '00000000-0000-4000-8000-000000000123' };
    const inserted = {
      id: '00000000-0000-4000-8000-000000000654',
      dispute_id: 7,
      sender_id: dispute.opened_by,
      sender_role: 'client',
      message: 'The provider has not returned to finish the work.',
      is_admin_only: false,
      client_message_id: clientMessageId,
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [dispute] })
      .mockResolvedValueOnce({ rows: [inserted] })
      .mockResolvedValueOnce({ rows: [dispute] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [inserted] });

    const app = buildDisputeApp();
    const first = await request(app)
      .post('/api/disputes/7/messages')
      .send({ message: inserted.message, clientMessageId });
    const second = await request(app)
      .post('/api/disputes/7/messages')
      .send({ message: inserted.message, clientMessageId });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.disputeMessage).toEqual(inserted);
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO dispute_messages/.test(sql))).toHaveLength(2);
    expect(mockQuery.mock.calls[1][0]).toContain('sender_role');
    expect(mockQuery.mock.calls[1][0]).toContain('client_message_id');
  });

  test('replays restaurant contact without duplicating the legacy or shared message', async () => {
    const clientMessageId = '00000000-0000-4000-8000-000000000322';
    const restaurant = {
      id: 3,
      business_id: null,
      owner_user_id: null,
      display_name: 'Ox Burger Lab',
      status: 'active',
    };
    const record = {
      id: 11,
      restaurant_id: 3,
      business_id: null,
      customer_user_id: '00000000-0000-4000-8000-000000000123',
      subject: 'Question for Ox Burger Lab',
      message: 'Are you open on Sunday?',
      status: 'open',
      conversation_id: null,
      chat_message_id: null,
      client_message_id: clientMessageId,
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [restaurant] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [record] })
      .mockResolvedValueOnce({ rows: [restaurant] })
      .mockResolvedValueOnce({ rows: [record] });

    const app = buildFoodApp();
    const first = await request(app)
      .post('/api/food/restaurants/3/messages')
      .send({ message: record.message, clientMessageId });
    const second = await request(app)
      .post('/api/food/restaurants/3/messages')
      .send({ message: record.message, clientMessageId });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.message).toEqual(record);
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO food_restaurant_customer_messages/.test(sql))).toHaveLength(1);
  });
});
