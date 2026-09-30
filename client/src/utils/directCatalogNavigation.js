const DIRECT_SKILL_BY_CATEGORY = Object.freeze({
  electrical: 'electrical',
  plumbing: 'plumbing',
  hvac: 'hvac',
  carpentry: 'carpentry',
  painting: 'painting',
  landscaping: 'landscaping',
  cleaning: 'cleaning',
  moving: 'moving',
  roofing: 'roofing',
  flooring: 'flooring',
  'pest-control': 'pest-control',
  auto: 'auto',
  appliance: 'appliance',
  'appliance-repair': 'appliance',
  concrete: 'concrete',
  welding: 'welding',
  'home-repair': 'home-repair',
  security: 'security',
  'personal-services': 'pet-care',
});

export const DIRECT_CATALOG_VIEWS = Object.freeze({
  skills: Object.freeze({
    key: 'skills',
    path: '/direct/skills',
    dataSource: 'direct-catalog-categories',
    relatedRoutes: ['/direct/services', '/direct/tools'],
  }),
  services: Object.freeze({
    key: 'services',
    path: '/direct/services',
    dataSource: 'direct-catalog-services',
    relatedRoutes: ['/direct/request-quote', '/direct/book-slot'],
  }),
  tools: Object.freeze({
    key: 'tools',
    path: '/direct/tools',
    dataSource: 'direct-catalog-tools',
    relatedRoutes: ['/tool-rentals', '/direct/request-quote'],
  }),
});

function clean(value) {
  return String(value || '').trim().toLowerCase();
}

export function directSkillIdForCategory(categorySlug) {
  return DIRECT_SKILL_BY_CATEGORY[clean(categorySlug)] || '';
}

export function directCatalogHref(view, { categorySlug = '', skillId = '', search = '' } = {}) {
  const definition = DIRECT_CATALOG_VIEWS[view];
  if (!definition) throw new Error(`Unknown Direct catalog view: ${view}`);

  const params = new URLSearchParams();
  if (view === 'skills') {
    // The skills view is the category directory itself: every category is
    // listed, so there is no per-category filter to carry over. Only the
    // free-text search applies.
  } else if (categorySlug) {
    params.set('category', clean(categorySlug));
  }
  if (search) params.set('q', String(search).trim());
  const query = params.toString();
  return `${definition.path}${query ? `?${query}` : ''}`;
}

export function isDirectCatalogView(value) {
  return Boolean(DIRECT_CATALOG_VIEWS[value]);
}

