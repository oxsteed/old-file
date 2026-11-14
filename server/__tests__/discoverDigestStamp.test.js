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

function fakeDigestDb(alerts) {
  const calls = [];
  const db = {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push(String(sql));
      if (String(sql).includes('FROM discover_search_alerts a')) {
        return { rows: alerts };
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
