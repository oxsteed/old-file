'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/lifeDashboardController');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(() => resetMocks());

describe('life task reference ownership', () => {
  test('rejects a create that references another user\'s vehicle', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = response();

    await controller.createHomeTask(
      { user: { id: 'user-1' }, body: { title: 'Service car', vehicle_id: 42 } },
      res,
    );

    expect(mockQuery.mock.calls[0][0]).toContain('FROM user_vehicles');
    expect(mockQuery.mock.calls[0][0]).toContain('user_id = $2');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'vehicle_not_found' }));
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO home_tasks/.test(sql))).toBe(false);
  });

  test('rejects an update that references another user\'s home', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = response();

    await controller.updateHomeTask(
      { user: { id: 'user-1' }, params: { id: 9 }, body: { home_id: 77 } },
      res,
    );

    expect(mockQuery.mock.calls[0][0]).toContain('FROM user_homes');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'home_not_found' }));
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE home_tasks/.test(sql))).toBe(false);
  });
});
