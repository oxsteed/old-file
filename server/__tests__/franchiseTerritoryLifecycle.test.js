'use strict';

describe('franchise territory helper lifecycle contract', () => {
  test('territory counts and lists only active, non-deleted helper accounts', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../controllers/franchiseTerritoryController'), 'utf8');
    // G12-B4 (D-648): the count joins users through the roster
    // (roster.user_id), the list through the profile (hp.user_id). The
    // invariant is the filter itself — active and non-deleted — in
    // both places, not the join's left side.
    const predicate = /u\.is_active = TRUE AND u\.deleted_at IS NULL/g;
    expect(src.match(predicate)).toHaveLength(2);
  });
});
