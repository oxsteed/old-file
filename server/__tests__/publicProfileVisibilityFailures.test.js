'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { getPublicProfile } = require('../controllers/authController');

const response = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => resetMocks());

test('does not expose a profile when its listing visibility cannot be read', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'helper-1', first_name: 'Ada' }] })
    .mockRejectedValueOnce(new Error('database unavailable'));

  const res = response();
  await getPublicProfile({ params: { id: 'helper-1' } }, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch profile' });
  expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'helper-1' }));
});
