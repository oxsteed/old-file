'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/restaurantSupportController');

function buildCustomerApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000123',
      email: 'customer@example.com',
      preferred_language: 'en',
    };
    next();
  });
  app.post('/api/restaurants/support/cases', ctrl.createCase);
  app.use(errorHandler);
  return app;
}

function buildRestaurantApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000999',
      email: 'owner@example.com',
      role: 'customer',
    };
    next();
  });
  app.post('/api/restaurants/:restaurantId/support/cases/:caseId/respond', ctrl.restaurantRespond);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('restaurant support case backend', () => {
  test('creates and routes a missing-item case to the restaurant with audit and notification records', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 77,
          restaurant_id: 5,
          customer_id: '00000000-0000-4000-8000-000000000123',
          status: 'completed',
          fulfillment_type: 'pickup',
          payment_status: 'paid',
          total_cents: 2400,
          currency_code: 'USD',
          queue_number: 12,
          created_at: '2026-06-20T20:00:00.000Z',
          address_country: 'US',
          restaurant_currency_code: 'USD',
          restaurant_name: 'Jean Caribbean Kitchen',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          display_name: 'Jean Caribbean Kitchen',
          address_country: 'US',
          currency_code: 'USD',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 501, item_name: 'Griot', quantity: 1, line_total_cents: 1800 }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 9001,
          public_case_number: 'RS-TEST-1',
          order_id: 77,
          restaurant_id: 5,
          customer_user_id: '00000000-0000-4000-8000-000000000123',
          issue_type: 'missing_item',
          status: 'awaiting_restaurant',
          owner_type: 'restaurant',
          due_at: '2026-06-20T20:30:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // customer message
      .mockResolvedValueOnce({ rows: [] }) // message_added event
      .mockResolvedValueOnce({ rows: [] }) // case_created event
      .mockResolvedValueOnce({ rows: [] }) // assignment
      .mockResolvedValueOnce({ rows: [] }) // customer notification
      .mockResolvedValueOnce({ rows: [] }); // restaurant notification

    const res = await request(buildCustomerApp())
      .post('/api/restaurants/support/cases')
      .send({
        orderId: 77,
        issueType: 'missing_item',
        description: 'My order was missing the griot plate.',
        requestedResolution: 'replacement_item',
      });

    expect(res.status).toBe(201);
    expect(res.body.case.owner_type).toBe('restaurant');
    expect(res.body.case.status).toBe('awaiting_restaurant');
    expect(mockQuery.mock.calls[3][0]).toMatch(/INSERT INTO restaurant_support_cases/);
    expect(mockQuery.mock.calls[3][1]).toContain('missing_item');
    expect(mockQuery.mock.calls.some(([sql]) => /restaurant_support_case_events/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /restaurant_support_notification_events/.test(sql))).toBe(true);
  });

  test('lets restaurant owner respond and moves the case back to the customer', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 9001,
          restaurant_id: 5,
          business_id: 42,
          customer_user_id: '00000000-0000-4000-8000-000000000123',
          owner_type: 'restaurant',
          status: 'awaiting_restaurant',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          business_id: 42,
          effective_role: 'owner',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 2, message: 'We can remake that item now.' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 9001,
          status: 'awaiting_customer',
          first_response_at: '2026-06-20T20:05:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildRestaurantApp())
      .post('/api/restaurants/5/support/cases/9001/respond')
      .send({ message: 'We can remake that item now.' });

    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe('awaiting_customer');
    expect(mockQuery.mock.calls[2][0]).toMatch(/INSERT INTO restaurant_support_case_messages/);
    expect(mockQuery.mock.calls[4][0]).toMatch(/first_response_at = COALESCE/);
  });
});
