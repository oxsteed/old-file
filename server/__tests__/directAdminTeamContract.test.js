'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { getTeam } = require('../controllers/directController');

function response() {
  const res = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => resetMocks());

test('admin team roster excludes inactive and soft-deleted accounts at the query boundary', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'admin-1', role: 'admin', is_active: true, deleted_at: null }] });
  const res = response();
  await getTeam({}, res);

  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ members: expect.any(Array) }));
  const [sql] = mockQuery.mock.calls[0];
  expect(sql).toMatch(/role IN \('admin', 'super_admin'\)/);
  expect(sql).toMatch(/is_active = true/i);
  expect(sql).toMatch(/deleted_at IS NULL/i);
});
