'use strict';

// Nov 3 audit item 3: applyAdminApprovedResolution must not overwrite an
// existing offer. Same-terms replay returns the existing case with no new
// event or notification; differing terms and terminal cases are 409s; the
// UPDATE itself carries the terminal-status predicate as a race backstop.
//
// No live database: the case is served by a fake client, so only the
// guard logic is exercised here.

const { mockQuery, resetMocks } = require('./setup');

const ctrl = require('../controllers/restaurantSupportController');

function fakeClient(caseRow, { updateRow = 'updated' } = {}) {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, params = []) => {
      queries.push(String(sql));
      const text = String(sql);
      if (text.includes('FROM restaurant_support_cases') && text.includes('JOIN food_restaurants')) {
        return { rows: caseRow ? [caseRow] : [] };
      }
      if (text.startsWith('UPDATE restaurant_support_cases')) {
        if (updateRow === 'none') return { rows: [] };
        return { rows: [{ ...caseRow, status: 'resolution_offered', final_resolution: params[1], resolution_amount_cents: params[2] }] };
      }
      return { rows: [] };
    }),
  };
}

beforeEach(() => { resetMocks(); });

const baseCase = {
  id: 7,
  restaurant_id: 3,
  customer_user_id: 'cust-1',
  status: 'open',
  final_resolution: null,
  resolution_amount_cents: null,
  currency_code: 'USD',
};

test('an open case takes the offer once, with one event and one notification', async () => {
  const client = fakeClient(baseCase);
  const updated = await ctrl.applyAdminApprovedResolution(client, {
    caseId: 7, resolution: 'refund', amount: 2500, adminId: 'admin-1',
  });
  expect(updated.status).toBe('resolution_offered');
  expect(updated.final_resolution).toBe('refund');
  expect(client.queries.filter((sql) => sql.includes('UPDATE restaurant_support_cases'))).toHaveLength(1);
  expect(client.queries.filter((sql) => sql.includes('INSERT INTO restaurant_support_case_events'))).toHaveLength(1);
  expect(client.queries.filter((sql) => sql.includes('INSERT INTO restaurant_support_notification_events'))).toHaveLength(1);
  expect(client.queries.find((sql) => sql.startsWith('UPDATE restaurant_support_cases')))
    .toMatch(/status NOT IN \('resolved', 'closed', 'canceled'\)/);
});

test('a same-terms replay returns the existing offer and writes nothing', async () => {
  const offered = { ...baseCase, status: 'resolution_offered', final_resolution: 'refund', resolution_amount_cents: 2500 };
  const client = fakeClient(offered);
  const result = await ctrl.applyAdminApprovedResolution(client, {
    caseId: 7, resolution: 'refund', amount: 2500, adminId: 'admin-2',
  });
  expect(result).toBe(offered);
  expect(client.queries.filter((sql) => sql.startsWith('UPDATE restaurant_support_cases'))).toHaveLength(0);
  expect(client.queries.filter((sql) => sql.includes('INSERT INTO restaurant_support_notification_events'))).toHaveLength(0);
});

test('differing terms on an offered case are a 409, not an overwrite', async () => {
  const offered = { ...baseCase, status: 'resolution_offered', final_resolution: 'refund', resolution_amount_cents: 2500 };
  const client = fakeClient(offered);
  await expect(ctrl.applyAdminApprovedResolution(client, {
    caseId: 7, resolution: 'refund', amount: 3000, adminId: 'admin-2',
  })).rejects.toMatchObject({ status: 409, code: 'case_resolution_terms_changed' });
  expect(client.queries.filter((sql) => sql.startsWith('UPDATE restaurant_support_cases'))).toHaveLength(0);
});

test('resolved, closed and canceled cases refuse a new resolution', async () => {
  for (const status of ['resolved', 'closed', 'canceled']) {
    const client = fakeClient({ ...baseCase, status });
    await expect(ctrl.applyAdminApprovedResolution(client, {
      caseId: 7, resolution: 'refund', amount: 2500, adminId: 'admin-1',
    })).rejects.toMatchObject({ status: 409, code: 'case_already_resolved' });
    expect(client.queries.filter((sql) => sql.startsWith('UPDATE restaurant_support_cases'))).toHaveLength(0);
  }
});

test('a case that closes between load and update is refused by the predicate', async () => {
  const client = fakeClient(baseCase, { updateRow: 'none' });
  await expect(ctrl.applyAdminApprovedResolution(client, {
    caseId: 7, resolution: 'refund', amount: 2500, adminId: 'admin-1',
  })).rejects.toMatchObject({ status: 409, code: 'case_already_resolved' });
  expect(client.queries.filter((sql) => sql.includes('INSERT INTO restaurant_support_notification_events'))).toHaveLength(0);
});
