'use strict';

describe('franchise owner lifecycle contract', () => {
  test('assignment and activation both require an active, non-deleted owner', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../controllers/franchiseController'), 'utf8');
    const predicate = /WHERE id = \$1 AND is_active = TRUE AND deleted_at IS NULL/g;
    // Four paths check the same predicate: owner assignment, owner activation,
    // and (D-346) the handoff incoming-operator check at initiation and again
    // at HQ approval. A handoff must never name a deactivated or deleted
    // account as the incoming operator.
    expect(src.match(predicate)).toHaveLength(4);
    expect(src).toContain("code: 'franchise_owner_unavailable'");
    expect(src).toContain("code: 'handoff_incoming_unavailable'");
  });
});
