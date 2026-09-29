'use strict';

// BACKEND-2M regression: the ticket:join socket handler used `current_user`
// (a reserved keyword in Postgres) as an unquoted table alias, causing
// `syntax error at or near "current_user"`. The alias was renamed to `cu`.

const { resetMocks } = require('./setup');
const websocketService = require('../services/websocketService');

beforeEach(() => {
  resetMocks();
});

describe('websocketService ticket:join authorization query', () => {
  test('builds SQL without the reserved current_user alias', () => {
    const { text, params } = websocketService.buildTicketJoinQuery(
      'ticket-1',
      'user-2',
      'agent',
      'guest-4'
    );

    expect(/current_user/i.test(text)).toBe(false);
    expect(text).toMatch(/LEFT JOIN users cu/);
    expect(text).toMatch(/cu\.id IS NOT NULL/);
    expect(params).toEqual(['ticket-1', 'user-2', 'agent', 'guest-4']);
  });
});
