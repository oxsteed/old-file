'use strict';

const { mockQuery, resetMocks } = require('./setup');
const email = require('../utils/email');
const {
  MAX_ATTEMPTS,
  enqueueSupportEmail,
  sendSupportEmail,
  processSupportEmailOutbox,
  retryFailedSupportEmails,
} = require('../services/supportEmailOutbox');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('support email outbox', () => {
  test('queues a failed notification once with bounded payload fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'outbox-1', status: 'pending' }] });
    email.sendEmail.mockResolvedValueOnce({ success: false, error: 'provider unavailable' });

    const result = await sendSupportEmail({
      conversationId: 'conversation-1',
      kind: 'agent_reply',
      to: 'customer@example.com',
      subject: 'Support update\n',
      text: 'Please review the update.',
      html: '<p>Please review the update.</p>',
      idempotencyKey: 'support-reply-message-1',
    });

    expect(result.success).toBe(false);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO support_email_outbox'),
      expect.arrayContaining(['conversation-1', 'agent_reply', 'customer@example.com', 'Support update', expect.any(String), 'support-reply-message-1'])
    );
  });

  test('claims, sends, and marks a queued email sent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'outbox-1',
        attempts: 1,
        payload: { to: 'customer@example.com', subject: 'Support update', text: 'Hello', html: '<p>Hello</p>', idempotencyKey: 'support-status-1' },
      }] })
      .mockResolvedValueOnce({ rows: [] });
    email.sendEmail.mockResolvedValueOnce({ success: true, id: 'resend-1' });

    await expect(processSupportEmailOutbox()).resolves.toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0 });
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'support-status-1' }));
    expect(mockQuery.mock.calls[1][0]).toContain("SET status = $1");
    expect(mockQuery.mock.calls[1][1][0]).toBe('sent');
  });

  test('marks a repeatedly failing email terminal after the final attempt', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'outbox-1', attempts: MAX_ATTEMPTS, payload: { to: 'customer@example.com', subject: 'Support update', idempotencyKey: 'support-status-1' } }] })
      .mockResolvedValueOnce({ rows: [] });
    email.sendEmail.mockResolvedValueOnce({ success: false, error: 'provider unavailable' });

    await expect(processSupportEmailOutbox()).resolves.toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1 });
    expect(mockQuery.mock.calls[1][1][0]).toBe('failed');
  });

  test('resets only terminal failures for an immediate retry', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'outbox-1' }, { id: 'outbox-2' }] });

    await expect(retryFailedSupportEmails('conversation-1')).resolves.toEqual({ queued: 2 });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'pending', attempts = 0"),
      ['conversation-1']
    );
  });
});
