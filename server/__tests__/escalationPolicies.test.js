'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/escalationPoliciesController');

const USER_ID = '00000000-0000-4000-8000-000000000992';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function requestFor(role = 'support_agent') {
  return {
    params: { businessId: '42', policyId: '7', conversationId: 'conversation-7' },
    body: { policyName: 'Urgent support', triggerCondition: 'wait_time' },
    user: { id: USER_ID, role },
  };
}

beforeEach(() => resetMocks());

describe('escalation policy business boundaries', () => {
  test('blocks a support agent from creating a business policy', async () => {
    const req = requestFor();
    const res = response();

    await controller.createPolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO escalation_policies/.test(sql))).toBe(false);
  });

  test('allows a platform admin to create a policy', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, business_id: 42, policy_name: 'Urgent support' }],
    });
    const req = requestFor('super_admin');
    const res = response();

    await controller.createPolicy(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 7, business_id: 42, policy_name: 'Urgent support' },
    });
  });

  test('does not update a policy from another business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = requestFor('super_admin');
    req.body = { policyName: 'Renamed policy' };
    const res = response();

    await controller.updatePolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE escalation_policies/.test(sql))).toBe(false);
  });

  test('does not trigger a conversation outside the requested business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = requestFor('super_admin');
    req.body = { policyId: '7', reason: 'Customer requested escalation' };
    const res = response();

    await controller.triggerEscalation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM escalation_policies/.test(sql))).toBe(false);
  });

  test('does not expose history for a conversation outside the business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = requestFor('super_admin');
    const res = response();

    await controller.getEscalationHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM escalation_history/.test(sql))).toBe(false);
  });
});
