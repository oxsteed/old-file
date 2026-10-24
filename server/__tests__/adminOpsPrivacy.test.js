'use strict';
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../jobs/scheduledDeletionJob', () => ({ hardDeleteUser: jest.fn() }));
jest.mock('../services/accountDeletionGuard', () => ({ findFinancialBlockers: jest.fn(), cancelSubscriptionsForDeletion: jest.fn() }));
const erasure = require('../services/ccpaErasureService');
const deletion = require('../jobs/scheduledDeletionJob');
const guard = require('../services/accountDeletionGuard');
beforeEach(() => { resetMocks(); deletion.hardDeleteUser.mockReset(); guard.findFinancialBlockers.mockResolvedValue([]); });
test('deletion completion queues erasure without a completion stamp', async () => {
  mockQuery.mockImplementation(async sql => ({ rows: sql.startsWith('SELECT * FROM ccpa_data_requests')
    ? [{ id: 5, user_id: 'subject', status: 'pending', request_type: 'deletion' }] : [] }));
  expect((await erasure.completeRequest(5, 'admin')).queued).toBe(true);
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO ccpa_erasure_jobs'))).toBe(true);
  const updates = mockQuery.mock.calls.filter(([sql]) => sql.includes('UPDATE ccpa_data_requests'));
  expect(updates[0][0]).toContain("status='processing'");
  expect(updates[0][0]).not.toContain('completed_at');
  expect(deletion.hardDeleteUser).not.toHaveBeenCalled();
});
test.each(['completed','denied','awaiting_user'])('completion skips %s records', async status => {
  mockQuery.mockImplementation(async sql => ({ rows: sql.startsWith('SELECT * FROM ccpa_data_requests') ? [{ id: 5, status }] : [] }));
  expect(await erasure.completeRequest(5,'admin')).toMatchObject({ skipped: true });
  expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
});
test.each([true,false])('failed/blocked erasure keeps the privacy request incomplete (financial blocker: %s)', async blocked => {
  const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ request_id: 5, subject_id: 'subject', attempts: 1 }] })
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }) };
  mockQuery.mockImplementation(async sql => ({ rows: sql.startsWith('SELECT id,role') ? [{ id: 'subject', role: 'customer' }] : [] }));
  guard.findFinancialBlockers.mockResolvedValue(blocked ? ['credit_balance'] : []);
  deletion.hardDeleteUser.mockRejectedValue(new Error('storage failure'));
  await erasure.processErasureJobs({ db });
  expect(db.query.mock.calls[1][1][2]).toBe(blocked ? 'needs_review' : 'pending');
  if (blocked) expect(deletion.hardDeleteUser).not.toHaveBeenCalled();
  else expect(deletion.hardDeleteUser).toHaveBeenCalledWith(expect.anything(), { throwOnError: true });
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes("status='completed'"))).toBe(false);
});
