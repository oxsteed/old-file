'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { getAvailabilityBlocks } = require('../controllers/availabilityController');

const HELPER_ID = '11111111-1111-4111-8111-111111111111';

function mockRes() {
  const res = {};
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

async function invoke(profileRow) {
  resetMocks();
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM users u')) return Promise.resolve({ rows: profileRow ? [profileRow] : [] });
    if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: 0 }] });
    return Promise.resolve({ rows: [] });
  });
  const req = { params: { helper_id: HELPER_ID }, query: {} };
  const res = mockRes();
  const next = jest.fn();
  await getAvailabilityBlocks(req, res, next);
  return { res, next };
}

describe('public helper availability visibility', () => {
  test('rejects an unknown helper instead of reading orphaned blocks', async () => {
    const { res, next } = await invoke(null);
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  test('rejects an admin-hidden helper', async () => {
    const { res, next } = await invoke({
      id: HELPER_ID,
      is_active: true,
      email_verified: true,
      deleted_at: null,
      is_listed: true,
      is_hidden_by_admin: true,
    });
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  test('still serves availability for an active listed helper', async () => {
    const { res, next } = await invoke({
      id: HELPER_ID,
      is_active: true,
      email_verified: true,
      deleted_at: null,
      is_listed: true,
      is_hidden_by_admin: false,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ blocks: [], total: 0 }));
  });
});

