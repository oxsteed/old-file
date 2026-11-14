'use strict';

// Domain 8 #12: the retention sweep loads the entire backlog with
// two unbounded SELECTs.
//
// Proves, with a stubbed database handle (no real database):
//   - both due queries are bounded: every due-requests and
//     due-staff select carries a LIMIT equal to the batch limit,
//     and the sweep pages through a backlog larger than one batch
//     with a last-processed cursor instead of materializing it all;
//   - a per-person failure does not stop the sweep, and the sweep
//     raises an incident when the errors array is non-empty instead
//     of surfacing failures only as log lines.
//
// The sweep accepts { batchLimit } so the tests can use a batch of 2
// against a backlog of 5; production uses SWEEP_BATCH_LIMIT (200).

jest.mock('../services/restaurantRetentionService', () => ({
  anonymizeFormerStaff: jest.fn(),
}));
jest.mock('../services/storageCleanupService', () => ({
  enqueueStorageDeletion: jest.fn(async () => true),
  resolveKey: jest.fn((key) => key),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn(async () => ({ persisted: true, incident: { id: 99 } })),
}));

const { anonymizeFormerStaff } = require('../services/restaurantRetentionService');
const { recordIncident } = require('../services/incidentStore');
const { sweep, SWEEP_BATCH_LIMIT } = require('../jobs/restaurantRetentionJob');

const USER_A = '00000000-0000-4000-8000-000000000a01';
const USER_B = '00000000-0000-4000-8000-000000000a02';
const USER_C = '00000000-0000-4000-8000-000000000a03';
const USER_D = '00000000-0000-4000-8000-000000000a04';
const USER_E = '00000000-0000-4000-8000-000000000a05';

const OK_OUTCOME = {
  skipped: false, documents_deleted: 0, time_entry_notes_cleared: 0,
  labor_profile_removed: 0, history_rows_retained: 0, storageKeysToDelete: [],
};

function makeDb({ dueRequests = [], dueStaff = [], restaurantsByBusiness = {} }) {
  const queries = [];
  const db = {
    query: jest.fn(async (sql, params = []) => {
      queries.push({ sql: String(sql), params });
      // Part 2 select mentions retain_until AND embeds an erasure
      // subquery, so match its DISTINCT ON before either branch.
      if (sql.includes('DISTINCT ON')) {
        const rows = pageByCursor(dueStaff, params, (r) => [r.business_id, r.user_id]);
        return { rows };
      }
      if (sql.includes('FROM restaurant_erasure_requests er')) {
        const rows = pageByCursor(dueRequests, params, (r) => [r.requested_at, r.id]);
        return { rows };
      }
      if (sql.includes('SELECT retain_until FROM staff_offboarding_records')) {
        return { rows: [{ retain_until: '2020-01-01' }] };
      }
      if (sql.includes('FROM food_restaurants WHERE business_id')) {
        return { rows: restaurantsByBusiness[params[0]] || [] };
      }
      return { rows: [] };
    }),
  };
  return { db, queries };
}

// Simulates a keyset-paginated select: the stub honours the trailing
// LIMIT param and the (key > cursor) params the sweep passes, so a
// sweep that never pages returns the whole backlog in one call.
function pageByCursor(allRows, params, keyOf) {
  const limit = Number(params[params.length - 1]);
  const cursor = params.length > 1 ? params.slice(0, params.length - 1) : null;
  let rows = allRows;
  if (cursor) {
    rows = rows.filter((row) => {
      const key = keyOf(row);
      for (let i = 0; i < cursor.length; i += 1) {
        if (String(key[i]) > String(cursor[i])) return true;
        if (String(key[i]) < String(cursor[i])) return false;
      }
      return false;
    });
  }
  return rows.slice(0, Number.isSafeInteger(limit) && limit > 0 ? limit : allRows.length);
}

function dueRequest(id, userId) {
  return {
    id,
    business_id: 42,
    user_id: userId,
    requested_at: `2026-01-0${id}T00:00:00.000Z`,
  };
}

function duePerson(businessId, userId) {
  return { business_id: businessId, user_id: userId, retain_until: '2020-01-01' };
}

beforeEach(() => {
  jest.clearAllMocks();
  anonymizeFormerStaff.mockResolvedValue(OK_OUTCOME);
});

describe('Domain 8 #12: the retention sweep bounds its queries and reports errors', () => {
  test('a backlog larger than one batch is processed in bounded, cursor-paged batches', async () => {
    expect(SWEEP_BATCH_LIMIT).toBe(200);
    const requests = [dueRequest(1, USER_A), dueRequest(2, USER_B), dueRequest(3, USER_C), dueRequest(4, USER_D), dueRequest(5, USER_E)];
    const { db, queries } = makeDb({ dueRequests: requests });
    const result = await sweep(db, { batchLimit: 2 });

    expect(result.completedRequests).toBe(5);
    expect(result.errors).toEqual([]);

    const dueSelects = queries.filter(({ sql }) => sql.includes('SELECT er.* FROM restaurant_erasure_requests er'));
    // Three batches of at most 2, not one unbounded select.
    expect(dueSelects).toHaveLength(3);
    for (const { sql, params } of dueSelects) {
      expect(sql).toMatch(/LIMIT \$\d+/);
      expect(params[params.length - 1]).toBe(2);
    }
    // The second and third batches carry the last-processed cursor
    // (requested_at, id) of the previous batch.
    expect(dueSelects[1].params.slice(0, 2)).toEqual(['2026-01-02T00:00:00.000Z', 2]);
    expect(dueSelects[2].params.slice(0, 2)).toEqual(['2026-01-04T00:00:00.000Z', 4]);
  });

  test('due staff are processed in bounded, cursor-paged batches', async () => {
    const staff = [
      duePerson(42, USER_A), duePerson(42, USER_B), duePerson(43, USER_C),
    ];
    const { db, queries } = makeDb({ dueStaff: staff });
    const result = await sweep(db, { batchLimit: 2 });

    expect(result.autoAnonymized).toBe(3);
    expect(result.errors).toEqual([]);

    const staffSelects = queries.filter(({ sql }) => sql.includes('DISTINCT ON'));
    expect(staffSelects).toHaveLength(2);
    for (const { sql, params } of staffSelects) {
      expect(sql).toMatch(/LIMIT \$\d+/);
      expect(params[params.length - 1]).toBe(2);
    }
    expect(staffSelects[1].params.slice(0, 2)).toEqual([42, USER_B]);
  });

  test('a per-person failure does not stop the sweep and raises an incident', async () => {
    const requests = [dueRequest(1, USER_A), dueRequest(2, USER_B), dueRequest(3, USER_C)];
    const { db } = makeDb({
      dueRequests: requests,
      restaurantsByBusiness: { 42: [{ id: 7 }] },
    });
    anonymizeFormerStaff
      .mockResolvedValueOnce(OK_OUTCOME)
      .mockRejectedValueOnce(new Error('anonymize blew up'))
      .mockResolvedValueOnce(OK_OUTCOME);
    const result = await sweep(db, { batchLimit: 2 });

    expect(result.completedRequests).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].request_id).toBe(2);
    expect(result.incidentId).toBe(99);
    expect(recordIncident).toHaveBeenCalledTimes(1);
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'restaurant_retention_sweep_errors',
      severity: 'high',
    }));
  });

  test('a clean sweep raises no incident', async () => {
    const { db } = makeDb({ dueRequests: [dueRequest(1, USER_A)] });
    const result = await sweep(db, { batchLimit: 2 });
    expect(result.completedRequests).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.incidentId).toBeNull();
    expect(recordIncident).not.toHaveBeenCalled();
  });
});
