'use strict';

const fs = require('fs');
const path = require('path');

test('card, admin entitlement, and recipient boundaries retain the deletion invariant', () => {
  const card = fs.readFileSync(path.join(__dirname, '..', 'services', 'oxsteedCreditCardService.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'services', 'oxsteedCreditAdminService.js'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'oxsteedCreditController.js'), 'utf8');
  expect(card).toMatch(/SELECT is_active, deleted_at FROM users/);
  expect(card).toMatch(/rows\[0\]\.deleted_at/);
  expect(admin).toMatch(/role = 'customer' AND is_active = TRUE AND deleted_at IS NULL/);
  expect(controller).toMatch(/role = 'customer' AND is_active = TRUE AND deleted_at IS NULL/);
});
