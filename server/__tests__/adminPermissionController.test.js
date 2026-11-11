'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/adminPermissionController');

const makeRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

beforeEach(() => resetMocks());

test('listMyGrants exposes valid delegated scopes to grant-aware admin clients', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'direct-1', permissions: ['view_search_logs'] }] })
    .mockResolvedValueOnce({ rows: [{ id: 'delegated-1', permissions: ['manage_support'], grant_source: 'delegated' }] });

  const res = makeRes();
  await controller.listMyGrants({ user: { id: 'admin-2' } }, res);

  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[1][0]).toContain('delegation_grants');
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    scopes: expect.arrayContaining(['view_search_logs', 'manage_support']),
    grants: expect.arrayContaining([expect.objectContaining({ grant_source: 'delegated' })]),
  }));
});
