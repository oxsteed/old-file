'use strict';

const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '988_restaurant_location_hierarchy.sql'),
  'utf8'
);

describe('restaurant location hierarchy migration', () => {
  test('creates a tenant-bound region tree and assigns existing stores to a root', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS restaurant_regions');
    expect(sql).toContain('FOREIGN KEY (restaurant_id, parent_region_id)');
    expect(sql).toContain('FOREIGN KEY (restaurant_id, region_id)');
    expect(sql).toContain("INSERT INTO restaurant_regions (restaurant_id, code, name)");
    expect(sql).toContain("'all-stores', 'All stores'");
    expect(sql).toContain('UPDATE restaurant_locations l');
  });

  test('defaults newly created locations to their brand root and rejects cross-tenant regions', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION restaurant_location_default_region()');
    expect(sql).toContain("RAISE EXCEPTION 'restaurant location region crosses a brand tenant'");
    expect(sql).toContain('CREATE TRIGGER restaurant_location_default_region');
    expect(sql).toContain('CREATE TRIGGER restaurant_default_region_created');
  });
});
