'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
const pool = require('../db');
const media = require('../controllers/mediaController');

beforeEach(() => {
  jest.clearAllMocks();
});

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

test('getShellBadges returns spaces_unread count for authenticated users', async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ spaces_unread: 3 }] });
  const res = response();
  await media.getShellBadges({ user: { id: 'user-1' } }, res);
  expect(res.json).toHaveBeenCalledWith({ spaces_unread: 3 });
  expect(pool.query.mock.calls[0][0]).toContain('last_seen_at');
});

test('getShellBadges returns zero without a user', async () => {
  const res = response();
  await media.getShellBadges({ user: null }, res);
  expect(res.json).toHaveBeenCalledWith({ spaces_unread: 0 });
  expect(pool.query).not.toHaveBeenCalled();
});
