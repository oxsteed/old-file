#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { getDatabaseSslConfig } = require('../utils/databaseConfig');

const REQUIRED_LOCALES = ['en', 'es', 'fr', 'ht', 'ar'];
const EXPECTED_SERVICE_COUNT = 1000;
const EXPECTED_TOOL_COUNT = 40;
const EXPECTED_CATEGORY_COUNT = 5;
const EXPECTED_SERVICE_PER_CATEGORY = 200;
const EXPECTED_TOOLS_PER_CATEGORY = 8;
const CATEGORIES = ['electrical', 'plumbing', 'carpentry', 'painting', 'landscaping'];

function evaluateDirectCatalogChecks(rows) {
  const failures = [];
  const service = rows.service || {};
  const tool = rows.tool || {};
  const migrations = Number(rows.catalogMigrations || 0);
  const toolCategoryForeignKey = Number(rows.toolCategoryForeignKey || 0);

  const requireEqual = (label, actual, expected) => {
    if (Number(actual) !== expected) failures.push(`${label}=${actual}, expected ${expected}`);
  };

  requireEqual('serviceCount', service.total, EXPECTED_SERVICE_COUNT);
  requireEqual('serviceUniqueSlugs', service.uniqueSlugs, EXPECTED_SERVICE_COUNT);
  requireEqual('serviceCategories', service.categories, EXPECTED_CATEGORY_COUNT);
  for (const category of CATEGORIES) requireEqual(`serviceCategory[${category}]`, service.categoryCounts?.[category], EXPECTED_SERVICE_PER_CATEGORY);
  requireEqual('serviceLocalizedSafe', service.localizedSafe, EXPECTED_SERVICE_COUNT);
  requireEqual('serviceCoverage', service.coverage, EXPECTED_SERVICE_COUNT);
  requireEqual('serviceHistory', service.history, EXPECTED_SERVICE_COUNT);
  requireEqual('serviceDuplicateGroups', service.duplicateGroups, 0);
  requireEqual('toolCount', tool.total, EXPECTED_TOOL_COUNT);
  requireEqual('toolUniqueSlugs', tool.uniqueSlugs, EXPECTED_TOOL_COUNT);
  requireEqual('toolCategories', tool.categories, EXPECTED_CATEGORY_COUNT);
  for (const category of CATEGORIES) requireEqual(`toolCategory[${category}]`, tool.categoryCounts?.[category], EXPECTED_TOOLS_PER_CATEGORY);
  requireEqual('toolLocalizedSafe', tool.localizedSafe, EXPECTED_TOOL_COUNT);
  requireEqual('toolCoverage', tool.coverage, EXPECTED_TOOL_COUNT);
  requireEqual('catalogMigrations', migrations, 6);
  requireEqual('toolCategoryForeignKey', toolCategoryForeignKey, 1);

  return { ok: failures.length === 0, failures };
}

