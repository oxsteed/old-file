'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/skillBasedRoutingController');

const USER_ID = '00000000-0000-4000-8000-000000000993';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function requestFor(role = 'support_agent') {
  return {
    params: { businessId: '42', conversationId: 'conversation-7' },
    body: { requiredSkills: ['billing', 'returns'] },
    user: { id: USER_ID, role },
  };
}

beforeEach(() => resetMocks());

describe('skill-based routing business boundaries', () => {
  test('blocks an unrelated support agent before employer lookup', async () => {
    const req = requestFor();
    const res = response();

    await controller.findAgentBySkills(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_employers|agent_skills/.test(sql))).toBe(false);
  });

  test('rejects oversized skill input before routing', async () => {
    const req = requestFor('super_admin');
    req.body.requiredSkills = Array.from({ length: 51 }, (_, index) => `skill-${index}`);
    const res = response();

    await controller.findTeamBySkills(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('does not route a conversation outside the requested business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = requestFor('super_admin');
    const res = response();

    await controller.routeBySkills(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO conversation_assignments/.test(sql))).toBe(false);
  });

  test('allows a platform admin to read a business team match', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, team_name: 'Customer Care', matching_skills: '2' }] });
    const req = requestFor('super_admin');
    const res = response();

    await controller.findTeamBySkills(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 7, team_name: 'Customer Care', matching_skills: '2' },
    });
  });
});
