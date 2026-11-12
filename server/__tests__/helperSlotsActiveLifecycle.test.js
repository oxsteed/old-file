'use strict';

describe('helper slot visibility lifecycle contract', () => {
  test('public slot lookup requires an active, non-deleted helper account', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../controllers/helperAvailabilityController'), 'utf8');
    expect(src).toContain('u.is_active = TRUE');
    expect(src).toContain('u.deleted_at IS NULL');
    expect(src).toContain('COALESCE(hp.is_hidden_by_admin, FALSE) = FALSE');
  });
});
