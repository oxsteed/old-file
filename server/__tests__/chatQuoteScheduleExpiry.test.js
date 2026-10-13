'use strict';

/**
 * chatQuoteScheduleExpiry.test.js
 *
 * Review P2-10-F04: scheduleFromQuote must refuse expired quotes (409
 * quote_expired), and the chatQuoteExpiry sweeper must flip accepted/approved
 * quotes past valid_until to 'expired'.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

// Real isQuoteExpired/toChatStatus: the expiry decision under test.
jest.mock('../services/chatQuotes', () => {
  const actual = jest.requireActual('../services/chatQuotes');
  return { ...actual };
});
jest.mock('../services/chatAgreements', () => ({
  checkScheduleAgreementGate: jest.fn().mockResolvedValue({ blocked: false, agreements: [] }),
}));
jest.mock('../controllers/chatBookingRequestsController', () => ({
  buildBookingRequestMarker: jest.fn(({ id, status }) => `[booking:${id}|${status}]`),
}));
jest.mock('../services/businessConversationSync', () => ({
  mirrorLegacyMessage: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/bookingRequestLifecycle', () => ({
  validateBookingSlot: jest.fn().mockResolvedValue({ ok: true }),
}));

const controller = require('../controllers/chatQuotesController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1', first_name: 'Customer', last_name: 'One' };
    next();
  });
  app.post('/api/chat/quotes/:kind/:id/schedule', controller.scheduleFromQuote);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));
  return app;
}

function quoteFixture(overrides = {}) {
  return {
    id: 'quote-1',
    status: 'accepted',
    valid_until: null,
    title: 'Ceiling fan installation',
    business_id: 'business-1',
    conversation_id: 'conversation-1',
    guest_session_id: null,
    booking_request_id: null,
    appointment_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('scheduleFromQuote quote expiry', () => {
  test('rejects an accepted quote past valid_until with 409 quote_expired', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM helper_quotes')) return { rows: [quoteFixture({ valid_until: yesterday })] };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildApp())
      .post('/api/chat/quotes/helper/quote-1/schedule')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('quote_expired');
  });

  test('rejects an approved business quote past a DATE valid_until', async () => {
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM business_quotes')) {
        return { rows: [quoteFixture({ status: 'approved', valid_until: yesterday })] };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildApp())
      .post('/api/chat/quotes/business/quote-1/schedule')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('quote_expired');
  });

  test('a quote within valid_until passes the expiry gate', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM helper_quotes')) return { rows: [quoteFixture({ valid_until: tomorrow })] };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildApp())
      .post('/api/chat/quotes/helper/quote-1/schedule')
      .send({});

    // Fails later (no conversation participant in the mock DB -> 403), but
    // crucially NOT at the expiry gate.
    expect(res.body.code).not.toBe('quote_expired');
  });

  test('a quote with no valid_until passes the expiry gate', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM helper_quotes')) return { rows: [quoteFixture()] };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildApp())
      .post('/api/chat/quotes/helper/quote-1/schedule')
      .send({});

    expect(res.body.code).not.toBe('quote_expired');
  });
});

describe('chatQuoteExpiry sweeper', () => {
  test('sweepChatQuoteExpiry flips past-due accepted/approved quotes to expired', async () => {
    jest.resetModules();
    const dbQuery = jest.fn()
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rowCount: 3 });
    jest.doMock('../db', () => ({ query: dbQuery }));
    const { sweepChatQuoteExpiry } = require('../jobs/chatQuoteExpiryJob');

    const result = await sweepChatQuoteExpiry({ query: dbQuery });

    expect(result).toEqual({ business: 2, helper: 3 });
    const [businessSql] = dbQuery.mock.calls[0];
    expect(businessSql).toContain("status = 'approved'");
    expect(businessSql).toContain("SET status = 'expired'");
    expect(businessSql).toContain('valid_until < CURRENT_DATE');
    const [helperSql] = dbQuery.mock.calls[1];
    expect(helperSql).toContain("status = 'accepted'");
    expect(helperSql).toContain('valid_until::date < CURRENT_DATE');
  });
});
