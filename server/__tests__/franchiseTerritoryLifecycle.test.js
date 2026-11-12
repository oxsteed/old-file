'use strict';

describe('franchise territory helper lifecycle contract', () => {
  test('territory counts and lists only active, non-deleted helper accounts', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../controllers/franchiseTerritoryController'), 'utf8');
    const predicate = /JOIN users u ON u\.id = hp\.user_id AND u\.is_active = TRUE AND u\.deleted_at IS NULL/g;
    expect(src.match(predicate)).toHaveLength(2);
  });
});
