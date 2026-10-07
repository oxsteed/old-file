'use strict';

// Item 22: marketing mail must carry List-Unsubscribe / List-Unsubscribe-Post
// headers; transactional mail must not gain them.

process.env.RESEND_API_KEY = 're_test_key_for_header_tests';

jest.unmock('../utils/email');
const { sendEmail } = require('../utils/email');

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'test-email-id' }),
  });
});

afterEach(() => {
  delete global.fetch;
});

function sentBody() {
  return JSON.parse(global.fetch.mock.calls[0][1].body);
}

test('sendEmail passes List-Unsubscribe headers through to Resend', async () => {
  const result = await sendEmail({
    to: 'user@example.com',
    subject: 'Nudge',
    text: 'hello',
    html: '<p>hello</p>',
    headers: {
      'List-Unsubscribe': '<https://oxsteed.com/api/notifications/email/unsubscribe-one-click?token=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  expect(result.success).toBe(true);
  const body = sentBody();
  expect(body.headers).toEqual({
    'List-Unsubscribe': '<https://oxsteed.com/api/notifications/email/unsubscribe-one-click?token=abc>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
});

test('sendEmail omits the headers field for transactional mail without headers', async () => {
  const result = await sendEmail({
    to: 'user@example.com',
    subject: 'Receipt',
    text: 'paid',
    html: '<p>paid</p>',
  });

  expect(result.success).toBe(true);
  const body = sentBody();
  expect(body).not.toHaveProperty('headers');
});
