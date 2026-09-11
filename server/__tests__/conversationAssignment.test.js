'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/conversationAssignmentController');
const supportEmployerService = require('../services/supportEmployerService');

const USER_ID = '00000000-0000-4000-8000-000000000998';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function requestFor() {
  return {
    params: { businessId: '42', conversationId: 'conversation-7' },
    body: { agentId: 'agent-7', newAgentId: 'agent-7' },
    user: { id: USER_ID, role: 'super_admin' },
  };
}

beforeEach(() => resetMocks());
afterEach(() => jest.restoreAllMocks());

describe('conversation assignment business boundaries', () => {
  test('does not assign a conversation outside the requested business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = response();

    await controller.assignToAgent(requestFor(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO conversation_assignments/.test(sql))).toBe(false);
  });

  test('does not release a conversation outside the requested business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = response();

    await controller.releaseConversation(requestFor(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE conversation_assignments/.test(sql))).toBe(false);
  });

  test('does not claim a merged conversation', async () => {
    jest.spyOn(supportEmployerService, 'findAgentForConversationBusiness')
      .mockResolvedValue({ id: 'agent-7' });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'conversation-7', business_id: '42', status: 'merged' }],
    });
    const res = response();

    await controller.claimConversation(requestFor(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
