'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATION = '539_food_restaurants_schema_health.sql';

describe('food_restaurants schema health migration 539', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', MIGRATION),
    'utf8',
  );

  test('re-asserts discovery and enrichment columns with IF NOT EXISTS', () => {
    for (const column of [
      'discovery_status',
      'is_accepting_orders_now',
      'dietary_tags',
      'avg_rating',
      'price_level',
      'is_featured',
      'brand_accent_hex',
      'operating_hours',
      'is_verified',
      'service_area_radius_meters',
      'temporarily_closed_until',
      'minimum_order_cents',
    ]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
    }
    expect(sql).toMatch(/Canonical name is discovery_status/);
    // No misspelled column identifiers in ADD/SET/WHERE clauses
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS discovery_staus\b/);
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS discover_status\b/);
  });

  test('is additive and includes constraint + index guards', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
    expect(sql).toContain('food_restaurants_discovery_status_allowed');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_food_restaurants_discovery_visibility');
    expect(sql).toContain('idx_food_restaurants_business_unique');
    expect(sql).toContain('HAVING COUNT(*) > 1');
    expect(sql).not.toMatch(/DROP TABLE\s+food_restaurants/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });
});
