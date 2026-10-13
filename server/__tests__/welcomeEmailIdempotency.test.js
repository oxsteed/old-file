'use strict';

const fs = require('fs');
const path = require('path');

test('welcome email idempotency key includes the account creation timestamp', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../utils/email.js'), 'utf8');
  expect(source).toContain('const welcomeGeneration = new Date(createdAt).toISOString();');
  expect(source).toContain('`welcome:${user.id}:${welcomeGeneration}`');
});
