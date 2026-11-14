'use strict';

// Background-jobs audit #40 (Group 2): retention loses storage-deletion
// keys when anonymization throws mid-person, then the retry completes
// the erasure with the files still in storage.
//
// The old anonymizePerson accumulated storage keys across restaurants
// and enqueued them only after the loop. A throw in restaurant 2 of 3
// discarded restaurant 1's keys, and the retry found no docs (already
// soft-deleted) so it completed the erasure with an empty key list.
// All mocked: no real database.

jest.mock('../services/restaurantRetentionService', () => ({
  anonymizeFormerStaff: jest.fn(),
  // Money flows W7: anonymizePerson scrubs the audit log once per
  // business after the restaurant loop.
  scrubBusinessAuditLogNames: jest.fn(async () => 0),
}));
jest.mock('../services/storageCleanupService', () => ({
  enqueueStorageDeletion: jest.fn(async () => true),
  resolveKey: jest.fn((key) => key),
}));

const { anonymizeFormerStaff } = require('../services/restaurantRetentionService');
const { enqueueStorageDeletion } = require('../services/storageCleanupService');
const { sweep } = require('../jobs/restaurantRetentionJob');

const USER_ID = '00000000-0000-4000-8000-000000000123';

function makeDb({ restaurants, dueRequests = [] }) {
  const queries = [];
  const db = {
    query: jest.fn(async (sql, params = []) => {
      queries.push(String(sql));
      // The due-staff select claims FOR UPDATE OF o SKIP LOCKED and
      // embeds the erasure subquery, so match it before the erasure
      // branch below (both mention restaurant_erasure_requests).
      if (sql.includes('FOR UPDATE OF o SKIP LOCKED')) return { rows: [] };
      // The due-requests select carries the latest retain_until in
      // the row itself (Domain 9 item 4); there is no per-request
      // retain_until lookup any more.
      if (sql.includes('SELECT er.*')) return { rows: dueRequests };
      if (sql.includes('FROM food_restaurants WHERE business_id')) return { rows: restaurants };
      return { rows: [] };
    }),
  };
  return { db, queries };
}

function dueRequest(overrides = {}) {
  return { id: 5, business_id: 42, user_id: USER_ID, retain_until: '2020-01-01', ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Background-jobs audit #40: retention storage keys survive a mid-person throw', () => {
  test('keys from an already-anonymized restaurant are enqueued even when a later restaurant throws', async () => {
    const { db, queries } = makeDb({
      restaurants: [{ id: 3 }, { id: 4 }],
      dueRequests: [dueRequest()],
    });
    anonymizeFormerStaff
      .mockResolvedValueOnce({
        skipped: false, documents_deleted: 1, time_entry_notes_cleared: 0,
        labor_profile_removed: 0, history_rows_retained: 0,
        storageKeysToDelete: ['staff-docs/key-1'],
      })
      .mockRejectedValueOnce(new Error('restaurant 4 blew up'));
    const result = await sweep(db);
    // Restaurant 1's key was enqueued immediately, before restaurant 2 threw.
    expect(enqueueStorageDeletion).toHaveBeenCalledTimes(1);
    expect(enqueueStorageDeletion).toHaveBeenCalledWith('staff-docs/key-1', 'staff_erasure', { client: db });
    // The erasure did NOT complete: the error is recorded and the
    // request stays approved for next week's retry.
    expect(result.completedRequests).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(queries.join('\n')).not.toContain("SET status = 'completed'");
  });

  test('a clean run enqueues every restaurant key and completes with the enqueue count', async () => {
    const { db, queries } = makeDb({
      restaurants: [{ id: 3 }, { id: 4 }],
      dueRequests: [dueRequest()],
    });
    anonymizeFormerStaff
      .mockResolvedValueOnce({
        skipped: false, documents_deleted: 1, time_entry_notes_cleared: 0,
        labor_profile_removed: 0, history_rows_retained: 0,
        storageKeysToDelete: ['staff-docs/key-1'],
      })
      .mockResolvedValueOnce({
        skipped: false, documents_deleted: 2, time_entry_notes_cleared: 0,
        labor_profile_removed: 0, history_rows_retained: 0,
        storageKeysToDelete: ['staff-docs/key-2', 'staff-docs/key-3'],
      });
    const result = await sweep(db);
    expect(enqueueStorageDeletion).toHaveBeenCalledTimes(3);
    expect(result.completedRequests).toBe(1);
    const completion = queries.find((sql) => sql.includes("SET status = 'completed'"));
    expect(completion).toBeTruthy();
    const outcome = JSON.parse(queries
      .map((sql, i) => ({ sql, params: db.query.mock.calls[i][1] }))
      .find(({ sql }) => sql.includes("SET status = 'completed'")).params[1]);
    expect(outcome.storage_keys_enqueued).toBe(3);
    expect(outcome.documents_deleted).toBe(3);
  });

  test('a failed enqueue fails the erasure instead of completing it', async () => {
    const { db, queries } = makeDb({
      restaurants: [{ id: 3 }],
      dueRequests: [dueRequest()],
    });
    anonymizeFormerStaff.mockResolvedValueOnce({
      skipped: false, documents_deleted: 1, time_entry_notes_cleared: 0,
      labor_profile_removed: 0, history_rows_retained: 0,
      storageKeysToDelete: ['staff-docs/key-1'],
    });
    enqueueStorageDeletion.mockResolvedValueOnce(false);
    const result = await sweep(db);
    expect(result.completedRequests).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('Failed to queue storage deletion');
    expect(queries.join('\n')).not.toContain("SET status = 'completed'");
  });
});

