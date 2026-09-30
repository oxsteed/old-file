'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATION = '612_direct_catalog_remaining_skills.sql';
const EXPECTED_CATEGORIES = [
  ['roofing', 'home'],
  ['flooring', 'layers'],
  ['concrete', 'hard-hat'],
  ['welding', 'flame'],
  ['home-repair', 'wrench'],
  ['security', 'shield'],
  ['pet-care', 'paw-print'],
  ['tutoring', 'graduation-cap'],
];
const LOCALES = ['en', 'es', 'fr', 'ht', 'ar'];

function readMigration() {
  return fs.readFileSync(path.join(__dirname, '..', 'migrations', MIGRATION), 'utf8');
}

// Extracts the opening lines "('category', 'slug'," of a VALUES list.
function seededRows(section) {
  return [...section.matchAll(/^\s*\(?'([a-z-]+)', '([a-z0-9-]+)',/gm)].map((m) => ({ category: m[1], slug: m[2] }));
}

describe('Direct catalog remaining-skills expansion', () => {
  test('seeds eight published quote-based categories', () => {
    const sql = readMigration();
    const section = sql.slice(sql.indexOf('VALUES'), sql.indexOf('ON CONFLICT (slug) DO NOTHING'));
    const rows = section.split('\n').filter((line) => line.trim().startsWith("('"));
    const slugs = rows.map((line) => line.match(/^\s*\(?'([^']+)'/)[1]);

    expect(rows).toHaveLength(8);
    expect(new Set(slugs).size).toBe(8);
    EXPECTED_CATEGORIES.forEach(([slug, icon]) => {
      expect(slugs).toContain(slug);
      expect(section).toContain(`'${icon}'`);
    });
    rows.forEach((row) => {
      LOCALES.forEach((locale) => expect(row).toContain(`"${locale}":`));
      expect(row).toContain("'live'");
    });
  });

  test('seeds 40 unique localized quote-based services, five per category', () => {
    const sql = readMigration();
    const servicesSection = sql.slice(
      sql.indexOf('WITH seeded(category_slug, slug, name_i18n, description_i18n, display_order)'),
      sql.indexOf('INSERT INTO direct_catalog_services')
    );
    const rows = seededRows(servicesSection);
    const slugs = rows.map((row) => row.slug);

    expect(rows).toHaveLength(40);
    expect(new Set(slugs).size).toBe(40);
    EXPECTED_CATEGORIES.forEach(([slug]) => {
      expect(rows.filter((row) => row.category === slug)).toHaveLength(5);
    });
    expect(sql).toContain('ON CONFLICT (slug) DO NOTHING');
  });

  test('seeds 32 unique localized category-linked tools, four per category', () => {
    const sql = readMigration();
    const toolsSection = sql.slice(
      sql.indexOf('WITH seeded(category_slug, slug, name_i18n, description_i18n, icon_key, display_order)'),
      sql.indexOf('RETURNING id, slug')
    );
    const rows = seededRows(toolsSection);
    const slugs = rows.map((row) => row.slug);

    expect(rows).toHaveLength(32);
    expect(new Set(slugs).size).toBe(32);
    EXPECTED_CATEGORIES.forEach(([slug]) => {
      expect(rows.filter((row) => row.category === slug)).toHaveLength(4);
    });
    EXPECTED_CATEGORIES.forEach(([, icon]) => {
      expect(sql).toContain(`'${icon}'`);
    });
  });

  test('never overwrites existing rows and records lifecycle history', () => {
    const sql = readMigration();

    expect(sql.match(/ON CONFLICT \(slug\) DO NOTHING/g).length).toBeGreaterThanOrEqual(3);
    expect(sql).not.toContain('DO UPDATE SET');
    expect(sql).toContain("SELECT 'category', c.id, NULL, 'live'");
    expect(sql).toContain("SELECT 'service', s.id, NULL, 'live'");
    expect(sql).toContain("SELECT 'tool', inserted.id, NULL, 'live'");
  });

  test('every service and tool name and description has all five locales', () => {
    const sql = readMigration();
    const jboBlocks = sql.match(/jsonb_build_object\(\n(?:.*\n)*?      \)/g) || [];
    // 40 services x 2 + 32 tools x 2 localized objects each
    expect(jboBlocks).toHaveLength(144);
    jboBlocks.forEach((block) => {
      LOCALES.forEach((locale) => expect(block).toContain(`'${locale}',`));
    });
  });
});
