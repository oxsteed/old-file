'use strict';

const { mockQuery, resetMocks } = require('./setup');
const SupportRoutingService = require('../services/supportRoutingService');

beforeEach(() => resetMocks());

describe('SupportRoutingService', () => {
  test('queries only active and available routable agents', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'agent-1',
        first_name: 'Ava',
        last_name: 'Agent',
        email: 'ava@example.com',
        is_active: true,
        is_available: true,
        max_concurrent_chats: 3,
        current_chats: 0,
      }],
    });

    const agents = await SupportRoutingService.findAgentsBySkill(['technical'], 8);

    expect(agents).toHaveLength(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/a\.is_available = true/);
    expect(sql).toMatch(/support_available_at > NOW\(\) - INTERVAL '2 minutes'/);
    expect(params).toEqual([8, ['technical']]);
  });

  test('filters agents synchronously by status, availability, and capacity', () => {
    const available = SupportRoutingService.filterByAvailability([
      { id: 'ready', is_active: true, is_available: true, current_chats: 1, max_concurrent_chats: 3 },
      { id: 'offline', is_active: true, is_available: false, current_chats: 0, max_concurrent_chats: 3 },
      { id: 'full', is_active: true, is_available: true, current_chats: 3, max_concurrent_chats: 3 },
    ]);

    expect(available.map((agent) => agent.id)).toEqual(['ready']);
  });

  test('routes an escalation to the available platform agent', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'agent-1',
        first_name: 'Ava',
        last_name: 'Agent',
        email: 'ava@example.com',
        is_active: true,
        is_available: true,
        max_concurrent_chats: 3,
        current_chats: 0,
      }],
    });

    const result = await SupportRoutingService.routeTicket({
      customerId: 'customer-1',
      businessId: 8,
      category: 'support_request',
      message: 'I need a person to review this issue.',
      priority: 'normal',
    });

    expect(result.routedTo).toBe('agent');
    expect(result.agentId).toBe('agent-1');
  });
});
