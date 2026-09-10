'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/supportAgentsController');

const USER_ID = '00000000-0000-4000-8000-000000000996';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function requestFor(role = 'support_agent') {
  return {
    params: { businessId: '42', agentId: 'agent-7' },
    query: {},
    body: {},
    user: { id: USER_ID, role },
  };
}

beforeEach(() => resetMocks());

describe('support agent business boundaries', () => {
  test('blocks an unrelated support agent from listing a business team', async () => {
    const req = requestFor();
    const res = response();

    await controller.listAgents(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM support_agents/.test(sql))).toBe(false);
  });

  test('allows a platform admin to view a business agent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'agent-7', employer_id: 'employer-1', business_id: 42, user_id: 'other-user' }] })
      .mockResolvedValueOnce({ rows: [{ skill_name: 'billing', proficiency_level: 'expert' }] });
    const req = requestFor('super_admin');
    const res = response();

    await controller.getAgent(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ id: 'agent-7', skills: [{ skill_name: 'billing', proficiency_level: 'expert' }] }),
    });
  });

  test('does not update an agent outside the requested business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = requestFor('super_admin');
    req.body = { status: 'inactive' };
    const res = response();

    await controller.updateAgentStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_agents/.test(sql))).toBe(false);
  });

  test('rejects oversized skill names before querying an agent', async () => {
    const req = requestFor('super_admin');
    req.body = { skillName: 'x'.repeat(101) };
    const res = response();

    await controller.addAgentSkill(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
