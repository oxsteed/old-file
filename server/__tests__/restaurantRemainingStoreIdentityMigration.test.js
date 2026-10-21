'use strict';

const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '990_restaurant_remaining_store_identity.sql'),
  'utf8'
);

describe('remaining store identity migration', () => {
  test('covers runner, screen, offline, reservation, and shift records', () => {
    for (const table of [
      'restaurant_runner_tasks', 'restaurant_screen_tickets',
      'restaurant_pos_pending_operations', 'restaurant_inventory_order_reservations',
      'restaurant_crew_shifts',
    ]) {
      expect(sql).toContain(`ALTER TABLE ${table}`);
      expect(sql).toContain(`ALTER TABLE ${table} ALTER COLUMN location_id SET NOT NULL`);
    }
    expect(sql).toContain("table_name || '_restaurant_location_fk'");
    expect(sql).toContain('restaurant_fill_operational_location(%L)');
  });
});
