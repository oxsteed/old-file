'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { sendEmail } = require('../utils/email');
const { processSingleUserDigest } = require('../jobs/emailDigestBatch');

beforeEach(() => {
  resetMocks();
  sendEmail.mockClear();
  sendEmail.mockResolvedValue({ success: true, id: 'digest-1' });
});

test('delivers a localized digest and marks rows sent only after provider success', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ email: 'a@example.com', first_name: 'Ana', preferred_language: 'es' }] })
    .mockResolvedValueOnce({ rows: [{ id: 4, title: 'Nuevo trabajo', body: 'Revisa tu trabajo', created_at: new Date().toISOString() }] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(processSingleUserDigest('user-1', 'daily')).resolves.toBe(true);

  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: 'a@example.com',
    idempotencyKey: expect.stringMatching(/^email-digest:daily:user-1:/),
  }));
  expect(mockQuery.mock.calls[2][0]).toContain('UPDATE email_digest_queue');
});

test('leaves digest rows queued when delivery fails', async () => {
  sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' });
  mockQuery
    .mockResolvedValueOnce({ rows: [{ email: 'a@example.com', first_name: 'Ana', preferred_language: 'en' }] })
    .mockResolvedValueOnce({ rows: [{ id: 4, title: 'Update', body: 'Body', created_at: new Date().toISOString() }] });

  await expect(processSingleUserDigest('user-1', 'daily')).resolves.toBe(false);
  expect(mockQuery).toHaveBeenCalledTimes(2);
});