describe('Domain 9 (2026-11-13) item 4: the retention sweep is bounded and claims its rows', () => {
  test('both due selects carry LIMIT 200 + FOR UPDATE SKIP LOCKED, and no per-request retain_until lookup runs', async () => {
    const { db, queries } = makeDb({
      restaurants: [{ id: 3 }],
      dueRequests: [dueRequest()],
    });
    anonymizeFormerStaff.mockResolvedValueOnce({
      skipped: false, documents_deleted: 0, time_entry_notes_cleared: 0,
      labor_profile_removed: 0, history_rows_retained: 0,
      storageKeysToDelete: [],
    });
    const result = await sweep(db);
    expect(result.completedRequests).toBe(1);
    const joined = queries.join('\n');
    expect(joined).toContain('FOR UPDATE OF er SKIP LOCKED');
    expect(joined).toContain('FOR UPDATE OF o SKIP LOCKED');
    expect(joined.match(/LIMIT \$1/g)).toHaveLength(2);
    // The latest retain_until rides in the due-requests row; the old
    // standalone per-request SELECT is gone.
    expect(joined).not.toContain('SELECT retain_until FROM staff_offboarding_records');
    expect(anonymizeFormerStaff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ retainUntil: '2020-01-01' }),
    );
  });

  test('a full 200-request batch reports hitBatchLimit so the backlog is visible', async () => {
    const many = Array.from({ length: 200 }, (_, i) => dueRequest({ id: 100 + i }));
    const { db } = makeDb({ restaurants: [{ id: 3 }], dueRequests: many });
    anonymizeFormerStaff.mockResolvedValue({
      skipped: false, documents_deleted: 0, time_entry_notes_cleared: 0,
      labor_profile_removed: 0, history_rows_retained: 0,
      storageKeysToDelete: [],
    });
    const result = await sweep(db);
    expect(result.completedRequests).toBe(200);
    expect(result.hitBatchLimit).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('a partial batch does not report hitBatchLimit', async () => {
    const { db } = makeDb({ restaurants: [{ id: 3 }], dueRequests: [dueRequest()] });
    anonymizeFormerStaff.mockResolvedValueOnce({
      skipped: false, documents_deleted: 0, time_entry_notes_cleared: 0,
      labor_profile_removed: 0, history_rows_retained: 0,
      storageKeysToDelete: [],
    });
    const result = await sweep(db);
    expect(result.completedRequests).toBe(1);
    expect(result.hitBatchLimit).toBe(false);
  });
});
