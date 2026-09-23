'use strict';

const { mockQuery, resetMocks } = require('./setup');
const modeRole = require('../utils/modeRole');
const authController = require('../controllers/authController');

beforeEach(() => resetMocks());

describe('mode role policy', () => {
  test('preserves administrative RBAC while changing the visible mode', () => {
    expect(modeRole.roleForMode('helper', { currentRole: 'admin' })).toBe('admin');
    expect(modeRole.roleForMode('customer', { currentRole: 'super_admin' })).toBe('super_admin');
  });

  test('rejects invalid modes before touching the database', async () => {
    const client = { query: jest.fn() };

    await expect(modeRole.applyModeSwitch(client, 'user-1', 'not-a-mode'))
      .rejects.toMatchObject({ code: 'invalid_mode' });
    expect(client.query).not.toHaveBeenCalled();
  });

  test('creates helper profile and updates the mode in one client flow', async () => {
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'customer', default_mode: 'customer' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'helper', default_mode: 'helper' }] });

    const user = await modeRole.applyModeSwitch(client, 'user-1', 'helper');

    expect(user).toMatchObject({ id: 'user-1', role: 'helper', default_mode: 'helper' });
    expect(client.query.mock.calls[1][0]).toMatch(/INSERT INTO helper_profiles/);
    expect(client.query.mock.calls[2][0]).toMatch(/UPDATE users/);
  });

  test('does not let a regular user enter admin mode', async () => {
    const req = {
      body: { mode: 'admin' },
      user: { id: 'user-1', role: 'customer', default_mode: 'customer' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await authController.switchRole(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'mode_not_granted' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('creates the replacement session before committing the mode change', async () => {
    const req = {
      body: { mode: 'helper' },
      user: {
        id: 'user-1',
        role: 'customer',
        default_mode: 'customer',
        first_name: 'Test',
        last_name: 'User',
        email: 'test@example.com',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'customer', default_mode: 'customer' }] })
      .mockResolvedValueOnce({ rows: [] }) // helper_profiles
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }) // users update
      .mockResolvedValueOnce({ rows: [{
        id: 'user-1',
        role: 'helper',
        default_mode: 'helper',
        first_name: 'Test',
        last_name: 'User',
        email: 'test@example.com',
        membership_tier: 'tier1',
        onboarding_completed: true,
      }] })
      .mockResolvedValueOnce({ rows: [] }) // invalidate sessions
      .mockResolvedValueOnce({ rows: [] }) // new session
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await authController.switchRole(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      user: expect.objectContaining({ default_mode: 'helper', role: 'helper' }),
    }));
    const sqlCalls = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls.findIndex((sql) => /INSERT INTO sessions/.test(sql)))
      .toBeLessThan(sqlCalls.findIndex((sql) => sql === 'COMMIT'));
  });
});
