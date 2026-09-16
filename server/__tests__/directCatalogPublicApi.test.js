const { evaluateBoundedCatalogPayload, evaluatePublicCatalogPayload } = require('../scripts/verify-direct-catalog-public-api');

describe('public Direct catalog API verifier', () => {
  test('accepts the expanded safe catalog shape', () => {
    const generated = Array.from({ length: 1000 }, (_, index) => {
      const category = ['electrical', 'plumbing', 'carpentry', 'painting', 'landscaping'][Math.floor(index / 200)];
      return { slug: `direct-${category}-${index}`, categorySlug: category, name: `Service ${index}`, description: 'Quote-based service.', serviceArea: 'Active Direct coverage areas; exact location confirmed before quote.', availabilityDays: ['Monday'], priceCents: null, currencyCode: 'USD', requestable: true, isBookable: false };
    });
    const categories = ['electrical', 'plumbing', 'carpentry', 'painting', 'landscaping'].map((slug) => ({ slug, services: generated.filter((service) => service.categorySlug === slug) }));
    const result = evaluatePublicCatalogPayload({ catalog: { locale: 'en', categories, tools: Array.from({ length: 40 }, (_, index) => ({ slug: `tool-${index}`, categorySlug: categories[index % 5].slug, name: `Tool ${index}`, description: 'Available supporting tool.', serviceArea: 'Active Direct coverage areas; exact location confirmed before quote.', availabilityDays: ['Monday'], isOperationallyAvailable: true })) } }, 'en');
    expect(result).toEqual({ ok: true, failures: [], serviceCount: 1000, toolCount: 40 });
  });

  test('rejects missing service relationships and duplicate public tool slugs', () => {
    const generated = Array.from({ length: 1000 }, (_, index) => {
      const category = ['electrical', 'plumbing', 'carpentry', 'painting', 'landscaping'][Math.floor(index / 200)];
      return { slug: `direct-${category}-${index}`, categorySlug: category, name: `Service ${index}`, description: 'Quote-based service.', availabilityDays: ['Monday'], priceCents: null, currencyCode: 'USD', requestable: true, isBookable: false };
    });
    generated[0].categorySlug = null;
    const categories = ['electrical', 'plumbing', 'carpentry', 'painting', 'landscaping'].map((slug) => ({ slug, services: generated.filter((service) => service.slug.startsWith(`direct-${slug}-`)) }));
    const tools = Array.from({ length: 40 }, (_, index) => ({ slug: `tool-${index}`, categorySlug: categories[index % 5].slug, name: `Tool ${index}`, description: 'Available supporting tool.', serviceArea: 'Active Direct coverage areas; exact location confirmed before quote.', availabilityDays: ['Monday'], isOperationallyAvailable: true }));
    tools[39].slug = tools[0].slug;

    const result = evaluatePublicCatalogPayload({ catalog: { locale: 'en', categories, tools } }, 'en');
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(['unknownServiceCategories=1', 'electricalGeneratedServices=199, expected 200', 'tool slugs are not unique']));
  });

  test('rejects unsafe generated services', () => {
    const result = evaluatePublicCatalogPayload({ catalog: { categories: [{ slug: 'electrical', services: [{ slug: 'direct-electrical-one', categorySlug: 'electrical', priceCents: 100, currencyCode: 'USD', requestable: true, isBookable: false }] }], tools: [] } });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(['categories=1, expected 5', 'generatedServices=1, expected 1000', 'unsafeGeneratedServices=1', 'tools=0, expected at least 40']));
  });

  test('accepts a bounded category page with preserved category totals', () => {
    const categories = [
      { slug: 'electrical', liveServiceCount: 208, services: Array.from({ length: 24 }, (_, index) => ({ slug: `direct-electrical-page-${index}` })) },
      { slug: 'plumbing', services: [] },
      { slug: 'carpentry', services: [] },
      { slug: 'painting', services: [] },
      { slug: 'landscaping', services: [] },
    ];
    const result = evaluateBoundedCatalogPayload({ catalog: { categories, servicePagination: { categorySlug: 'electrical', search: null, limit: 24, offset: 24 } }, durationMs: 120 }, { categorySlug: 'electrical', limit: 24, offset: 24 });
    expect(result).toEqual({ ok: true, failures: [], serviceCount: 24, durationMs: 120 });
  });

  test('rejects an unbounded response when a bounded page was requested', () => {
    const result = evaluateBoundedCatalogPayload({ catalog: { categories: [{ slug: 'electrical', liveServiceCount: 208, services: Array.from({ length: 25 }, (_, index) => ({ slug: `direct-electrical-page-${index}` })) }] } }, { categorySlug: 'electrical', limit: 24, offset: 24 });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(['bounded catalog pagination metadata is missing or incorrect', 'bounded electrical services=25, expected 1-24']));
  });
});
