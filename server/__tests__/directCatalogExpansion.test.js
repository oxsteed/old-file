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

  test('stores multi-service quote selections with relational foreign keys', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '529_quote_request_catalog_services.sql'), 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS quote_request_services');
    expect(sql).toContain('REFERENCES quote_requests(id) ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES direct_catalog_services(id) ON DELETE RESTRICT');
    expect(sql).toContain('UNIQUE (quote_request_id, service_id)');
    expect(sql).toContain('idx_quote_request_services_service');
  });

  test('adds 8 everyday categories and 40 quote-based services with full locale coverage', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '611_direct_catalog_everyday_services.sql'), 'utf8');

    const categorySection = sql.slice(
      sql.indexOf('INSERT INTO direct_catalog_categories'),
      sql.indexOf('ON CONFLICT (slug) DO NOTHING;')
    );
    const categorySlugs = [...categorySection.matchAll(/^\s*\('([a-z-]+)', '\{/gm)].map((m) => m[1]);
    expect(categorySlugs.sort()).toEqual([
      'appliances', 'automotive', 'cleaning', 'hvac',
      'locksmith', 'moving', 'pest-control', 'tech-support',
    ]);

    const pairs = [...sql.matchAll(/^\s*'([a-z-]+)', '([a-z0-9-]+)',\s*$/gm)]
      .map((m) => ({ category: m[1], slug: m[2] }));
    expect(pairs).toHaveLength(40);
    expect(new Set(pairs.map((p) => p.slug)).size).toBe(40);
    const perCategory = pairs.reduce((counts, p) => {
      counts.set(p.category, (counts.get(p.category) || 0) + 1);
      return counts;
    }, new Map());
    expect(Object.fromEntries(perCategory)).toEqual({
      appliances: 5, hvac: 5, cleaning: 5, 'pest-control': 5,
      locksmith: 5, moving: 5, automotive: 5, 'tech-support': 5,
    });

    // Every service name/description block carries all five locales (80 blocks
    // each), and every category name carries all five locales (8 inline JSON).
    for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
      expect(sql.split(`'${locale}',`).length - 1).toBe(80);
      expect(sql.split(`"${locale}":`).length - 1).toBe(8);
    }

    // Quote-based (NULL price) and idempotent: never overwrites existing rows.
    expect(sql).toContain('ON CONFLICT (slug) DO NOTHING');
    expect(sql.match(/ON CONFLICT \(slug\) DO NOTHING/g)).toHaveLength(2);
    expect(sql).not.toContain('DO UPDATE SET');
  });
});
