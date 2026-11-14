'use strict';

// Notifications audit item 6: careers notifyUser/notifyApplicant sent email
// without ever reading notification_preferences, and swallowed email
// failures with .catch(() => {}).
// Reproduction: a user with email_notifications=false (or unsubscribe_all)
// still gets careers email, and a failed send leaves no log trace.

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
const logger = require('../utils/logger');
const { notifyUser, notifyApplicant, careerEmailAllowed } = require('../services/careers/notify');

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function fakeRunner({ prefs = null, email = 'applicant@example.invalid' } = {}) {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, params) => {
      queries.push([sql, params]);
      if (String(sql).includes('FROM notification_preferences')) {
        return { rows: prefs ? [{ email_notifications: prefs.email_notifications ?? null, unsubscribe_all: prefs.unsubscribe_all ?? null }] : [] };
      }
      if (String(sql).includes('FROM users')) {
        return {
          rows: [{
            id: 'user-1',
            email,
            preferred_language: 'en',
            email_notifications: prefs?.email_notifications ?? null,
            unsubscribe_all: prefs?.unsubscribe_all ?? null,
          }],
        };
      }
      if (String(sql).includes('INSERT INTO notifications')) return { rowCount: 1 };
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sendEmail.mockResolvedValue({ success: true });
});

test('careerEmailAllowed is false when email_notifications is off or unsubscribed', async () => {
  const db = fakeRunner();
  expect(await careerEmailAllowed(db, 'user-1')).toBe(true);
  const off = fakeRunner({ prefs: { email_notifications: false } });
  expect(await careerEmailAllowed(off, 'user-1')).toBe(false);
  const unsub = fakeRunner({ prefs: { unsubscribe_all: true } });
  expect(await careerEmailAllowed(unsub, 'user-1')).toBe(false);
});

test('notifyUser skips email when email_notifications is false but still writes the in-app row', async () => {
  const db = fakeRunner({ prefs: { email_notifications: false } });
  const result = await notifyUser(db, {
    userId: 'user-1',
    type: 'career_application_received',
    params: { openingTitle: 'Line Cook' },
    deliveryKey: 'test-pref-off',
  });
  await flush();
  expect(result).toEqual({ inserted: true });
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO notifications'),
    expect.anything(),
  );
  expect(sendEmail).not.toHaveBeenCalled();
});

test('notifyUser skips email when unsubscribe_all is set', async () => {
  const db = fakeRunner({ prefs: { unsubscribe_all: true } });
  await notifyUser(db, {
    userId: 'user-1',
    type: 'career_application_received',
    params: { openingTitle: 'Line Cook' },
    deliveryKey: 'test-unsub',
  });
  await flush();
  expect(sendEmail).not.toHaveBeenCalled();
});

test('notifyUser still emails when preferences allow it', async () => {
  const db = fakeRunner({ prefs: { email_notifications: true, unsubscribe_all: false } });
  await notifyUser(db, {
    userId: 'user-1',
    type: 'career_application_received',
    params: { openingTitle: 'Line Cook' },
    deliveryKey: 'test-pref-on',
  });
  await flush();
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: 'applicant@example.invalid',
  }));
});

test('a failed careers email is logged instead of swallowed', async () => {
  sendEmail.mockResolvedValue({ success: false, error: 'Resend down' });
  const db = fakeRunner();
  await notifyUser(db, {
    userId: 'user-1',
    type: 'career_application_received',
    params: { openingTitle: 'Line Cook' },
    deliveryKey: 'test-email-fail',
  });
  await flush();
  expect(logger.warn).toHaveBeenCalledWith(
    'careers email failed',
    expect.objectContaining({ type: 'career_application_received' }),
  );
});

test('a failed guest-applicant email is logged instead of swallowed', async () => {
  sendEmail.mockResolvedValue({ success: false, error: 'Resend down' });
  const db = fakeRunner();
  await notifyApplicant(db, {
    user_id: null,
    applicant_email: 'guest@example.invalid',
    locale: 'en',
  }, {
    type: 'career_guest_confirm',
    params: { openingTitle: 'Line Cook' },
    deliveryKey: 'test-guest-fail',
  });
  await flush();
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    'careers email failed',
    expect.objectContaining({ type: 'career_guest_confirm' }),
  );
});
