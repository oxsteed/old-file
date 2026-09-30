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
      'guest-3'
    );

    expect(/current_user/i.test(text)).toBe(false);
    expect(text).toMatch(/LEFT JOIN users cu/);
    expect(text).toMatch(/cu\.id IS NOT NULL/);
    expect(params).toEqual(['ticket-1', 'user-2', 'guest-3']);
  });

  // BACKEND-2V regression: the query once bound a fourth param (userRole) to
  // a $3 placeholder that never appeared in the SQL text, so PostgreSQL threw
  // "could not determine data type of parameter $3" on every ticket:join.
  // Every $N placeholder from 1..params.length must appear in the text.
  test('uses a contiguous placeholder sequence with no unused params', () => {
    const { text, params } = websocketService.buildTicketJoinQuery(
      'ticket-1',
      'user-2',
      'guest-3'
    );

    const referenced = new Set(
      Array.from(text.matchAll(/\$(\d+)/g), (m) => Number(m[1]))
    );
    for (let n = 1; n <= params.length; n += 1) {
      expect(referenced.has(n)).toBe(true);
    }
    expect(Math.max(...referenced)).toBe(params.length);
  });
});
