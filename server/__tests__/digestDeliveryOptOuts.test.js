'use strict';

// Notifications audit N1: decideEmailDelivery never read
// notification_type_opt_outs, so a user who toggled a type off in
// Settings still got its digest mail. N10: purgeStaleDigestQueueRows
// missed frequency='off' rows and rows for users with no prefs row
// (the batch INNER JOINs notification_preferences, so those rows were
// never selected and sat forever).
// Reproduction: a preloaded recipient opted out of reengagement_nudge
// email still gets mailed; the purge SQL has no frequency-off or
// no-prefs-row clause.

jest.mock('../utils/email', () => ({
  sendEmail: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { sendEmail } = require('../utils/email');
const {
  decideEmailDelivery,
  loadDigestRecipient,
  deliverDigestEmail,
  purgeStaleDigestQueueRows,
} = require('../services/digestDelivery');

function recipientWithOptOuts(optOuts, over = {}) {
  return {
    userId: 'user-1',
    email: 'user@example.invalid',
    firstName: 'Test',
    preferredLanguage: 'en',
    deletedAt: null,
    isActive: true,
    prefs: { type_opt_outs: optOuts, ...over },
  };
}

function fakeQueryable({ optOuts = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes('FROM notification_type_opt_outs WHERE user_id')) {
        return { rows: optOuts.map((o) => ({ opt_out: o })) };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sendEmail.mockResolvedValue({ success: true, id: 'mail-1' });
});

test('decideEmailDelivery skips a type opted out for email', () => {
  const decision = decideEmailDelivery(
    recipientWithOptOuts(['reengagement_nudge|email']),
    { type: 'reengagement_nudge' },
  );
  expect(decision).toEqual({ action: 'skip', reason: 'type_opted_out:reengagement_nudge' });
});

test('decideEmailDelivery does not skip other types or in-app-only opt-outs', () => {
  expect(decideEmailDelivery(
    recipientWithOptOuts(['reengagement_nudge|email']),
    { type: 'discover_digest' },
  ).action).not.toBe('skip');
  expect(decideEmailDelivery(
    recipientWithOptOuts(['reengagement_nudge|in_app']),
    { type: 'reengagement_nudge' },
  ).action).not.toBe('skip');
});

test('loadDigestRecipient carries per-type opt-outs into prefs', async () => {
  const q = fakeQueryable();
  q.query = jest.fn(async (sql) => {
    q.calls.push(String(sql));
    return { rows: [{
      id: 'user-1', email: 'user@example.invalid', first_name: 'Test', preferred_language: 'en',
      deleted_at: null, is_active: true, unsubscribe_all: false, email_notifications: true,
      email_frequency: 'real-time', marketing_emails: true,
      type_opt_outs: ['reengagement_nudge|email'],
    }] };
  });
  const recipient = await loadDigestRecipient(q, 'user-1');
  expect(q.calls[0]).toContain('notification_type_opt_outs');
  expect(recipient.prefs.type_opt_outs).toEqual(['reengagement_nudge|email']);
});

test('deliverDigestEmail honours a per-type opt-out on a preloaded recipient (reengagement path)', async () => {
  // The reengagement job preloads prefs from its own query, so the
  // recipient arrives without type_opt_outs. Before the fix the mail
  // went out anyway; now the opt-outs are loaded and the mail skips.
  const q = fakeQueryable({ optOuts: ['reengagement_nudge|email'] });
  const result = await deliverDigestEmail(q, {
    userId: 'user-1',
    recipient: recipientWithOptOuts(undefined),
    type: 'reengagement_nudge',
    subject: 'We miss you',
    text: 'Come back',
    deliveryKey: 'reengagement-nudge:user-1:1',
  });
  expect(result).toMatchObject({ delivered: false, queued: false, reason: 'type_opted_out:reengagement_nudge' });
  expect(sendEmail).not.toHaveBeenCalled();
});

test('deliverDigestEmail still sends when no opt-out applies to the preloaded recipient', async () => {
  const q = fakeQueryable({ optOuts: [] });
  const result = await deliverDigestEmail(q, {
    userId: 'user-1',
    recipient: recipientWithOptOuts(undefined),
    type: 'reengagement_nudge',
    subject: 'We miss you',
    text: 'Come back',
    deliveryKey: 'reengagement-nudge:user-1:1',
  });
  expect(result).toMatchObject({ delivered: true, reason: 'sent' });
  expect(sendEmail).toHaveBeenCalledTimes(1);
});

test('purgeStaleDigestQueueRows covers frequency-off, no-prefs-row and per-type opt-out rows (N10 + N1)', async () => {
  const q = fakeQueryable();
  q.query = jest.fn(async (sql) => {
    q.calls.push(String(sql));
    return { rowCount: 3 };
  });
  expect(await purgeStaleDigestQueueRows(q)).toBe(3);
  const sql = q.calls[0];
  expect(sql).toContain("np.email_frequency = 'off'");
  expect(sql).toContain('NOT EXISTS (SELECT 1 FROM notification_preferences np');
  expect(sql).toContain('notification_type_opt_outs o');
  expect(sql).toContain("o.channel = 'email'");
});
