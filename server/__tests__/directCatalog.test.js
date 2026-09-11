'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  getCatalog,
  parseEntity,
  saveEntity,
} = require('../services/directCatalogService');
const { createDraft } = require('../services/directCatalogAI');

const completeName = {
  en: 'Ceiling Fan Installation',
  es: 'Instalación de ventiladores de techo',
  fr: 'Installation de ventilateur de plafond',
  ht: 'Enstalasyon vantilatè plafon',
  ar: 'تركيب مروحة سقف',
};

const completeDescription = {
  en: 'Ceiling fan installation for ceilings.',
  es: 'Instalación de ventiladores de techo.',
  fr: 'Installation de ventilateurs de plafond.',
  ht: 'Enstalasyon vantilatè plafon.',
  ar: 'تركيب مراوح السقف.',
};

beforeEach(() => resetMocks());

describe('Direct catalog', () => {
  test('allows incomplete drafts but blocks incomplete published records', () => {
    const draft = parseEntity('tool', {
      slug: 'new-tool',
      nameI18n: { en: 'New tool' },
      descriptionI18n: { en: 'A useful tool.' },
    });

    expect(draft.isPublished).toBe(false);
    expect(() => parseEntity('tool', {
      slug: 'new-tool',
      nameI18n: { en: 'New tool' },
      descriptionI18n: { en: 'A useful tool.' },
      isPublished: true,
    })).toThrow(/requires values for/);
  });

  test('normalizes safe service fields and preserves all published locales', () => {
    const result = parseEntity('service', {
      slug: 'ceiling fan installation',
      categoryId: 'category-1',
      nameI18n: completeName,
      descriptionI18n: completeDescription,
      priceCents: '7500',
      availabilityDays: ['Monday', 'Monday', 'Thursday'],
      iconKey: 'arbitrary-icon',
      isPublished: true,
    });

    expect(result.slug).toBe('ceiling-fan-installation');
    expect(result.priceCents).toBe(7500);
    expect(result.availabilityDays).toEqual(['Monday', 'Thursday']);
    expect(result.iconKey).toBe('wrench');
    expect(result.nameI18n).toEqual(completeName);
  });

  test('public catalog output excludes admin flags and localizes records', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cat-1', slug: 'electrical', name_i18n: { en: 'Electrical', es: 'Electricidad' }, icon_key: 'zap', sort_order: 1, is_active: true, is_published: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'svc-1', category_id: 'cat-1', slug: 'fan', name_i18n: { en: 'Fan', es: 'Ventilador' }, description_i18n: { en: 'Install fan.', es: 'Instalar ventilador.' }, price_cents: 7500, currency_code: 'USD', availability_days: ['Monday'], sort_order: 1, is_active: true, is_published: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'tool-1', slug: 'drill', name_i18n: { en: 'Drill', es: 'Taladro' }, description_i18n: { en: 'Power drill.', es: 'Taladro eléctrico.' }, icon_key: 'drill', availability_days: ['Monday'], sort_order: 1, is_active: true, is_published: true }], rowCount: 1 });

    const catalog = await getCatalog({ locale: 'es' });

    expect(catalog.categories[0]).toEqual(expect.objectContaining({ id: 'cat-1', name: 'Electricidad', iconKey: 'zap' }));
    expect(catalog.categories[0].services[0]).toEqual(expect.objectContaining({ name: 'Ventilador', description: 'Instalar ventilador.', priceCents: 7500 }));
    expect(catalog.tools[0]).toEqual(expect.objectContaining({ name: 'Taladro', description: 'Taladro eléctrico.' }));
    expect(catalog.categories[0]).not.toHaveProperty('isPublished');
    expect(catalog.tools[0]).not.toHaveProperty('isActive');
  });

  test('marks categories without live inventory as coming soon and live unavailable services as non-requestable', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { id: 'cat-1', slug: 'electrical', name_i18n: { en: 'Electrical' }, icon_key: 'zap', sort_order: 1, lifecycle_status: 'live', is_active: true, is_published: true },
        { id: 'cat-2', slug: 'plumbing', name_i18n: { en: 'Plumbing' }, icon_key: 'droplets', sort_order: 2, lifecycle_status: 'live', is_active: true, is_published: true },
      ], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ id: 'svc-1', category_id: 'cat-1', slug: 'fan', name_i18n: { en: 'Fan' }, description_i18n: { en: 'Install fan.' }, price_cents: null, currency_code: 'USD', available_days: ['Monday'], lifecycle_status: 'live', is_operationally_available: false, is_active: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    const catalog = await getCatalog({ locale: 'en' });

    expect(catalog.categories[0]).toEqual(expect.objectContaining({ lifecycleStatus: 'live', liveServiceCount: 1, availableServiceCount: 0 }));
    expect(catalog.categories[0].services[0]).toEqual(expect.objectContaining({ lifecycleStatus: 'live', isOperationallyAvailable: false, requestable: false }));
    expect(catalog.categories[1]).toEqual(expect.objectContaining({ lifecycleStatus: 'coming_soon', liveServiceCount: 0, availableServiceCount: 0 }));
  });

  test('requires the lifecycle path for customer-visible records', () => {
    expect(() => parseEntity('service', {
      slug: 'fan',
      categoryId: 'category-1',
      nameI18n: completeName,
      descriptionI18n: completeDescription,
      lifecycleStatus: 'not-a-phase',
    })).toThrow(/lifecycleStatus must be one of/);

    const planned = parseEntity('service', {
      slug: 'future-fan',
      categoryId: 'category-1',
      nameI18n: { en: 'Future fan' },
      descriptionI18n: { en: 'Planned service.' },
      lifecycleStatus: 'planned',
    });
    expect(planned.lifecycleStatus).toBe('planned');
    expect(planned.isPublished).toBe(false);
  });

  test('updates records and audit events in one transaction', async () => {
    const row = { id: 'tool-1', is_published: false };
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...row, is_published: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await saveEntity('tool', {
      slug: 'drill',
      nameI18n: completeName,
      descriptionI18n: completeDescription,
      isPublished: true,
    }, 'admin-1', 'tool-1');

    expect(result.is_published).toBe(true);
    expect(mockQuery.mock.calls.map(([sql]) => String(sql))).toEqual(expect.arrayContaining([
      'BEGIN',
      expect.stringContaining('SELECT is_published'),
      expect.stringContaining('UPDATE direct_catalog_tools'),
      expect.stringContaining('INSERT INTO direct_catalog_audit_events'),
      'COMMIT',
    ]));
    expect(mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO direct_catalog_audit_events'))[1][1]).toBe('publish');
  });

  test('falls back to manual entry when no AI provider key is configured', async () => {
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const openAIKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await expect(createDraft('Add a service')).rejects.toMatchObject({ statusCode: 503 });
    if (openRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = openRouterKey;
    if (openAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = openAIKey;
  });
});
