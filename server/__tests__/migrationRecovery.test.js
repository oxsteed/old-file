// Guards the 2026-09-30 startup outage: migration 611 inserted categories with
// columns (is_operationally_available, is_bookable, published_at) that no
// earlier migration had created on direct_catalog_categories, the runner
// recorded 611 as failed, and every later boot halted before opening the port.
const fs = require('fs');
const path = require('path');
const { listMigrationFiles, resolveMigrationPlan } = require('../migrate');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const REPAIR_FILE = '610b_direct_catalog_categories_operational_columns.sql';

// Columns known to exist on direct_catalog_categories after the repair:
// 390 created the base table, 414 added lifecycle_status + display_order,
// 610b adds the three operational columns 611/612 need.
const KNOWN_CATEGORY_COLUMNS = new Set([
  'id', 'slug', 'name_i18n', 'icon_key', 'sort_order', 'display_order',
  'is_active', 'is_published', 'lifecycle_status', 'is_operationally_available',
  'is_bookable', 'published_at', 'created_at', 'updated_at',
]);

function categoryInsertColumns(sql) {
  const matches = [...sql.matchAll(/INSERT INTO direct_catalog_categories\s*\(([^)]+)\)/gi)];
  return matches.map((m) => m[1].split(',').map((c) => c.trim().toLowerCase()));
}

describe('migration recovery (2026-09-30 outage)', () => {
  test('resolveMigrationPlan retries failed, aborts on applying, skips applied', () => {
    expect(resolveMigrationPlan({ status: 'applied' })).toBe('skip');
    expect(resolveMigrationPlan({ status: 'applying' })).toBe('abort');
    expect(resolveMigrationPlan({ status: 'failed' })).toBe('retry');
    expect(resolveMigrationPlan(undefined)).toBe('apply');
    expect(resolveMigrationPlan({ status: 'something-new' })).toBe('apply');
  });

  test('repair migration sorts between 610 and 611', () => {
    const files = listMigrationFiles(MIGRATIONS_DIR);
    const repairIdx = files.indexOf(REPAIR_FILE);
    const idx610 = files.indexOf('610_audit_chain_target_key_awareness.sql');
    const idx611 = files.indexOf('611_direct_catalog_everyday_services.sql');
    expect(repairIdx).toBeGreaterThan(-1);
    expect(idx610).toBeGreaterThan(-1);
    expect(idx611).toBeGreaterThan(-1);
    expect(repairIdx).toBeGreaterThan(idx610);
    expect(repairIdx).toBeLessThan(idx611);
  });

  test('repair migration adds the three missing category columns idempotently', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, REPAIR_FILE), 'utf8');
    expect(sql).toMatch(/ALTER TABLE direct_catalog_categories/i);
    for (const col of ['is_operationally_available', 'is_bookable', 'published_at']) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}`, 'i'));
    }
    // Backfills live categories without touching anything else.
    expect(sql).toMatch(/UPDATE direct_catalog_categories/i);
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM)\b/i);
  });

  test('611/612 category inserts only use columns that exist after the repair', () => {
    for (const file of ['611_direct_catalog_everyday_services.sql', '612_direct_catalog_remaining_skills.sql']) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const inserts = categoryInsertColumns(sql);
      expect(inserts.length).toBeGreaterThan(0);
      for (const cols of inserts) {
        for (const col of cols) {
          expect(KNOWN_CATEGORY_COLUMNS.has(col)).toBe(true);
        }
      }
    }
  });
});
