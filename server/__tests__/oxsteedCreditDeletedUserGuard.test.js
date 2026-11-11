'use strict';

const fs = require('fs');
const path = require('path');

test('Credit wallet and transfer user guards include the deletion invariant', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'oxsteedCreditService.js'), 'utf8');
  expect(source).toMatch(/role IN \$\{walletOwnerRoles\} AND is_active = TRUE AND deleted_at IS NULL/);
  expect(source).toMatch(/customer\.role = 'customer' AND customer\.is_active = TRUE AND customer\.deleted_at IS NULL/);
  expect(source).toMatch(/role IN \$\{recipientRoles\} AND is_active = TRUE AND deleted_at IS NULL/);
  expect(source).toMatch(/owner\.is_active = TRUE AND owner\.deleted_at IS NULL/);
});
