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
const reportingController = require('../controllers/reportingController');
const reviewModerationController = require('../controllers/reviewModerationController');
const socketService = require('../services/socketService');
socketService.broadcastGuestChatMessage = jest.fn();
const messageController = require('../controllers/messageController');
const messageRoutes = require('../routes/messages');

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

function buildGuestInquiryReplyApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000123',
      first_name: 'Test',
      email: 'helper@example.com',
    };
    next();
  });
  app.post('/api/messages/guest-inquiries/:id/messages', messageController.replyGuestInquiryMessage);
  app.use(errorHandler);
  return app;
}

function buildUserReportApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000123',
      role: 'customer',
    };
    next();
  });
  app.post('/api/reports', reportingController.submitReport);
  app.use(errorHandler);
  return app;
}

function buildReviewReportApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000123',
      role: 'customer',
    };
    next();
  });
  app.post('/api/reviews/:reviewId/report', reviewModerationController.reportReview);
  app.use(errorHandler);
  return app;
}

function buildContentReportApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000123',
      role: 'customer',
    };
    next();
  });
  app.post('/api/messages/report', messageRoutes.submitContentReport);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  socketService.broadcastToUser = jest.fn();
});

describe('communication edge idempotency', () => {
  test('replays a user abuse report without creating another report', async () => {
    const clientRequestId = '00000000-0000-4000-8000-000000000324';
    const report = {
      id: 71,
      reporter_id: '00000000-0000-4000-8000-000000000123',
      reported_user_id: '00000000-0000-4000-8000-000000000124',
      reason: 'harassment',
      status: 'submitted',
      created_at: '2026-09-22T12:00:00.000Z',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: report.reported_user_id }] })
      .mockResolvedValueOnce({ rows: [report] })
      .mockResolvedValueOnce({ rows: [{ id: report.reported_user_id }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [report] });

    const app = buildUserReportApp();
    const body = {
      reportedUserId: report.reported_user_id,
      reason: report.reason,
      description: 'Repeated abusive messages were sent during the conversation.',
    };
    const first = await request(app).post('/api/reports').set('Idempotency-Key', clientRequestId).send(body);
    const second = await request(app).post('/api/reports').set('Idempotency-Key', clientRequestId).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(expect.objectContaining({ idempotent: true }));
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO job_user_reports/.test(sql))).toHaveLength(2);
  });

  test('replays a review report without incrementing moderation counters twice', async () => {
    const clientRequestId = '00000000-0000-4000-8000-000000000325';
    const report = {
      id: 72,
      review_id: '00000000-0000-4000-8000-000000000125',
      reported_by: '00000000-0000-4000-8000-000000000123',
      reason: 'spam',
      description: 'This review is unrelated promotional content.',
      status: 'open',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: report.review_id, helper_id: '00000000-0000-4000-8000-000000000126' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [report] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: report.review_id, helper_id: '00000000-0000-4000-8000-000000000126' }] })
      .mockResolvedValueOnce({ rows: [report] });

    const app = buildReviewReportApp();
    const body = { reason: report.reason, description: report.description };
    const first = await request(app)
      .post(`/api/reviews/${report.review_id}/report`)
      .set('Idempotency-Key', clientRequestId)
      .send(body);
    const second = await request(app)
      .post(`/api/reviews/${report.review_id}/report`)
      .set('Idempotency-Key', clientRequestId)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(expect.objectContaining({ idempotent: true }));
    expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE product_reviews SET report_count/.test(sql))).toHaveLength(1);
  });

  test('replays a content report without creating another moderation record', async () => {
    const clientRequestId = '00000000-0000-4000-8000-000000000326';
    const report = { id: 'content-report-1' };
    mockQuery
      .mockResolvedValueOnce({ rows: [report] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [report] });

    const app = buildContentReportApp();
    const body = {
      reportedUserId: '00000000-0000-4000-8000-000000000124',
      contentType: 'profile',
      reason: 'harassment',
      description: 'This profile is targeting other users.',
    };
    const first = await request(app).post('/api/messages/report').set('Idempotency-Key', clientRequestId).send(body);
    const second = await request(app).post('/api/messages/report').set('Idempotency-Key', clientRequestId).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(expect.objectContaining({ reportId: report.id, idempotent: true }));
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO content_reports/.test(sql))).toHaveLength(2);
  });

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

  test('replays a helper reply to a guest inquiry without updating or broadcasting twice', async () => {
    const clientMessageId = '00000000-0000-4000-8000-000000000323';
    const inserted = {
      id: 19,
      session_id: 'guest-session-1',
      sender_type: 'helper',
      sender_name: 'Test',
      message: 'I can help with that.',
      created_at: '2026-09-22T12:00:00.000Z',
    };
    const session = { helper_id: '00000000-0000-4000-8000-000000000123' };

    mockQuery
      .mockResolvedValueOnce({ rows: [session] })
      .mockResolvedValueOnce({ rows: [inserted] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [session] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [inserted] });

    const app = buildGuestInquiryReplyApp();
    const body = { message: inserted.message, clientMessageId };
    const first = await request(app).post('/api/messages/guest-inquiries/guest-session-1/messages').send(body);
    const second = await request(app).post('/api/messages/guest-inquiries/guest-session-1/messages').send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(expect.objectContaining({ id: inserted.id, idempotent: true }));
    expect(socketService.broadcastGuestChatMessage).toHaveBeenCalledTimes(1);
    expect(socketService.broadcastToUser).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE guest_profile_chat_inbound/.test(sql))).toHaveLength(1);
  });
});
