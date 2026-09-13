'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { hardDeleteExpiredAccounts } = require('../jobs/scheduledDeletionJob');

beforeEach(resetMocks);

test('anonymizes users with OxSteed Credit records instead of deleting financial identity', async () => {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'customer@example.com',
    first_name: 'Customer',
    last_name: 'Example',
    deletion_scheduled_at: '2026-09-12T03:00:00.000Z',
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [user] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] })
    .mockResolvedValueOnce({ rows: [{ has_credit_records: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  await hardDeleteExpiredAccounts();

  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM users'))).toBe(false);
  const anonymizeCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes("email = CONCAT('deleted_'"));
  expect(anonymizeCall).toBeTruthy();
  expect(anonymizeCall[1]).toEqual([user.id]);
  expect(mockQuery.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true);
});
