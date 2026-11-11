'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { checkScheduleAgreementGate } = require('../services/chatAgreements');

beforeEach(() => resetMocks());

test('agreement gate propagates database failures instead of allowing scheduling', async () => {
  mockQuery.mockRejectedValue(new Error('database connection lost'));

  await expect(checkScheduleAgreementGate({ query: mockQuery }, {
    conversationId: 'conversation-1',
  })).rejects.toThrow('database connection lost');
});

test('agreement gate still reports required blockers', async () => {
  mockQuery.mockResolvedValue({
    rows: [{
      id: 7,
      title: 'Service terms',
      status: 'shared',
      required_before_schedule: true,
      superseded_at: null,
    }],
  });

  await expect(checkScheduleAgreementGate({ query: mockQuery }, {
    conversationId: 'conversation-1',
  })).resolves.toEqual({
    blocked: true,
    agreements: [{
      id: 7,
      title: 'Service terms',
      status: 'shared',
      can_change_response: false,
    }],
  });
});

