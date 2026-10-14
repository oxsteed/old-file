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
      // Review P2-7-F01: onboarding truth is re-derived from DB facts.
      .mockResolvedValueOnce({ rows: [{
        id: 'user-1', role: 'customer', email_verified: true,
        profile_completed: true, contact_completed: true,
        terms_accepted: true, terms_accepted_at: new Date(), terms_version: '2026-03-20',
        id_verified: true, identity_verified: true, didit_status: 'verified',
        background_check_status: null, background_check_passed: false,
        onboarding_completed: false, onboarding_status: 'verified_pending_onboarding',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'helper', default_mode: 'helper' }] });

    const user = await modeRole.applyModeSwitch(client, 'user-1', 'helper');

    expect(user).toMatchObject({ id: 'user-1', role: 'helper', default_mode: 'helper' });
    expect(client.query.mock.calls[1][0]).toMatch(/INSERT INTO helper_profiles/);
    expect(client.query.mock.calls[3][0]).toMatch(/UPDATE users/);
    // Facts are complete, so the switch keeps onboarding complete.
    expect(client.query.mock.calls[3][1]).toEqual(
      expect.arrayContaining(['user-1', 'helper', 'helper', true, 'onboarding_complete'])
    );
  });

  test('P2-7-F01: switching into helper mode with incomplete onboarding marks it incomplete', async () => {
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'customer', default_mode: 'customer' }] })
      .mockResolvedValueOnce({ rows: [] })
      // No verified identity in the facts: the customer-era flag must not survive.
      .mockResolvedValueOnce({ rows: [{
        id: 'user-1', role: 'customer', email_verified: true,
        profile_completed: false, contact_completed: false,
        terms_accepted: true, terms_accepted_at: new Date(), terms_version: '2026-03-20',
        id_verified: false, identity_verified: false, didit_status: 'pending',
        background_check_status: null, background_check_passed: false,
        onboarding_completed: true, onboarding_status: 'onboarding_complete',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'helper', default_mode: 'helper' }] });

    await modeRole.applyModeSwitch(client, 'user-1', 'helper');

    const updateCall = client.query.mock.calls[3];
    expect(updateCall[0]).toMatch(/UPDATE users/);
    expect(updateCall[1]).toEqual(
      expect.arrayContaining(['user-1', 'helper', 'helper', false, 'verified_pending_onboarding'])
    );
  });

  test('does not let a regular user enter admin mode', async () => {
    const req = {
      body: { mode: 'admin' },
      user: { id: 'user-1', role: 'customer', default_mode: 'customer' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis(),
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
      cookie: jest.fn().mockReturnThis(),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'customer', default_mode: 'customer' }] })
      .mockResolvedValueOnce({ rows: [] }) // helper_profiles
      .mockResolvedValueOnce({ rows: [] }) // P2-7-F01: onboarding fact re-derivation
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

  test('returns a useful conflict when Credit activity locks the customer role', async () => {
    const req = {
      body: { mode: 'helper' },
      user: { id: 'user-1', role: 'customer', default_mode: 'customer' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis(),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'customer', default_mode: 'customer' }] })
      .mockResolvedValueOnce({ rows: [] }) // helper_profiles
      .mockResolvedValueOnce({ rows: [] }) // P2-7-F01: onboarding fact re-derivation
      .mockRejectedValueOnce(Object.assign(new Error('A user with OxSteed Credit activity must remain a customer'), { code: '23514' }));

    await authController.switchRole(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'credit_customer_mode_locked',
      message: 'This account has OxSteed Credit activity and must remain in Customer mode.',
    });
  });
});
