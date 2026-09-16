'use strict';

const { evaluateDirectCatalogChecks } = require('../scripts/verify-direct-catalog-expansion');

const passingRows = {
  catalogMigrations: 6,
  toolCategoryForeignKey: 1,
  service: {
    total: 1000,
    uniqueSlugs: 1000,
    categories: 5,
    categoryCounts: { electrical: 200, plumbing: 200, carpentry: 200, painting: 200, landscaping: 200 },
    localizedSafe: 1000,
    coverage: 1000,
    history: 1000,
    duplicateGroups: 0,
  },
  tool: {
    total: 40,
    uniqueSlugs: 40,
    categories: 5,
    categoryCounts: { electrical: 8, plumbing: 8, carpentry: 8, painting: 8, landscaping: 8 },
    localizedSafe: 40,
    coverage: 40,
  },
};

describe('Direct catalog expansion verifier', () => {
  test('accepts the complete localized and lifecycle-safe inventory', () => {
    expect(evaluateDirectCatalogChecks(passingRows)).toEqual({ ok: true, failures: [] });
  });

  test('reports duplicate and incomplete inventory evidence', () => {
    const result = evaluateDirectCatalogChecks({
      ...passingRows,
      service: { ...passingRows.service, categoryCounts: { ...passingRows.service.categoryCounts, electrical: 199 }, duplicateGroups: 2, history: 998 },
      tool: { ...passingRows.tool, localizedSafe: 38 },
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      'serviceCategory[electrical]=199, expected 200',
      'serviceHistory=998, expected 1000',
      'serviceDuplicateGroups=2, expected 0',
      'toolLocalizedSafe=38, expected 40',
    ]));
  });
});
