'use strict';

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '600_support_ticket_terminal_integrity.sql'),
  'utf8'
);

describe('support ticket terminal integrity migration', () => {
  test('installs a database-level terminal-state trigger', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION enforce_support_ticket_terminal_integrity()');
    expect(migration).toContain('BEFORE UPDATE OF status, resolved_at, closed_at ON support_tickets');
    expect(migration).toContain('CREATE TRIGGER support_ticket_terminal_integrity_guard');
  });

  test('allows only explicit reopen or close paths from terminal states', () => {
    expect(migration).toContain("OLD.status = 'closed' AND NEW.status NOT IN ('closed', 'open')");
    expect(migration).toContain("OLD.status = 'resolved' AND NEW.status NOT IN ('resolved', 'closed', 'open')");
    expect(migration).toContain("NEW.status = 'resolved' AND NEW.resolved_at IS NULL");
    expect(migration).toContain("NEW.status = 'closed' AND NEW.closed_at IS NULL");
  });
});
