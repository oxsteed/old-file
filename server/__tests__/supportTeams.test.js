'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/supportTeamsController');

const USER_ID = '00000000-0000-4000-8000-000000000991';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function requestFor(role = 'support_agent') {
  return {
    params: { businessId: '42', teamId: '7' },
    body: { teamName: 'Customer Care' },
    user: { id: USER_ID, role },
  };
}

beforeEach(() => resetMocks());

describe('support team business boundaries', () => {
  test('blocks a support agent from creating a business team', async () => {
    const req = requestFor();
    const res = response();

    await controller.createTeam(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_teams/.test(sql))).toBe(false);
  });

  test('allows a platform admin to create a team', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, business_id: 42, team_name: 'Customer Care' }],
    });
    const req = requestFor('super_admin');
    const res = response();

    await controller.createTeam(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 7, business_id: 42, team_name: 'Customer Care' },
    });
  });

  test('does not update a team from another business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = requestFor('super_admin');
    req.body = { teamName: 'Renamed Team' };
    const res = response();

    await controller.updateTeam(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_teams/.test(sql))).toBe(false);
  });

  test('does not add a member when the agent belongs to another business', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, business_id: 42, is_active: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const req = requestFor('super_admin');
    req.body = { agentId: 'agent-9', role: 'member' };
    const res = response();

    await controller.addMember(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO team_members/.test(sql))).toBe(false);
  });
});
