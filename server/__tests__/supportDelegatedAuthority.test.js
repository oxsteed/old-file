'use strict';

const fs = require('fs');
const path = require('path');

test('support conversation access delegates authorization to the shared grant resolver', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/support.js'), 'utf8');
  expect(source).toContain("const { hasGlobalGrant } = require('../middleware/adminAuth');");
  expect(source).toContain("hasGlobalGrant(req.user.id, 'manage_support')");
  expect(source).not.toMatch(/SELECT 1 FROM admin_permission_grants[\s\S]*manage_support/);
});
