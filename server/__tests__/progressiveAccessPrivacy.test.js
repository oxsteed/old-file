'use strict';

const { mockQuery, resetMocks } = require('./setup');
const privacy = require('../services/access/privacy');

beforeEach(() => resetMocks());

test('exports applicant-safe requests, grants, and decision history without reviewer notes', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 1, capability: 'helper.offer_services', status: 'approved' }] })
    .mockResolvedValueOnce({ rows: [{ capability: 'helper.offer_services', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [{ request_id: 1, action: 'approve', actor_type: 'reviewer' }] });

  const result = await privacy.exportData({ query: mockQuery }, 'user-1');
  expect(result.progressive_access_requests).toHaveLength(1);
  expect(result.progressive_access_grants).toHaveLength(1);
  expect(result.progressive_access_decisions).toHaveLength(1);
  const sql = mockQuery.mock.calls.map(([statement]) => String(statement)).join('\n');
  expect(sql).not.toMatch(/internal_note/);
  expect(sql).not.toMatch(/actor_id/);
});

test('revokes active grants, advances projection, and stops pending access notifications', async () => {
  mockQuery
    .mockResolvedValueOnce({ rowCount: 2 })
    .mockResolvedValueOnce({ rowCount: 1 })
    .mockResolvedValueOnce({ rowCount: 1 });

  await expect(privacy.revokeForDeletion({ query: mockQuery }, 'user-1')).resolves.toEqual({ revokedGrants: 2 });
  expect(mockQuery).toHaveBeenCalledTimes(3);
  expect(mockQuery.mock.calls[0][0]).toMatch(/status_reason_code = 'account_deleted'/);
  expect(mockQuery.mock.calls[1][0]).toMatch(/access_projection_versions/);
  expect(mockQuery.mock.calls[2][0]).toMatch(/status = 'failed'/);
});
