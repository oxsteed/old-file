'use strict';

const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '989_restaurant_operational_store_identity.sql'),
  'utf8'
);

describe('operational store identity migration', () => {
  test('adds store identity to devices, kitchen, drawer, approval, and inventory records', () => {
    for (const table of [
      'restaurant_app_devices', 'display_pairings', 'restaurant_printer_settings',
      'restaurant_inventory_adjustments', 'restaurant_kitchen_stations',
      'restaurant_kitchen_events', 'restaurant_pos_drawer_events',
      'restaurant_pos_receipt_events', 'restaurant_pos_approvals',
      'restaurant_runner_settlements', 'restaurant_crew_tasks',
      'restaurant_crew_task_events',
    ]) {
      expect(sql).toContain(`ALTER TABLE ${table}`);
    }
    expect(sql).toContain('FOREIGN KEY (restaurant_id, location_id)');
    expect(sql).toContain('ALTER TABLE food_orders ALTER COLUMN location_id SET NOT NULL');
    expect(sql).toContain('ALTER TABLE restaurant_app_devices ALTER COLUMN location_id SET NOT NULL');
  });

  test('installs source-aware resolution and tenant fail-closed triggers', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION restaurant_fill_operational_location');
    expect(sql).toContain('restaurant_fill_operational_location()');
    expect(sql).toContain('TG_ARGV[0]');
    expect(sql).toContain("source_kind = 'order'");
    expect(sql).toContain("source_kind = 'shift'");
    expect(sql).toContain("source_kind = 'item'");
    expect(sql).toContain("RAISE EXCEPTION 'operational record requires a store belonging to the restaurant'");
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF restaurant_id, location_id');
  });
});
