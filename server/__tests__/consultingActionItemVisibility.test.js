'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/consultingActionItemsController');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(() => resetMocks());

describe('consulting action-item visibility', () => {
  test('customers only receive client-visible action items', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'customer-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Prepare documents', client_visible: true }] });
    const res = response();

    await controller.getSessionActionItems(
      { params: { sessionId: 'session-1' }, user: { id: 'customer-1', role: 'customer' } },
      res,
    );

    const listQuery = mockQuery.mock.calls[1][0];
    expect(listQuery).toContain('client_visible = TRUE');
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1, client_visible: true, completed: false }),
    ]);
  });

  test('admins retain internal and client-visible action items', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, title: 'Prepare documents', client_visible: true, status: 'pending' },
        { id: 2, title: 'Internal review', client_visible: false, status: 'pending' },
      ],
    });
    const res = response();

    await controller.getSessionActionItems(
      { params: { sessionId: 'session-1' }, user: { id: 'admin-1', role: 'admin' } },
      res,
    );

    const listQuery = mockQuery.mock.calls[0][0];
    expect(listQuery).not.toContain('client_visible = TRUE');
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 2 }),
    ]);
  });
});
