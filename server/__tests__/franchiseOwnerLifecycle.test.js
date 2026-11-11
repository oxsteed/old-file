'use strict';

describe('franchise owner lifecycle contract', () => {
  test('assignment and activation both require an active, non-deleted owner', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../controllers/franchiseController'), 'utf8');
    const predicate = /WHERE id = \$1 AND is_active = TRUE AND deleted_at IS NULL/g;
    expect(src.match(predicate)).toHaveLength(2);
    expect(src).toContain("code: 'franchise_owner_unavailable'");
  });
});
