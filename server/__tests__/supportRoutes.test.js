'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');
const supportRoutes = require('../routes/support');

const USER_ID = '00000000-0000-4000-8000-000000000888';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support', supportRoutes);
  app.use(errorHandler);
  return app;
}

function authHeader() {
  const { accessToken } = generateTokens({
    id: USER_ID,
    email: 'mobile@example.com',
    role: 'customer',
  });
  return `Bearer ${accessToken}`;
}

function authUserRow() {
  return {
    id: USER_ID,
    first_name: 'Mobile',
    last_name: 'User',
    email: 'mobile@example.com',
    phone: '+19375550100',
    role: 'customer',
    email_verified: true,
    is_verified: false,
    onboarding_status: 'onboarding_complete',
    onboarding_completed: true,
    contact_completed: true,
    profile_completed: true,
    tier_selected: false,
    w9_completed: false,
    terms_accepted: true,
    membership_tier: 'free',
    id_verified: false,
    background_check_passed: false,
    address_line1: '10 Main St',
    city: 'Columbus',
    state: 'OH',
    zip_code: '43215',
    country: 'US',
    preferred_language: 'en',
    display_name_preference: 'first_name',
    is_active: true,
    didit_status: 'skipped',
    didit_verified_at: null,
    didit_enforcement_required: false,
    trial_started_at: null,
    trial_ends_at: null,
    default_mode: 'customer',
    logistics_role: null,
    business_name: null,
    is_listed: false,
    allow_guest_contact: true,
    allow_booking: true,
    allow_scheduling: true,
    allow_live_chat: true,
  };
}

beforeEach(() => resetMocks());

describe('support routes', () => {
  test('creates a public support ticket for guest or mobile support requests', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-1',
          ticket_number: 'SUP-101',
          subject: 'Inventory sync issue',
          name: 'Guest User',
          priority: 'normal',
          created_at: '2026-06-24T00:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/request')
      .send({
        name: 'Guest User',
        email: 'guest@example.com',
        subject: 'Inventory sync issue',
        message: 'Inventory did not sync after retrying.',
        category: 'technical',
        sender_language: 'en',
      });

    expect(res.status).toBe(201);
    expect(res.body.ticket_id).toBe('ticket-1');
    expect(res.body.ticket_number).toBe('SUP-101');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_tickets/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_messages/.test(sql))).toBe(true);
  });

  test('lists the signed-in user support tickets', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-1',
          ticket_number: 'SUP-101',
          subject: 'Inventory sync issue',
          category: 'technical',
          priority: 'normal',
          status: 'open',
          message_count: '1',
        }],
      });

    const res = await request(buildApp())
      .get('/api/support/my-tickets')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.tickets[0].ticket_number).toBe('SUP-101');
  });
});
