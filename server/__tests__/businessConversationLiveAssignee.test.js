'use strict';

describe('business conversation reassignment lifecycle contract', () => {
  test('reassignment requires a live user in addition to active membership', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../controllers/businessConversationAssignmentController'), 'utf8');
    expect(src).toContain('u.is_active = TRUE');
    expect(src).toContain('u.deleted_at IS NULL');
    expect(src).toMatch(/business_members bm[\s\S]*bm\.status = 'active'/);
  });
});
