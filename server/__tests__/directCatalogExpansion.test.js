'use strict';

const fs = require('fs');
const path = require('path');

function valuesSection(filename, marker) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', filename), 'utf8');
  const start = sql.indexOf('VALUES');
  const end = sql.indexOf(marker, start);
  if (start < 0 || end < 0) throw new Error(`Could not locate values section in ${filename}`);
  return sql.slice(start, end);
}

describe('Direct catalog expansion artifacts', () => {
  test('contains 1,000 unique localized, quote-based service seeds', () => {
    const section = valuesSection('525_direct_catalog_1000_services.sql', '),\ninserted AS (');
    const rows = section.split('\n').filter((line) => line.startsWith("('"));
    const slugs = rows.map((line) => line.match(/^\('[^']+', '([^']+)'/)[1]);
    const categoryCounts = rows.reduce((counts, line) => {
      const category = line.match(/^\('([^']+)'/)[1];
      counts.set(category, (counts.get(category) || 0) + 1);
      return counts;
    }, new Map());

    expect(rows).toHaveLength(1000);
    expect(new Set(slugs).size).toBe(1000);
    expect(Object.fromEntries(categoryCounts)).toEqual({ electrical: 200, plumbing: 200, carpentry: 200, painting: 200, landscaping: 200 });
    expect(rows.filter((row) => row.includes('NULL::INTEGER') && row.includes("'USD'")).length).toBe(1000);
    expect(rows.filter((row) => ['"en":', '"es":', '"fr":', '"ht":', '"ar":'].every((locale) => row.includes(locale))).length).toBe(1000);
  });

  test('contains 25 unique localized supporting tools', () => {
    const section = valuesSection('526_direct_catalog_tools_expansion.sql', '),\ninserted AS (');
    const rows = section.split('\n').filter((line) => line.trim().startsWith("('"));
    const slugs = rows.map((line) => line.match(/^\s*\('[^']+', '([^']+)'/)[1]);

    expect(rows).toHaveLength(25);
    expect(new Set(slugs).size).toBe(25);
    expect(rows.filter((row) => ['"en":', '"es":', '"fr":', '"ht":', '"ar":'].every((locale) => row.includes(locale))).length).toBe(25);
  });

  test('does not overwrite existing records on expansion slug collisions', () => {
    const serviceSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '525_direct_catalog_1000_services.sql'), 'utf8');
    const toolSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '526_direct_catalog_tools_expansion.sql'), 'utf8');

    expect(serviceSql).toContain('ON CONFLICT (slug) DO NOTHING');
    expect(toolSql).toContain('ON CONFLICT (slug) DO NOTHING');
    expect(toolSql).not.toContain('DO UPDATE SET');
    expect(serviceSql).toContain('FROM inserted;');
    expect(toolSql).toContain('FROM inserted;');
  });

  test('enforces assigned tool categories at the database boundary', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '527_direct_catalog_tool_category_fk.sql'), 'utf8');

    expect(sql).toContain("RAISE EXCEPTION 'direct catalog contains tool rows with unknown category slugs'");
    expect(sql).toContain('direct_catalog_tools_category_slug_fkey');
    expect(sql).toContain('REFERENCES direct_catalog_categories (slug)');
    expect(sql).toContain('ON DELETE SET NULL');
  });

  test('fills only missing coverage metadata in the forward migration', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '528_direct_catalog_service_coverage.sql'), 'utf8');

    expect(sql).toContain("WHERE slug LIKE 'direct-%'");
    expect(sql).toContain("NULLIF(BTRIM(service_area), '') IS NULL");
    expect(sql).toContain('exact location confirmed before quote');
    expect(sql).toContain('AND is_published = TRUE');
  });
});
