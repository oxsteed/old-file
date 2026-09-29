const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '595_food_order_terminal_integrity.sql'),
  'utf8'
);

describe('food order terminal integrity migration', () => {
  test('installs a trigger on both order and payment status changes', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION enforce_food_order_terminal_integrity()');
    expect(migration).toContain('BEFORE UPDATE OF status, payment_status ON food_orders');
    expect(migration).toContain('CREATE TRIGGER food_order_terminal_integrity_guard');
  });

  test('allows refunds but blocks terminal-order resurrection', () => {
    expect(migration).toContain("OLD.status = 'completed' AND NEW.status NOT IN ('completed', 'refunded')");
    expect(migration).toContain("OLD.status = 'cancelled' AND NEW.status NOT IN ('cancelled', 'refunded')");
    expect(migration).toContain("OLD.status = 'refunded' AND NEW.status <> 'refunded'");
    expect(migration).toContain("OLD.payment_status = 'refunded' AND NEW.payment_status <> 'refunded'");
  });
});
