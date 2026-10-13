'use strict';

/**
 * Route mocked pg queries by SQL text instead of call order, so tests stay
 * correct when transactions add BEGIN/COMMIT or locking reads.
 *
 *   routeQueries(mockQuery, [
 *     [/FROM users/, { rows: [user] }],
 *     [/SELECT \* FROM jobs WHERE id = \$1 FOR UPDATE/, { rows: [job] }],
 *     [/UPDATE jobs SET/, (sql, params) => ({ rows: [{ ...job, version: 2 }] })],
 *   ]);
 *
 * Unmatched queries resolve to { rows: [], rowCount: 0 }. Every call is
 * recorded in the returned `calls` array as { sql, params }.
 */
function routeQueries(mockQuery, routes) {
  const calls = [];
  mockQuery.mockImplementation(async (sqlOrConfig, params) => {
    const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : (sqlOrConfig?.text || '');
    calls.push({ sql, params });
    for (const [pattern, result] of routes) {
      if (pattern.test(sql)) {
        const value = typeof result === 'function' ? await result(sql, params, calls) : result;
        if (value instanceof Error) throw value;
        return value || { rows: [], rowCount: 0 };
      }
    }
    return { rows: [], rowCount: 0 };
  });
  return calls;
}

module.exports = { routeQueries };
