'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');

jest.mock('../services/websocketService', () => ({
  broadcastToAdmins: jest.fn(),
  broadcastToTicket: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

const supportRoutes = require('../routes/support');
const WebSocketService = require('../services/websocketService');
const { logAdminAction } = require('../services/auditService');

const USER_ID = '00000000-0000-4000-8000-000000000888';
const ADMIN_ID = '00000000-0000-4000-8000-000000000889';

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

function adminAuthHeader() {
  const { accessToken } = generateTokens({
    id: ADMIN_ID,
    email: 'admin@example.com',
    role: 'super_admin',
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
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
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

  test('keeps multipart false internal flag as a public support reply', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'conversation-1',
          business_id: null,
          customer_id: USER_ID,
          agent_id: null,
          status: 'in_progress',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', created_at: '2026-09-09T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/conversations/conversation-1/message')
      .set('Authorization', adminAuthHeader())
      .field('message', 'Visible to the customer')
      .field('is_internal', 'false');

    expect(res.status).toBe(200);
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_conversation_messages/.test(sql));
    expect(insertCall[1][2]).toBe('text');
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'conversation-1',
      'message:new',
      expect.objectContaining({ isInternal: false })
    );
  });

  test('lets a customer edit their own recent message', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, status: 'in_progress', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', content: 'Corrected message', message_type: 'text', is_agent: false, edited_at: '2026-09-09T00:01:00.000Z', edit_count: 1, created_at: '2026-09-09T00:00:00.000Z' }] });

    const res = await request(buildApp())
      .put('/api/support/conversations/conversation-1/messages/message-1')
      .set('Authorization', authHeader())
      .send({ content: 'Corrected message' });

    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('Corrected message');
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'conversation-1',
      'message:updated',
      expect.objectContaining({ messageId: 'message-1', content: 'Corrected message' })
    );
  });

  test('lets support staff edit their own recent public reply', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, status: 'in_progress', agent_id: 'agent-1' }] })
      .mockResolvedValueOnce({ rows: [{ user_id: ADMIN_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', sender_id: ADMIN_ID, content: 'Updated reply', message_type: 'text', is_agent: true, edited_at: '2026-09-09T00:01:00.000Z', edit_count: 1, created_at: '2026-09-09T00:00:00.000Z' }] });

    const res = await request(buildApp())
      .put('/api/support/conversations/conversation-1/agent-messages/message-1')
      .set('Authorization', adminAuthHeader())
      .send({ content: 'Updated reply' });

    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('Updated reply');
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'conversation-1',
      'message:updated',
      expect.objectContaining({ messageId: 'message-1', content: 'Updated reply' })
    );
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      adminId: ADMIN_ID,
      action: 'support_message_edited',
      targetType: 'support_conversation_message',
      targetId: 'message-1',
      before: { editCount: 0, isPublic: true },
      after: { editCount: 1, isPublic: true },
    }));
  });

  test('audits support conversation status changes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: null, customer_id: USER_ID, status: 'open', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', status: 'resolved', resolution_status: 'resolved', resolution_summary: 'Issue fixed and next steps provided.' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/support/conversations/conversation-1/status')
      .set('Authorization', adminAuthHeader())
      .send({ status: 'resolved', resolutionSummary: 'Issue fixed and next steps provided.' });

    expect(res.status).toBe(200);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      adminId: ADMIN_ID,
      action: 'support_conversation_status_changed',
      targetType: 'support_conversation',
      targetId: 'conversation-1',
      before: { status: 'open' },
      after: { status: 'resolved', resolutionStatus: 'resolved' },
    }));
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'conversation-1',
      'ticket:status-changed',
      expect.objectContaining({ resolutionSummary: 'Issue fixed and next steps provided.' })
    );
  });

  test('marks customer-visible messages read for the authorized conversation participant', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, status: 'in_progress', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', read_at: '2026-09-09T00:01:00.000Z' }] });

    const res = await request(buildApp())
      .post('/api/support/conversations/conversation-1/mark-all-read')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.markedCount).toBe(1);
    const updateCall = mockQuery.mock.calls.find(([sql]) => /SET read_by_recipient = TRUE/.test(sql));
    expect(updateCall[0]).toContain("COALESCE(message_type, 'text') <> 'internal_note'");
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'conversation-1',
      'messages:read',
      expect.objectContaining({ markedCount: 1 })
    );
  });

  test('blocks reviews until the customer conversation is finished', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, status: 'in_progress', agent_id: null }] });

    const res = await request(buildApp())
      .post('/api/support/conversations/conversation-1/review')
      .set('Authorization', authHeader())
      .send({ rating: 5, comment: 'Helpful' });

    expect(res.status).toBe(409);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_conversation_reviews/.test(sql))).toBe(false);
  });

  test('downloads only customer-visible messages', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, subject: 'Account help', status: 'closed', agent_id: null, created_at: '2026-09-09T00:00:00.000Z', customer_name: 'Mobile User' }] })
      .mockResolvedValueOnce({ rows: [
        { content: 'Public reply', is_agent: true, created_at: '2026-09-09T00:01:00.000Z' },
        { content: 'Private note', is_agent: true, message_type: 'internal_note', created_at: '2026-09-09T00:02:00.000Z' },
      ] });

    const res = await request(buildApp())
      .get('/api/support/conversations/conversation-1/download')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('Public reply');
    expect(res.text).not.toContain('Private note');
  });

  test('allows authorized staff to download a full case record with internal notes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, subject: 'Account help', status: 'closed', agent_id: null, created_at: '2026-09-09T00:00:00.000Z', customer_name: 'Mobile User' }] })
      .mockResolvedValueOnce({ rows: [
        { content: 'Public reply', is_agent: true, message_type: 'text', created_at: '2026-09-09T00:01:00.000Z' },
        { content: 'Private note', is_agent: true, message_type: 'internal_note', created_at: '2026-09-09T00:02:00.000Z' },
      ] });

    const res = await request(buildApp())
      .get('/api/support/conversations/conversation-1/download?include_internal=true')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('case-record');
    expect(res.text).toContain('Private note');
    expect(res.text).toContain('Internal support note');
  });

  test('lets a verified guest download the conversation transcript', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'guest-1', subject: 'Guest request', status: 'closed', guest_name: 'Guest User', created_at: '2026-09-09T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ content: 'Guest-visible message', is_agent: false, created_at: '2026-09-09T00:01:00.000Z' }] });

    const res = await request(buildApp())
      .get('/api/support/public/conversations/guest-1/download')
      .set('Authorization', 'Guest verified-guest-token');

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('oxsteed-support-guest-1.txt');
    expect(res.text).toContain('Guest-visible message');
  });

  test('lets a verified guest review a finished conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'guest-1', guest_email: 'guest@example.com', status: 'resolved' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'review-1', conversation_id: 'guest-1', rating: 5, comment: 'Helpful', created_at: '2026-09-09T00:05:00.000Z', updated_at: '2026-09-09T00:05:00.000Z' }] });

    const res = await request(buildApp())
      .post('/api/support/public/conversations/guest-1/review')
      .set('Authorization', 'Guest verified-guest-token')
      .send({ rating: 5, comment: 'Helpful' });

    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(5);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_conversation_reviews/.test(sql))).toBe(true);
  });

  test('lets a customer reopen a resolved conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, status: 'resolved', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', status: 'open' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/conversations/conversation-1/reopen')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('open');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_queue/.test(sql))).toBe(true);
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'conversation-1',
      'ticket:status-changed',
      expect.objectContaining({ status: 'open' })
    );
  });

  test('lets a verified guest reopen a resolved conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'guest-1', status: 'resolved' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'guest-1', status: 'open' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/public/conversations/guest-1/reopen')
      .set('Authorization', 'Guest verified-guest-token');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('open');
    expect(WebSocketService.broadcastToAdmins).toHaveBeenCalledWith(
      'support:conversation-updated',
      expect.objectContaining({ conversationId: 'guest-1', status: 'open' })
    );
  });

  test('returns real CSAT analytics to platform admins', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ surveys_sent: 4, surveys_completed: 2, avg_rating: 4.5, csat_score: 100 }] })
      .mockResolvedValueOnce({ rows: [{ day: '2026-09-09', responses: 2, avg_rating: 4.5 }] })
      .mockResolvedValueOnce({ rows: [{ agent_name: 'Support', responses: 2, avg_rating: 4.5 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'review-1', rating: 5, comment: 'Helpful' }] });

    const res = await request(buildApp())
      .get('/api/support/csat/analytics')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.metrics).toMatchObject({ surveys_sent: 4, surveys_completed: 2, csat_score: 100, survey_response_rate: 50 });
    expect(res.body.recent_feedback).toHaveLength(1);
  });

  test('does not expose support audit logs to customers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [authUserRow()] });

    const res = await request(buildApp())
      .get('/api/support/audit/logs')
      .set('Authorization', authHeader());

    expect(res.status).toBe(403);
  });

  test('returns bounded support audit logs to platform admins', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'audit-1', action: 'support_reply' }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ total_entries: 1, users_active: 1, actions_today: 1, last_entry: '2026-09-09T00:00:00.000Z' }] });

    const res = await request(buildApp())
      .get('/api/support/audit/logs?limit=10')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.limit).toBe(10);
    expect(res.body.total).toBe(1);
  });

  test('reads durable support admin settings instead of process memory', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ settings: { general: { support_enabled: false } } }] });

    const res = await request(buildApp())
      .get('/api/support/settings?business_id=42')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.general).toMatchObject({ business_id: '42', support_enabled: false });
  });

  test('reads durable knowledge-base articles for support admins', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'article-1', title: 'Billing help', content: 'Steps', keywords: ['billing'], category: 'billing', view_count: 3 }] });

    const res = await request(buildApp())
      .get('/api/support/kb?business_id=42&search=billing')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.articles[0]).toMatchObject({ id: 'article-1', tags: ['billing'], views: 3 });
  });

  test('returns published help articles to authorized support operators', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'article-2', title: 'Refund timing', content: 'Refunds take 5 days.', is_published: true }] });

    const res = await request(buildApp())
      .get('/api/support/kb/available?business_id=42&search=refund')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.articles[0]).toMatchObject({ id: 'article-2', title: 'Refund timing' });
    expect(mockQuery.mock.calls.some(([sql]) => /is_published = true/.test(sql))).toBe(true);
  });

  test('blocks legacy knowledge-base reads for users without business access', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .get('/api/support/42/kb/categories')
      .set('Authorization', authHeader());

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM knowledge_base_categories/.test(sql))).toBe(false);
  });

  test('allows platform admins to read a knowledge-base article in its own business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'article-1', business_id: 42, title: 'Billing help', content: 'Steps', is_published: true }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .get('/api/support/42/kb/articles/article-1')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'article-1', business_id: 42, title: 'Billing help' });
    expect(mockQuery.mock.calls.some(([sql]) => /SET view_count = view_count \+ 1/.test(sql) && /business_id = \$2/.test(sql))).toBe(true);
  });

  test('keeps knowledge-base article updates scoped to the requested business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'article-1', business_id: 42, title: 'Billing help', content: 'Steps', excerpt: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'article-1', business_id: 42, title: 'Updated billing help', content: 'Updated steps', excerpt: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/support/42/kb/articles/article-1')
      .set('Authorization', adminAuthHeader())
      .send({ title: 'Updated billing help', content: 'Updated steps' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated billing help');
    expect(mockQuery.mock.calls.some(([sql]) => /WHERE id = \$5 AND business_id = \$6/.test(sql))).toBe(true);
  });

  test('returns only active saved replies to authorized support operators', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [
        { id: 'reply-1', title: 'Billing update', content: 'I am checking your billing request now.', is_active: true },
      ] });

    const res = await request(buildApp())
      .get('/api/support/templates/available?business_id=42&search=billing')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
    expect(mockQuery.mock.calls.some(([sql]) => /is_active = true/.test(sql))).toBe(true);
  });

  test('blocks legacy saved-reply reads for users without business access', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .get('/api/support/42/responses')
      .set('Authorization', authHeader());

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /SELECT \* FROM canned_responses/.test(sql))).toBe(false);
  });

  test('keeps legacy saved-reply mutations scoped to the requested business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/support/42/responses/response-1')
      .set('Authorization', authHeader())
      .send({ title: 'Cross-business update' });

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /SELECT business_id FROM canned_responses/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE canned_responses/.test(sql))).toBe(false);
  });

  test('rejects a legacy saved reply whose row belongs to another business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ business_id: 99 }] });

    const res = await request(buildApp())
      .delete('/api/support/42/responses/response-1')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE canned_responses/.test(sql))).toBe(false);
  });

  test('allows platform admins to update a legacy saved reply in its own business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ business_id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'response-1', business_id: 42, title: 'Updated', content: 'Updated content' }] });

    const res = await request(buildApp())
      .put('/api/support/42/responses/response-1')
      .set('Authorization', adminAuthHeader())
      .send({ title: 'Updated', content: 'Updated content' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'response-1', business_id: 42, title: 'Updated' });
    expect(mockQuery.mock.calls.some(([sql]) => /WHERE id = \$3 AND business_id = \$4/.test(sql))).toBe(true);
  });

  test('rejects oversized legacy saved-reply content before insert', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] });

    const res = await request(buildApp())
      .post('/api/support/42/responses')
      .set('Authorization', adminAuthHeader())
      .send({ title: 'Too large', content: 'x'.repeat(10001), shortcut: '/large' });

    expect(res.status).toBe(400);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO canned_responses/.test(sql))).toBe(false);
  });

  test('blocks legacy message reads for users without business conversation access', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .get('/api/support/42/conversations/conversation-1/messages')
      .set('Authorization', authHeader());

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM support_conversation_messages scm/.test(sql))).toBe(false);
  });

  test('allows platform admins to read legacy messages only from the requested business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', conversation_id: 'conversation-1', content: 'Visible reply' }] });

    const res = await request(buildApp())
      .get('/api/support/42/conversations/conversation-1/messages?limit=500&offset=-2')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: 'message-1', content: 'Visible reply' });
    const messageQuery = mockQuery.mock.calls.find(([sql]) => /FROM support_conversation_messages scm/.test(sql));
    expect(messageQuery[1].slice(-2)).toEqual([100, 0]);
  });

  test('rejects insecure legacy attachment URLs before storing them', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] });

    const res = await request(buildApp())
      .post('/api/support/42/conversations/conversation-1/attachment')
      .set('Authorization', adminAuthHeader())
      .send({ attachmentUrl: 'javascript:alert(1)', attachmentName: 'bad.txt' });

    expect(res.status).toBe(400);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_conversation_messages/.test(sql))).toBe(false);
  });

  test('blocks legacy message edits when the caller lacks business access', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/support/42/messages/message-1')
      .set('Authorization', authHeader())
      .send({ content: 'Unauthorized edit' });

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_conversation_messages/.test(sql))).toBe(false);
  });

  test('keeps legacy read receipts scoped to the requested business conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', conversation_id: 'conversation-1', business_id: 42, sender_id: 'customer-1', read_by_recipient: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', conversation_id: 'conversation-1', read_by_recipient: true, status: 'read' }] });

    const res = await request(buildApp())
      .put('/api/support/42/messages/message-1/read')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => /sc\.business_id = \$2/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /WHERE id = \$1 AND conversation_id = \$2/.test(sql))).toBe(true);
  });

  test('blocks legacy agent skill changes for users without employer access', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1', employer_id: 'employer-1', user_id: 'other-user', business_id: 42 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/42/agents/agent-1/skills')
      .set('Authorization', authHeader())
      .send({ skillName: 'billing' });

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO agent_skills/.test(sql))).toBe(false);
  });

  test('limits legacy agent availability history to the authorized business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1', employer_id: 'employer-1', user_id: 'other-user', business_id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'availability-1', status: 'available' }] });

    const res = await request(buildApp())
      .get('/api/support/42/agents/agent-1/availability-log?limit=500')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    const logQuery = mockQuery.mock.calls.find(([sql]) => /FROM agent_availability_log/.test(sql));
    expect(logQuery[1][1]).toBe(100);
  });

  test('reads durable escalation rules and real daily escalation counts', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rule-1', business_id: 42, rule_name: 'Urgent wait', condition: { priority: 'critical', trigger_condition: 'Wait over target' }, action: { escalate_to: 'manager', escalate_after_minutes: 15 }, is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ escalations_today: 2 }] });

    const res = await request(buildApp())
      .get('/api/support/escalation/rules?business_id=42')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.rules[0]).toMatchObject({ rule_name: 'Urgent wait', priority: 'critical', escalate_to: 'manager' });
    expect(res.body.stats.escalations_today).toBe(2);
  });
});