async function verifyLiveCatalog() {
  const databaseUrl = String(process.env.DATABASE_URL || '');
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (process.env.DIRECT_CATALOG_VERIFY_LIVE !== 'true') {
    throw new Error('Refusing to inspect a database unless DIRECT_CATALOG_VERIFY_LIVE=true is set explicitly');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(databaseUrl, process.env.NODE_ENV),
    max: 2,
  });
  try {
    const [serviceResult, toolResult, serviceCategoryResult, toolCategoryResult, migrationResult, constraintResult] = await Promise.all([
      pool.query(`
        SELECT
          count(*) AS total,
          count(DISTINCT slug) AS unique_slugs,
          count(DISTINCT category_id) AS categories,
          count(*) FILTER (WHERE name_i18n ? ALL($1::text[]) AND description_i18n ? ALL($1::text[])
            AND price_cents IS NULL AND currency_code = 'USD'
            AND is_active AND is_published AND lifecycle_status = 'live'
            AND is_operationally_available AND NOT is_bookable) AS localized_safe,
          count(*) FILTER (WHERE NULLIF(BTRIM(service_area), '') IS NOT NULL) AS coverage,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM catalog_status_history h
            WHERE h.item_type = 'service' AND h.item_id = direct_catalog_services.id
              AND h.to_status = 'live'
          )) AS history,
          (SELECT count(*) FROM (
            SELECT category_id, lower(trim(name_i18n->>'en'))
            FROM direct_catalog_services
            GROUP BY category_id, lower(trim(name_i18n->>'en'))
            HAVING count(*) > 1
          ) duplicates) AS duplicate_groups
        FROM direct_catalog_services
        WHERE slug LIKE 'direct-%'`, [REQUIRED_LOCALES]),
      pool.query(`
        SELECT
          count(*) AS total,
          count(DISTINCT slug) AS unique_slugs,
          count(DISTINCT category_slug) AS categories,
          count(*) FILTER (WHERE name_i18n ? ALL($1::text[]) AND description_i18n ? ALL($1::text[])
            AND is_active AND is_published AND lifecycle_status = 'live'
            AND is_operationally_available AND NOT is_bookable) AS localized_safe,
          count(*) FILTER (WHERE NULLIF(BTRIM(service_area), '') IS NOT NULL) AS coverage
        FROM direct_catalog_tools`, [REQUIRED_LOCALES]),
      pool.query(`
        SELECT c.slug, count(s.id)::int AS count
        FROM direct_catalog_categories c
        LEFT JOIN direct_catalog_services s
          ON s.category_id = c.id AND s.slug LIKE 'direct-%'
        WHERE c.slug = ANY($1::text[])
        GROUP BY c.slug`, [CATEGORIES]),
      pool.query(`
        SELECT c.slug, count(t.id)::int AS count
        FROM direct_catalog_categories c
        LEFT JOIN direct_catalog_tools t ON t.category_slug = c.slug
        WHERE c.slug = ANY($1::text[])
        GROUP BY c.slug`, [CATEGORIES]),
      pool.query(`
        SELECT count(*) AS count
        FROM _migrations
        WHERE filename IN (
          '523_direct_catalog_expansion.sql',
          '524_direct_catalog_tools.sql',
          '525_direct_catalog_1000_services.sql',
          '526_direct_catalog_tools_expansion.sql',
          '527_direct_catalog_tool_category_fk.sql',
          '528_direct_catalog_service_coverage.sql'
        )`),
      pool.query(`
        SELECT count(*) AS count
        FROM pg_constraint
        WHERE conname = 'direct_catalog_tools_category_slug_fkey'
          AND conrelid = 'direct_catalog_tools'::regclass
          AND confrelid = 'direct_catalog_categories'::regclass`),
    ]);

    const normalize = (row) => ({
      total: Number(row.total || 0),
      uniqueSlugs: Number(row.unique_slugs || 0),
      categories: Number(row.categories || 0),
      localizedSafe: Number(row.localized_safe || 0),
      coverage: Number(row.coverage || 0),
      history: Number(row.history || 0),
      duplicateGroups: Number(row.duplicate_groups || 0),
    });
    const rows = {
      service: normalize(serviceResult.rows[0] || {}),
      tool: normalize(toolResult.rows[0] || {}),
      serviceCategoryCounts: Object.fromEntries(serviceCategoryResult.rows.map((row) => [row.slug, Number(row.count || 0)])),
      toolCategoryCounts: Object.fromEntries(toolCategoryResult.rows.map((row) => [row.slug, Number(row.count || 0)])),
      catalogMigrations: Number(migrationResult.rows[0]?.count || 0),
      toolCategoryForeignKey: Number(constraintResult.rows[0]?.count || 0),
    };
    rows.service.categoryCounts = rows.serviceCategoryCounts;
    rows.tool.categoryCounts = rows.toolCategoryCounts;
    const result = evaluateDirectCatalogChecks(rows);
    if (!result.ok) throw new Error(`Direct catalog verification failed: ${result.failures.join('; ')}`);
    return { ...result, rows };
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  verifyLiveCatalog()
    .then((result) => {
      console.log(`Direct catalog verification passed: services=${result.rows.service.total} tools=${result.rows.tool.total} categories=${result.rows.service.categories}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { evaluateDirectCatalogChecks, verifyLiveCatalog };
