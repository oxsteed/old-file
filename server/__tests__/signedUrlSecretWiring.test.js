'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('boot environments forward SIGNED_URL_SECRET', () => {
  expect(read('.github/workflows/ci.yml')).toContain('CREDIT_TEST_SIGNED_URL_SECRET=$(openssl rand -hex 32)');
  expect(read('docker-compose.credit-test.yml')).toContain('SIGNED_URL_SECRET: ${CREDIT_TEST_SIGNED_URL_SECRET}');
  expect(read('scripts/credit-isolated-env.sh')).toContain('CREDIT_TEST_SIGNED_URL_SECRET=$(openssl rand -hex 32)');
  expect(read('docker-compose.coolify.yml')).toContain('SIGNED_URL_SECRET: ${SIGNED_URL_SECRET}');
});
