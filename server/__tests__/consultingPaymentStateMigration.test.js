'use strict';

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '599_consulting_payment_terminal_integrity.sql'),
  'utf8'
);

describe('consulting payment terminal integrity migration', () => {
  test('installs a status transition trigger', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION enforce_consulting_payment_terminal_integrity()');
    expect(migration).toContain('BEFORE UPDATE OF status ON consulting_payments');
    expect(migration).toContain('CREATE TRIGGER consulting_payment_terminal_integrity_guard');
  });

  test('allows the approved completion-to-refund transition but blocks resurrection', () => {
    expect(migration).toContain("OLD.status = 'refunded' AND NEW.status <> 'refunded'");
    expect(migration).toContain("OLD.status = 'completed' AND NEW.status NOT IN ('completed', 'refunded')");
  });
});
