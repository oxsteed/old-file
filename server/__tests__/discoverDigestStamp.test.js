'use strict';

/**
 * Domain 7 #27 — discover digest stamps last_checked_at before the send.
 *
 * runDiscoverDigestTick used to UPDATE last_checked_at=NOW() before the
 * search and send; on mail.success === false the row was skipped with its
 * signature unchanged, but the due-only filter (last_checked_at older than
 * 1 day) would not pick it up again for a day. No mail is lost, only
 * delayed up to 24h.
 *
 * Fix: stamp last_checked_at only after a completed check — on first
 * signature store, on an unchanged signature, or on a successful send —
 * never on a failed send (or a thrown search), so the row stays due for
 * the next tick.
 *
 * The search itself is driven by the real runDiscoverSearch with an empty
 * database (all search queries return no rows), which yields the
 * deterministic empty-results fingerprint sha256('').
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const crypto = require('crypto');
const pool = require('../db');
const { sendEmail } = require('../utils/email');
const { runDiscoverDigestTick } = require('../controllers/discoverController');

const EMPTY_SIGNATURE = crypto.createHash('sha256').update('').digest('hex');

function alertRow(overrides = {}) {
  return {
    id: 7,
    user_id: 'user-1',
    query: 'plumbing',
    lat: null,
    lng: null,
    radius_miles: 25,
    email: 'ana@example.com',
    first_name: 'Ana',
    last_signature: 'old-signature',
    last_checked_at: null,
    ...overrides,
  };
}

function fakeDigestDb(alerts, recipientOverrides = {}) {
  const calls = [];
  const recipient = {
    id: 'user-1',
    email: 'ana@example.com',
    first_name: 'Ana',
    preferred_language: 'en',
    deleted_at: null,
    is_active: true,
    unsubscribe_all: false,
    email_notifications: true,
    email_frequency: 'real-time',
    marketing_emails: true,
    ...recipientOverrides,
  };
  const db = {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push(String(sql));
      if (String(sql).includes('FROM discover_search_alerts a')) {
        return { rows: alerts };
      }
      // Shared digest helper loads the recipient + preferences before
      // sending (item 16); answer it from the same fake.
      if (String(sql).includes('FROM users u')) {
        return { rows: [recipient] };
      }
      return { rows: [] };
    }),
  };
  return db;
}

function stampCalls(db) {
  // Only UPDATEs that write last_checked_at count; the due-only SELECT
  // mentions the column in its WHERE clause and must not match.
  return db.calls.filter(
    (sql) => sql.trim().startsWith('UPDATE') && sql.includes('last_checked_at'),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockResolvedValue({ rows: [] });
});

test('a failed send leaves the row due: last_checked_at is not stamped', async () => {
  sendEmail.mockResolvedValue({ success: false });
  const digestDb = fakeDigestDb([alertRow()]);
  const fence = { db: digestDb, assertActive: jest.fn() };

  await runDiscoverDigestTick({ fence });

  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(stampCalls(digestDb)).toHaveLength(0);
});

test('a successful send stamps last_checked_at with the new signature', async () => {
  sendEmail.mockResolvedValue({ success: true });
  const digestDb = fakeDigestDb([alertRow()]);
  const fence = { db: digestDb, assertActive: jest.fn() };

  await runDiscoverDigestTick({ fence });

  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(stampCalls(digestDb)).toHaveLength(1);
  expect(stampCalls(digestDb)[0]).toMatch(/last_signature/);
  expect(stampCalls(digestDb)[0]).toMatch(/last_sent_at/);
});

test('an unchanged signature still stamps last_checked_at (completed check)', async () => {
  const digestDb = fakeDigestDb([alertRow({ last_signature: EMPTY_SIGNATURE })]);
  const fence = { db: digestDb, assertActive: jest.fn() };

  await runDiscoverDigestTick({ fence });

  expect(sendEmail).not.toHaveBeenCalled();
  expect(stampCalls(digestDb)).toHaveLength(1);
});

test('a first-time alert stores the signature and stamps last_checked_at', async () => {
  const digestDb = fakeDigestDb([alertRow({ last_signature: null })]);
  const fence = { db: digestDb, assertActive: jest.fn() };

  await runDiscoverDigestTick({ fence });

  expect(sendEmail).not.toHaveBeenCalled();
  expect(stampCalls(digestDb)).toHaveLength(1);
  expect(stampCalls(digestDb)[0]).toMatch(/last_signature/);
});

test('an unsubscribed user gets no discover mail and the signature is untouched', async () => {
  // Item 16: the digest selected alerts with no notification_preferences
  // check and mailed via direct sendEmail, so unsubscribe_all /
  // email_notifications off / frequency off were all ignored.
  sendEmail.mockResolvedValue({ success: true });
  const digestDb = fakeDigestDb([alertRow()], { unsubscribe_all: true });
  const fence = { db: digestDb, assertActive: jest.fn() };

  await runDiscoverDigestTick({ fence });

  expect(sendEmail).not.toHaveBeenCalled();
  // A prefs skip is a completed check (last_checked_at stamped so the row
  // sleeps a day) but the signature is untouched, so re-subscribing
  // resumes delivery on the next due tick.
  expect(stampCalls(digestDb)).toHaveLength(1);
  expect(stampCalls(digestDb)[0]).not.toMatch(/last_signature/);
});

test('a frequency-off user gets no discover mail', async () => {
  sendEmail.mockResolvedValue({ success: true });
  const digestDb = fakeDigestDb([alertRow()], { email_frequency: 'off' });
  const fence = { db: digestDb, assertActive: jest.fn() };

  await runDiscoverDigestTick({ fence });

  expect(sendEmail).not.toHaveBeenCalled();
  expect(stampCalls(digestDb)).toHaveLength(1);
});

test('a daily-frequency user is queued for the digest instead of mailed now', async () => {
  sendEmail.mockResolvedValue({ success: true });
  const digestDb = fakeDigestDb([alertRow()], { email_frequency: 'daily' });
  const fence = { db: digestDb, assertActive: jest.fn() };

  await runDiscoverDigestTick({ fence });

  expect(sendEmail).not.toHaveBeenCalled();
  const queueCalls = digestDb.query.mock.calls.filter(
    ([sql]) => String(sql).includes('INSERT INTO email_digest_queue'),
  );
  expect(queueCalls).toHaveLength(1);
  // digest_type is the bound $2 param, not a SQL literal.
  expect(queueCalls[0][1][1]).toBe('daily');
  expect(queueCalls[0][1][2]).toBe('discover_digest');
  // Delegated to the digest batch: the signature advances so the change
  // is not re-queued, but last_sent_at is NOT claimed (nothing sent yet).
  expect(stampCalls(digestDb)).toHaveLength(1);
  expect(stampCalls(digestDb)[0]).toMatch(/last_signature/);
  expect(stampCalls(digestDb)[0]).not.toMatch(/last_sent_at/);
});
