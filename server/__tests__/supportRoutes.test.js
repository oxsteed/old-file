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
const email = require('../utils/email');

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

function supportAgentAuthHeader() {
  const { accessToken } = generateTokens({
    id: USER_ID,
    email: 'agent@example.com',
    role: 'support_agent',
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
  test('returns provider readiness metadata to platform support staff without exposing credentials', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] });

    const res = await request(buildApp())
      .get('/api/support/channel-capabilities')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      email: expect.objectContaining({ supported: true, provider: 'resend' }),
      sms: expect.objectContaining({ supported: true, provider: 'twilio' }),
      phone: expect.objectContaining({ supported: false, configured: false }),
      social: expect.objectContaining({ supported: false, configured: false }),
    }));
    expect(JSON.stringify(res.body)).not.toMatch(/OPENAI|OPENROUTER|re_[A-Za-z0-9]{10,}|AC[a-f0-9]{20,}/i);
  });

  test('does not expose channel readiness to an unrelated customer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), role: 'customer' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .get('/api/support/channel-capabilities')
      .set('Authorization', authHeader());

    expect(res.status).toBe(403);
  });

  test('paginates and searches the platform conversation queue', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-older' }] });

    const res = await request(buildApp())
      .get('/api/support/conversations?search=refund&limit=25&offset=50')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
    const listCall = mockQuery.mock.calls.find(([sql]) => /FROM support_conversations sc/.test(sql));
    expect(listCall[0]).toContain('EXISTS');
    expect(listCall[0]).toContain('ILIKE');
    expect(listCall[0]).toMatch(/GROUP BY sc\.id, cu\.id, au\.id, sa\.id/);
    expect(listCall[0]).toContain('LIMIT $2 OFFSET $3');
    expect(listCall[1]).toEqual(['%refund%', 25, 50]);
    expect(res.body.pagination).toEqual({ limit: 25, offset: 50, returned: 1, hasMore: false });
  });

  test('filters the platform conversation queue by support channel', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'email-conversation' }] });

    const res = await request(buildApp())
      .get('/api/support/conversations?channel=email&limit=10')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    const listCall = mockQuery.mock.calls.find(([sql]) => /FROM support_conversations sc/.test(sql));
    expect(listCall[0]).toContain('sc.channel = $1');
    expect(listCall[1]).toEqual(['email', 10, 0]);
  });

  test('rejects an invalid platform conversation channel filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] });

    const res = await request(buildApp())
      .get('/api/support/conversations?channel=carrier-pigeon')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

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

  test('replays a committed legacy support request without creating a second ticket', async () => {
    const clientRequestId = '22222222-2222-4222-8222-222222222222';
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', ticket_number: 1001 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/request')
      .set('Idempotency-Key', clientRequestId)
      .send({
        name: 'Guest User',
        email: 'guest@example.com',
        subject: 'Inventory sync issue',
        message: 'Inventory did not sync after retrying.',
      });

    expect(res.status).toBe(200);
    expect(res.body.ticket_id).toBe('ticket-1');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_messages/.test(sql))).toBe(false);
  });

  test('replays an authenticated ticket reply without changing ticket state twice', async () => {
    const clientMessageId = '33333333-3333-4333-8333-333333333333';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow() }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', status: 'waiting_user', assigned_to: null, ticket_number: 1001, subject: 'Help', name: 'Mobile', email: 'mobile@example.com' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', ticket_id: 'ticket-1', content: 'Following up', client_message_id: clientMessageId }] });

    const res = await request(buildApp())
      .post('/api/support/my-tickets/ticket-1/reply')
      .set('Authorization', authHeader())
      .send({ content: 'Following up', clientMessageId });

    expect(res.status).toBe(200);
    expect(res.body.message.id).toBe('message-1');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_tickets/.test(sql))).toBe(false);
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

  test('lets support staff redact a message without deleting its audit identity', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, status: 'in_progress', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'message-1',
        sender_id: USER_ID,
        content: '[Message redacted by support staff]',
        attachment_url: null,
        attachment_name: null,
        message_type: 'text',
        is_agent: false,
        redacted_at: '2026-09-09T00:01:00.000Z',
        created_at: '2026-09-09T00:00:00.000Z',
      }] });

    const res = await request(buildApp())
      .post('/api/support/conversations/conversation-1/messages/message-1/redact')
      .set('Authorization', adminAuthHeader())
      .send({ reason: 'Customer requested removal of sensitive details' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'message-1', content: '[Message redacted by support staff]', attachment_url: null });
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'conversation-1',
      'message:updated',
      expect.objectContaining({ messageId: 'message-1', redacted: true, attachmentUrl: null })
    );
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      adminId: ADMIN_ID,
      action: 'support_message_redacted',
      targetId: 'message-1',
      after: { redacted: true, reasonProvided: true, isPublic: true },
    }));
    const updateCall = mockQuery.mock.calls.find(([sql]) => /redacted_at = COALESCE/.test(sql));
    expect(updateCall?.[1]).toEqual(['message-1', 'conversation-1', ADMIN_ID, 'Customer requested removal of sensitive details']);
  });

  test('audits support conversation status changes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: null, customer_id: USER_ID, status: 'open', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', status: 'resolved', resolution_status: 'resolved', resolution_reason_code: 'other', resolution_summary: 'Issue fixed and next steps provided.' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/support/conversations/conversation-1/status')
      .set('Authorization', adminAuthHeader())
      .send({ status: 'resolved', resolutionSummary: 'Issue fixed and next steps provided.' });

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(5);
    expect(mockQuery.mock.calls[2][0]).toMatch(/UPDATE support_conversations/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/AND status = \$\d+ RETURNING \*/);
    expect(mockQuery.mock.calls[3][0]).toMatch(/UPDATE support_queue/);
    expect(mockQuery.mock.calls[4][0]).toMatch(/UPDATE conversation_assignments/);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      adminId: ADMIN_ID,
      action: 'support_conversation_status_changed',
      targetType: 'support_conversation',
      targetId: 'conversation-1',
      before: { status: 'open' },
      after: { status: 'resolved', resolutionStatus: 'resolved', resolutionReasonCode: 'other' },
    }));
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'conversation-1',
      'ticket:status-changed',
      expect.objectContaining({ resolutionSummary: 'Issue fixed and next steps provided.' })
    );
  });

  test('supports explicit pending and reopened lifecycle states', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: null, customer_id: USER_ID, status: 'in_progress', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/support/conversations/conversation-1/status')
      .set('Authorization', adminAuthHeader())
      .send({ status: 'pending' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_queue/.test(sql))).toBe(true);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'support_conversation_status_changed',
      before: { status: 'in_progress' },
      after: expect.objectContaining({ status: 'pending' }),
    }));
  });

  test('rejects unsafe lifecycle jumps from terminal states', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: null, customer_id: USER_ID, status: 'closed', agent_id: null }] });

    const res = await request(buildApp())
      .put('/api/support/conversations/conversation-1/status')
      .set('Authorization', adminAuthHeader())
      .send({ status: 'open' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("'closed' to 'open'");
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_conversations/.test(sql))).toBe(false);
  });

  test('notifies the customer once when a conversation is resolved', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'conversation-1',
        business_id: null,
        customer_id: USER_ID,
        customer_email: 'customer@example.com',
        customer_name: 'Casey Customer',
        customer_email_notifications: true,
        status: 'in_progress',
        agent_id: null,
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'conversation-1',
        status: 'resolved',
        resolution_status: 'resolved',
        resolution_summary: 'The account issue was corrected.',
        resolved_at: '2026-09-10T12:00:00.000Z',
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/support/conversations/conversation-1/status')
      .set('Authorization', adminAuthHeader())
      .send({ status: 'resolved', resolutionSummary: 'The account issue was corrected.' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.status).toBe(200);
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'customer@example.com',
      subject: 'OxSteed Support: Support conversation resolved',
      idempotencyKey: expect.stringMatching(/^support-status-conversation-1-resolved-\d+$/),
    }));
  });

  test('rejects unsupported support resolution reason codes', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] });

    const res = await request(buildApp())
      .put('/api/support/conversations/conversation-1/status')
      .set('Authorization', adminAuthHeader())
      .send({ status: 'resolved', resolutionReasonCode: 'made_up_reason' });

    expect(res.status).toBe(400);
    expect(res.body.fields.resolutionReasonCode).toBe('Invalid resolution reason code');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_conversations/.test(sql))).toBe(false);
  });

  test('rejects oversized status metadata before loading the conversation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] });

    const res = await request(buildApp())
      .put('/api/support/conversations/conversation-1/status')
      .set('Authorization', adminAuthHeader())
      .send({ status: 'resolved', internalNotes: 'x'.repeat(5001) });

    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_conversations/.test(sql))).toBe(false);
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
      .mockResolvedValueOnce({ rows: [{ id: 'review-1', conversation_id: 'guest-1', rating: 5, nps_score: 9, comment: 'Helpful', created_at: '2026-09-09T00:05:00.000Z', updated_at: '2026-09-09T00:05:00.000Z' }] });

    const res = await request(buildApp())
      .post('/api/support/public/conversations/guest-1/review')
      .set('Authorization', 'Guest verified-guest-token')
      .send({ rating: 5, npsScore: 9, comment: 'Helpful' });

    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.nps_score).toBe(9);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_conversation_reviews/.test(sql))).toBe(true);
  });

  test('lets a customer reopen a resolved conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, status: 'resolved', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', status: 'reopened' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/conversations/conversation-1/reopen')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('reopened');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_queue/.test(sql))).toBe(true);
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'conversation-1',
      'ticket:status-changed',
      expect.objectContaining({ status: 'reopened' })
    );
  });

  test('lets a verified guest reopen a resolved conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'guest-1', status: 'resolved' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'guest-1', status: 'reopened' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/public/conversations/guest-1/reopen')
      .set('Authorization', 'Guest verified-guest-token');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('reopened');
    expect(WebSocketService.broadcastToAdmins).toHaveBeenCalledWith(
      'support:conversation-updated',
      expect.objectContaining({ conversationId: 'guest-1', status: 'reopened' })
    );
  });

  test('lets authorized staff retry failed customer notifications', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'outbox-1' }, { id: 'outbox-2' }] });

    const res = await request(buildApp())
      .post('/api/support/conversations/conversation-1/email/retry-failed')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ queued: 2 });
    expect(mockQuery.mock.calls[2][0]).toMatch(/UPDATE support_email_outbox/);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      adminId: ADMIN_ID,
      action: 'support_email_delivery_retried',
      targetType: 'support_conversation',
      targetId: 'conversation-1',
      after: { queued: 2 },
    }));
  });

  test('does not let customers retry staff notification delivery', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, agent_id: null }] });

    const res = await request(buildApp())
      .post('/api/support/conversations/conversation-1/email/retry-failed')
      .set('Authorization', authHeader());

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('returns a staff-only customer 360 context across support and commerce sources', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, customer_email: 'customer@example.com', business_id: 42, agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, email: 'customer@example.com', first_name: 'Casey', last_name: 'Customer', preferred_language: 'en' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', subject: 'Current request', status: 'open', channel: 'web_chat', agent_id: 'agent-1', agent_name: 'Ava Agent' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-2', conversation_id: 'conversation-1', is_agent: false, is_ai: false, message_type: 'text', content: 'I still need help with the repair.', sender_name: 'Casey Customer' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'note-1', conversation_id: 'conversation-1', content: 'Prior context', subject: 'Current request', author_name: 'Ava Agent' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'job-1', title: 'Repair', status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'booking-1', service_name: 'Plumbing repair', status: 'confirmed', requested_date: '2026-09-12', requested_start_time: '10:00', created_at: '2026-09-10T09:00:00.000Z', updated_at: '2026-09-10T09:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, job_id: 'job-1', amount: '100.00', status: 'captured' }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, status: 'completed', total_cents: 2500 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3, status: 'ready', total_cents: 1800 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', conversation_id: 'conversation-1', attachment_name: 'photo.png', attachment_url: '/api/storage/files/photo.png' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'email-1', conversation_id: 'conversation-1', kind: 'agent_reply', recipient: 'customer@example.com', subject: 'Support follow-up', status: 'sent', attempts: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'assignment-1', conversation_id: 'conversation-1', agent_id: 'agent-2', agent_name: 'Bri Agent', assignment_type: 'manual', status: 'completed', claimed_at: '2026-09-08T10:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'credit-account-1', currency_code: 'USD', balance_cents: '12500', reserved_cents: '1500', status: 'active', ledger_version: '4', last_posted_at: '2026-09-11T12:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'credit-tx-1', transaction_type: 'purchase', status: 'posted', amount_cents: '2400', currency_code: 'USD', partner_id: '9', agreement_id: 'agreement-1', description: 'Restaurant purchase', reference_type: 'food_order', reference_id: 'order-1', entry_direction: 'debit', restaurant_name: 'Casey Cafe', posted_at: '2026-09-11T12:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'credit-hold-1', amount_cents: '1500', currency_code: 'USD', status: 'active', partner_id: '9', agreement_id: 'agreement-1', restaurant_name: 'Casey Cafe', purpose: 'Order authorization', expires_at: '2026-09-11T12:30:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'credit-dispute-1', transaction_id: 'credit-tx-1', partner_id: '9', status: 'open', reason_code: 'incorrect_amount', description: 'Amount is incorrect', restaurant_name: 'Casey Cafe', opened_at: '2026-09-11T13:00:00.000Z' }] });

    const res = await request(buildApp())
      .get('/api/support/conversations/conversation-1/customer-360')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.profile.email).toBe('customer@example.com');
    expect(res.body.data.summary).toEqual({ conversations: 1, jobs: 1, payments: 1, orders: 2, attachments: 1, internalNotes: 1 });
    expect(res.body.data.priorAgents).toEqual([
      { id: 'agent-1', name: 'Ava Agent' },
      { id: 'agent-2', name: 'Bri Agent' },
    ]);
    expect(res.body.data.bookings).toEqual([expect.objectContaining({ id: 'booking-1', status: 'confirmed' })]);
    expect(res.body.data.supportConversations[0].channel).toBe('web_chat');
    expect(res.body.data.assignmentHistory).toEqual([expect.objectContaining({ agent_name: 'Bri Agent', status: 'completed' })]);
    expect(res.body.data.conversationMessages).toEqual([expect.objectContaining({ id: 'message-2', content: 'I still need help with the repair.' })]);
    expect(res.body.data.emailHistory).toEqual([expect.objectContaining({ id: 'email-1', status: 'sent' })]);
    expect(res.body.data.emailHistory[0]).not.toHaveProperty('payload');
    expect(res.body.data.credit.accounts[0]).toEqual(expect.objectContaining({ balanceCents: 12500, reservedCents: 1500, availableCents: 11000 }));
    expect(res.body.data.credit.transactions[0]).toEqual(expect.objectContaining({ restaurantName: 'Casey Cafe', direction: 'debit', amountCents: 2400 }));
    expect(res.body.data.credit.summary).toEqual(expect.objectContaining({ availableCents: 11000, activeHoldCount: 1, openDisputeCount: 1 }));
  });

  test('does not expose customer 360 context to the customer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: USER_ID, status: 'open', agent_id: null }] });

    const res = await request(buildApp())
      .get('/api/support/conversations/conversation-1/customer-360')
      .set('Authorization', authHeader());

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('merges two staff conversations without losing message history', async () => {
    const sourceId = '00000000-0000-4000-8000-000000000901';
    const targetId = '00000000-0000-4000-8000-000000000902';
    const source = { id: sourceId, customer_id: USER_ID, customer_email: 'customer@example.com', business_id: 42, status: 'open', agent_id: null };
    const target = { id: targetId, customer_id: USER_ID, customer_email: 'customer@example.com', business_id: 42, status: 'in_progress', agent_id: null };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [source] })
      .mockResolvedValueOnce({ rows: [target] })
      .mockResolvedValueOnce({ rows: [source, target] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [] })
      .mockResolvedValueOnce({ rows: [{ message_count: 3, customer_message_count: 2, agent_message_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: targetId, status: 'in_progress', message_count: 3, customer_message_count: 2, agent_message_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: sourceId, status: 'merged', merged_into_conversation_id: targetId, merged_at: '2026-09-11T00:00:00.000Z', merge_reason: 'Duplicate request' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/support/conversations/${sourceId}/merge`)
      .set('Authorization', adminAuthHeader())
      .send({ targetConversationId: targetId, reason: 'Duplicate request' });

    expect(res.status).toBe(200);
    expect(res.body.data.movedMessages).toBe(3);
    expect(res.body.data.source.status).toBe('merged');
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_conversation_messages/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /SET status = 'removed'/.test(sql))).toBe(true);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'support_conversations_merged', targetId: sourceId }));
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(sourceId, 'ticket:merged', expect.any(Object));
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(targetId, 'ticket:merged', expect.any(Object));
  });

  test('does not allow customers to merge conversations', async () => {
    const sourceId = '00000000-0000-4000-8000-000000000903';
    const targetId = '00000000-0000-4000-8000-000000000904';
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: sourceId, customer_id: USER_ID, customer_email: 'mobile@example.com', business_id: 42, status: 'open', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: targetId, customer_id: USER_ID, customer_email: 'mobile@example.com', business_id: 42, status: 'open', agent_id: null }] });

    const res = await request(buildApp())
      .post(`/api/support/conversations/${sourceId}/merge`)
      .set('Authorization', authHeader())
      .send({ targetConversationId: targetId });

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  test('returns real CSAT analytics to platform admins', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ surveys_sent: 4, surveys_completed: 2, avg_rating: 4.5, avg_nps: 9, nps_index: 100, csat_score: 100 }] })
      .mockResolvedValueOnce({ rows: [{ day: '2026-09-09', responses: 2, avg_rating: 4.5, avg_nps: 9 }] })
      .mockResolvedValueOnce({ rows: [{ agent_name: 'Support', responses: 2, avg_rating: 4.5, avg_nps: 9, nps_index: 100 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'review-1', rating: 5, comment: 'Helpful', customer_name: 'Casey Customer', conversation_subject: 'Billing question', agent_name: 'Support' }] });

    const res = await request(buildApp())
      .get('/api/support/csat/analytics')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.metrics).toMatchObject({ surveys_sent: 4, surveys_completed: 2, csat_score: 100, survey_response_rate: 50, avg_nps: 9, nps_index: 100 });
    expect(res.body.csat_trend[0]).toMatchObject({ avg_nps: 9 });
    expect(res.body.agent_csat[0]).toMatchObject({ avg_nps: 9, nps_index: 100 });
    expect(res.body.recent_feedback[0]).toMatchObject({ customer_name: 'Casey Customer', conversation_subject: 'Billing question', agent_name: 'Support' });
    expect(res.body.recent_feedback).toHaveLength(1);
  });

  test('returns an append-only lifecycle timeline to support staff', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'conversation-1',
        business_id: 42,
        customer_id: USER_ID,
        customer_email: 'customer@example.com',
        customer_name: 'Casey Customer',
        status: 'resolved',
      }] })
      .mockResolvedValueOnce({ rows: [
        { id: 'event-1', status_from: null, status_to: 'open', changed_at: '2026-09-11T00:00:00.000Z' },
        { id: 'event-2', status_from: 'open', status_to: 'in_progress', changed_at: '2026-09-11T00:01:00.000Z' },
        { id: 'event-3', status_from: 'in_progress', status_to: 'resolved', changed_at: '2026-09-11T00:02:00.000Z' },
      ] });

    const res = await request(buildApp())
      .get('/api/support/conversations/conversation-1/lifecycle')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((event) => event.status_to)).toEqual(['open', 'in_progress', 'resolved']);
    expect(mockQuery.mock.calls[2][0]).toContain('support_conversation_lifecycle_events');
    expect(mockQuery.mock.calls[2][0]).toContain('LIMIT 200');
  });

  test('does not expose support audit logs to customers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [authUserRow()] });

    const res = await request(buildApp())
      .get('/api/support/audit/logs')
      .set('Authorization', authHeader());

    expect(res.status).toBe(403);
  });

  test('returns bounded support audit logs to platform admins', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('information_schema.columns')) return { rows: [] };
      if (text.includes('FROM users') && text.includes('is_active')) {
        return { rows: [{ ...authUserRow(), id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' }] };
      }
      if (text.includes('SELECT a.id')) return { rows: [{ id: 'audit-1', action: 'support_reply' }] };
      if (text.includes('SELECT COUNT(*)::int AS total FROM admin_audit_log')) return { rows: [{ total: 1 }] };
      if (text.includes('COUNT(*)::int AS total_entries')) return { rows: [{ total_entries: 1, users_active: 1, actions_today: 1, last_entry: '2026-09-09T00:00:00.000Z' }] };
      return { rows: [] };
    });

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

  test('does not let support agents manage business support settings', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), role: 'support_agent', email: 'agent@example.com' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/settings/general?business_id=42')
      .set('Authorization', supportAgentAuthHeader())
      .send({ support_enabled: false });

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_admin_settings/.test(sql))).toBe(false);
  });

  test('keeps team-member updates constrained to the authorized business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, business_id: 42, role: 'agent' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, team_id: 3, agent_id: 9, role: 'manager', is_active: true }] });

    const res = await request(buildApp())
      .put('/api/support/team/members/7')
      .set('Authorization', adminAuthHeader())
      .send({ role: 'manager' });

    expect(res.status).toBe(200);
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE team_members tm/.test(sql));
    expect(updateCall?.[0]).toMatch(/st\.business_id = \$3/);
    expect(updateCall?.[1]).toEqual(['manager', '7', 42]);
  });

  test('does not let customers choose an arbitrary support business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: 42 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/conversations')
      .set('Authorization', authHeader())
      .send({
        businessId: 999,
        subject: 'Account question',
        description: 'Please help with my account.',
      });

    expect(res.status).toBe(200);
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_conversations/.test(sql));
    expect(insertCall?.[1]?.[0]).toBe(42);
    expect(insertCall?.[1]?.[0]).not.toBe(999);
  });

  test('recovers a duplicate support conversation request without queueing again', async () => {
    const clientRequestId = '55555555-5555-4555-8555-555555555555';
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: 42, status: 'open' }] });

    const res = await request(buildApp())
      .post('/api/support/conversations')
      .set('Authorization', authHeader())
      .set('Idempotency-Key', clientRequestId)
      .send({
        businessId: 999,
        subject: 'Account question',
        description: 'Please help with my account.',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ ticketId: 'conversation-1', idempotent: true }));
    const queueRepair = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_queue/.test(sql));
    expect(queueRepair?.[0]).toContain('NOT EXISTS');
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

  test('bounds attachment names and stores the attachment with its counter atomically', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'attachment-1', conversation_id: 'conversation-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/support/42/conversations/conversation-1/attachment')
      .set('Authorization', adminAuthHeader())
      .send({ attachmentUrl: 'https://cdn.example.com/image.png', attachmentName: 'proof.png' });

    expect(res.status).toBe(200);
    const insertIndex = mockQuery.mock.calls.findIndex(([sql]) => /INSERT INTO support_conversation_messages/.test(sql));
    const counterIndex = mockQuery.mock.calls.findIndex(([sql]) => /UPDATE support_conversations SET message_count/.test(sql));
    expect(insertIndex).toBeGreaterThan(-1);
    expect(counterIndex).toBe(insertIndex + 1);
    expect(mockQuery.mock.calls[insertIndex][1]).toEqual([
      'conversation-1',
      ADMIN_ID,
      'proof.png',
      'https://cdn.example.com/image.png',
      'proof.png',
    ]);
  });

  test('rejects oversized attachment names before authorization or database writes', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] });

    const res = await request(buildApp())
      .post('/api/support/42/conversations/conversation-1/attachment')
      .set('Authorization', adminAuthHeader())
      .send({ attachmentUrl: 'https://cdn.example.com/image.png', attachmentName: 'x'.repeat(256) });

    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('rejects oversized legacy message edits before loading the message', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] });

    const res = await request(buildApp())
      .put('/api/support/42/messages/message-1')
      .set('Authorization', adminAuthHeader())
      .send({ content: 'x'.repeat(5001) });

    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('preserves edit history on the legacy message edit route', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', conversation_id: 'conversation-1', business_id: 42, sender_id: ADMIN_ID, message_type: 'text' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', conversation_id: 'conversation-1', content: 'Updated reply', edited_at: '2026-09-09T00:01:00.000Z', edit_count: 1 }] });

    const res = await request(buildApp())
      .put('/api/support/42/messages/message-1')
      .set('Authorization', adminAuthHeader())
      .send({ content: 'Updated reply' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ content: 'Updated reply', edit_count: 1 });
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE support_conversation_messages/.test(sql));
    expect(updateCall[0]).toMatch(/original_content = COALESCE\(original_content, content\)/);
    expect(updateCall[0]).toMatch(/edited_at = CURRENT_TIMESTAMP/);
    expect(updateCall[0]).toMatch(/edit_count = edit_count \+ 1/);
  });

  test('does not allow the legacy edit route to modify internal notes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', conversation_id: 'conversation-1', business_id: 42, sender_id: ADMIN_ID, message_type: 'internal_note' }] });

    const res = await request(buildApp())
      .put('/api/support/42/messages/message-1')
      .set('Authorization', adminAuthHeader())
      .send({ content: 'Changed private note' });

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_conversation_messages/.test(sql))).toBe(false);
  });

  test('deletes a legacy message and decrements its counter in one transaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', conversation_id: 'conversation-1', business_id: 42, sender_id: ADMIN_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .delete('/api/support/42/messages/message-1')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    const deleteIndex = mockQuery.mock.calls.findIndex(([sql]) => /DELETE FROM support_conversation_messages/.test(sql));
    const counterIndex = mockQuery.mock.calls.findIndex(([sql]) => /UPDATE support_conversations SET message_count/.test(sql));
    expect(counterIndex).toBe(deleteIndex + 1);
    expect(mockQuery.mock.calls[counterIndex][0]).toMatch(/GREATEST\(message_count - 1, 0\)/);
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

  test('blocks legacy shift reads when the caller cannot access the business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1', employer_id: 'employer-1', business_id: 42, user_id: 'other-user' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .get('/api/support/42/agents/agent-1/shifts?startDate=2026-09-01&endDate=2026-09-30')
      .set('Authorization', authHeader());

    expect(res.status).toBe(404);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM agent_shifts/.test(sql))).toBe(false);
  });

  test('allows platform admins to create shifts only for the route business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1', employer_id: 'employer-1', business_id: 42, user_id: 'other-user' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'shift-1', business_id: 42, agent_id: 'agent-1' }] });

    const res = await request(buildApp())
      .post('/api/support/42/agents/agent-1/shifts')
      .set('Authorization', adminAuthHeader())
      .send({ businessId: 42, shiftDate: '2026-09-10', scheduledStart: '09:00', scheduledEnd: '17:00' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'shift-1', business_id: 42 });
    const insertQuery = mockQuery.mock.calls.find(([sql]) => /INSERT INTO agent_shifts/.test(sql));
    expect(insertQuery[1][1]).toBe('42');
  });

  test('rejects a shift body that targets a different business than the route', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] });

    const res = await request(buildApp())
      .post('/api/support/42/agents/agent-1/shifts')
      .set('Authorization', adminAuthHeader())
      .send({ businessId: 99, shiftDate: '2026-09-10', scheduledStart: '09:00', scheduledEnd: '17:00' });

    expect(res.status).toBe(400);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO agent_shifts/.test(sql))).toBe(false);
  });

  test('blocks routing-rule updates without access to the route business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/support/42/settings/routing-rules/rule-1')
      .set('Authorization', authHeader())
      .send({ ruleName: 'Unauthorized rule' });

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE routing_rules/.test(sql))).toBe(false);
  });

  test('scopes routing-rule updates and deletes to the requested business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rule-1', business_id: 42, rule_name: 'Updated rule' }] });

    const updateRes = await request(buildApp())
      .put('/api/support/42/settings/routing-rules/rule-1')
      .set('Authorization', adminAuthHeader())
      .send({ ruleName: 'Updated rule' });

    expect(updateRes.status).toBe(200);
    const updateQuery = mockQuery.mock.calls.find(([sql]) => /UPDATE routing_rules/.test(sql));
    expect(updateQuery[0]).toMatch(/business_id = \$5/);
    expect(updateQuery[1][4]).toBe('42');

    resetMocks();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rule-1', business_id: 42 }] });

    const deleteRes = await request(buildApp())
      .delete('/api/support/42/settings/routing-rules/rule-1')
      .set('Authorization', adminAuthHeader());

    expect(deleteRes.status).toBe(200);
    const deleteQuery = mockQuery.mock.calls.find(([sql]) => /DELETE FROM routing_rules/.test(sql));
    expect(deleteQuery[0]).toMatch(/business_id = \$2/);
    expect(deleteQuery[1][1]).toBe('42');
  });

  test('blocks queue inspection and removal without business access', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [] });

    const nextAgentRes = await request(buildApp())
      .get('/api/support/42/queue/next-agent')
      .set('Authorization', authHeader());

    expect(nextAgentRes.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM support_agents/.test(sql))).toBe(false);

    resetMocks();
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [] });

    const removeRes = await request(buildApp())
      .post('/api/support/42/queue/remove/conversation-1')
      .set('Authorization', authHeader())
      .send({ reason: 'Unauthorized removal' });

    expect(removeRes.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_queue/.test(sql))).toBe(false);
  });

  test('scopes agent assignment reads to the requested business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1', user_id: 'other-user', employer_id: 'employer-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'assignment-1', agent_id: 'agent-1', business_id: 42 }] });

    const res = await request(buildApp())
      .get('/api/support/42/agents/agent-1/assignments')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    const assignmentQuery = mockQuery.mock.calls.find(([sql]) => /FROM conversation_assignments ca/.test(sql));
    expect(assignmentQuery[0]).toMatch(/ca\.business_id = \$2/);
    expect(assignmentQuery[1][1]).toBe('42');
  });

  test('blocks AI handoff checks when the URL business does not own the conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: 99 }] });

    const res = await request(buildApp())
      .post('/api/support/42/ai/check-handoff')
      .set('Authorization', authHeader())
      .send({ messageCount: 4, sentiment: 'negative' });

    expect(res.status).toBe(403);
  });

  test('allows platform-admin AI handoff checks for the matching business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...authUserRow(), id: ADMIN_ID, role: 'super_admin' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', business_id: 42 }] });

    const res = await request(buildApp())
      .post('/api/support/42/ai/check-handoff')
      .set('Authorization', adminAuthHeader())
      .send({ messageCount: 4, sentiment: 'negative' });

    expect(res.status).toBe(200);
    expect(res.body.data.needsHandoff).toBe(true);
  });

  test('requires business access before suggesting knowledge-base articles', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUserRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .get('/api/support/42/ai/suggest-articles/conversation-1?query=billing')
      .set('Authorization', authHeader());

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM knowledge_base_articles/.test(sql))).toBe(false);
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
