'use strict';

const db = require('../db');
const { deriveServiceCapability } = require('./directCapability');
const {
  loadPoolSizes,
  hasOfferableSlots,
  getServiceAssigneePool,
  setServiceAssigneePool,
} = require('./directSlotEngine');

const LOCALES = ['en', 'es', 'fr', 'ht', 'ar'];
const ICONS = new Set(['wrench', 'zap', 'droplets', 'hammer', 'paintbrush', 'trees', 'ruler', 'drill', 'truck', 'shield-check', 'refrigerator', 'air-vent', 'sparkles', 'bug', 'key-round', 'package', 'car', 'monitor-smartphone', 'home', 'layers', 'hard-hat', 'flame', 'shield', 'paw-print', 'graduation-cap']);
const DAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
const LIFECYCLE_STATUSES = ['planned', 'coming_soon', 'live', 'paused', 'retired'];
const PUBLIC_CATEGORY_STATUSES = ['coming_soon', 'live', 'paused'];
const PUBLIC_SERVICE_STATUS = 'live';
const PUBLIC_BROWSE_SERVICE_STATUSES = ['live', 'paused'];

function legacyLifecycle(row) {
  if (row?.lifecycle_status && LIFECYCLE_STATUSES.includes(row.lifecycle_status)) return row.lifecycle_status;
  if (row?.is_active && row?.is_published) return 'live';
  if (row?.is_active) return 'coming_soon';
  return 'planned';
}

function statusLabel(status) {
  return {
    planned: 'planned',
    coming_soon: 'coming_soon',
    live: 'live',
    paused: 'paused',
    retired: 'retired',
  }[status] || 'planned';
}

function cleanText(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function slugify(value) {
  return cleanText(value, 140).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeTranslations(value, max = 1000) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(LOCALES.map((locale) => [locale, cleanText(input[locale], max)]).filter(([, text]) => text));
}

function requireCompleteTranslations(value, field) {
  const translations = normalizeTranslations(value);
  const missing = LOCALES.filter((locale) => !translations[locale]);
  if (missing.length) {
    const error = new Error(`${field} requires values for: ${missing.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return translations;
}

function normalizeDays(value) {
  const days = Array.isArray(value) ? value : [];
  return [...new Set(days.map((day) => {
    const cleanDay = cleanText(day, 20);
    return [...DAYS].find((knownDay) => knownDay.toLowerCase() === cleanDay.toLowerCase()) || '';
  }).filter(Boolean))].slice(0, 7);
}

function iconKey(value) {
  const key = cleanText(value, 40).toLowerCase();
  return ICONS.has(key) ? key : 'wrench';
}

function localized(translations, locale, fallback = '') {
  const values = translations && typeof translations === 'object' ? translations : {};
  return values[locale] || values.en || fallback;
}

function daysFromRow(row) {
  if (Array.isArray(row?.available_days)) return row.available_days;
  return Array.isArray(row?.availability_days) ? row.availability_days : [];
}

function publicService(row, locale, capabilityOpts = {}) {
  const lifecycleStatus = legacyLifecycle(row);
  const isOperationallyAvailable = row?.is_operationally_available === undefined
    ? lifecycleStatus === 'live' && row?.is_active !== false && row?.is_published !== false
    : !!row.is_operationally_available;
  const parent = {
    lifecycle_status: row.category_lifecycle_status || row.parent_lifecycle_status || 'live',
    is_active: row.category_is_active !== undefined ? row.category_is_active : true,
  };
  const capability = deriveServiceCapability(
    { ...row, lifecycle_status: lifecycleStatus, is_operationally_available: isOperationallyAvailable },
    parent,
    { entity: 'service', ...capabilityOpts }
  );
  return {
    id: String(row.id),
    slug: row.slug,
    categorySlug: row.category_slug || null,
    name: localized(row.name_i18n, locale),
    description: localized(row.description_i18n, locale),
    priceCents: row.price_cents == null ? null : Number(row.price_cents),
    currencyCode: row.currency_code || 'USD',
    availabilityDays: daysFromRow(row),
    typicalWorkdays: daysFromRow(row),
    sortOrder: Number(row.display_order ?? row.sort_order ?? 0),
    lifecycleStatus: statusLabel(lifecycleStatus),
    isOperationallyAvailable: capability.isOperationallyAvailable,
    isBookable: capability.isBookable,
    // Legacy alias
    requestable: capability.requestable,
    visible: capability.visible,
    bookable: capability.bookable,
    capabilityReasons: capability.capabilityReasons,
    nextSlotStartsAt: capability.nextSlotStartsAt || null,
    slotsAvailable: !!capability.slotsAvailable && capability.bookable,
    capacityExhausted: !!capability.capacityExhausted,
    assigneePoolSize: capability.assigneePoolSize ?? null,
    serviceArea: row.service_area || null,
    bookingSlotMinutes: row.booking_slot_minutes == null ? 120 : Number(row.booking_slot_minutes),
  };
}

function publicTool(row, locale, capabilityOpts = {}) {
  const lifecycleStatus = legacyLifecycle(row);
  const isOperationallyAvailable = row?.is_operationally_available === undefined
    ? lifecycleStatus === 'live' && row?.is_active !== false && row?.is_published !== false
    : !!row.is_operationally_available;
  const parent = row.category_slug
    ? {
      lifecycle_status: row.category_lifecycle_status || 'live',
      is_active: row.category_is_active !== undefined ? row.category_is_active : true,
    }
    : { lifecycle_status: 'live', is_active: true };
  const capability = deriveServiceCapability(
    { ...row, lifecycle_status: lifecycleStatus, is_operationally_available: isOperationallyAvailable, is_bookable: false },
    parent,
    { entity: 'tool', toolsBookable: false, ...capabilityOpts }
  );
  return {
    id: String(row.id),
    slug: row.slug,
    categorySlug: row.category_slug || null,
    name: localized(row.name_i18n, locale),
    description: localized(row.description_i18n, locale),
    iconKey: row.icon_key || 'wrench',
    availabilityDays: daysFromRow(row),
    typicalWorkdays: daysFromRow(row),
    sortOrder: Number(row.display_order ?? row.sort_order ?? 0),
    lifecycleStatus: statusLabel(lifecycleStatus),
    isOperationallyAvailable: capability.isOperationallyAvailable,
    isBookable: false,
    requestable: capability.requestable,
    visible: capability.visible,
    bookable: false,
    capabilityReasons: capability.capabilityReasons,
    serviceArea: row.service_area || null,
  };
}

function adminCategory(row) {
  return {
    id: String(row.id), slug: row.slug, nameI18n: row.name_i18n || {}, iconKey: row.icon_key,
    sortOrder: Number(row.display_order ?? row.sort_order ?? 0), isActive: !!row.is_active, isPublished: !!row.is_published,
    lifecycleStatus: legacyLifecycle(row), displayOrder: Number(row.display_order ?? row.sort_order ?? 0),
  };
}

function adminService(row, pool = null) {
  const base = {
    id: String(row.id), categoryId: String(row.category_id), slug: row.slug,
    nameI18n: row.name_i18n || {}, descriptionI18n: row.description_i18n || {},
    priceCents: row.price_cents == null ? null : Number(row.price_cents), currencyCode: row.currency_code || 'USD',
    availabilityDays: daysFromRow(row),
    typicalWorkdays: daysFromRow(row),
    sortOrder: Number(row.display_order ?? row.sort_order ?? 0), displayOrder: Number(row.display_order ?? row.sort_order ?? 0),
    isActive: !!row.is_active, isPublished: !!row.is_published, lifecycleStatus: legacyLifecycle(row),
    isOperationallyAvailable: !!row.is_operationally_available, isBookable: !!row.is_bookable,
    serviceArea: row.service_area || '', pausedReason: row.paused_reason || '', isFeatured: !!row.is_featured,
    bookingSlotMinutes: row.booking_slot_minutes == null ? 120 : Number(row.booking_slot_minutes),
    requiredCrewSize: row.required_crew_size == null ? 1 : Number(row.required_crew_size),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
  if (pool) {
    base.assigneePool = {
      roles: pool.roles || [],
      userIds: pool.userIds || [],
      size: pool.size || 0,
      members: pool.members || [],
    };
  }
  return base;
}

function adminTool(row) {
  return {
    id: String(row.id), slug: row.slug, categorySlug: row.category_slug || null, nameI18n: row.name_i18n || {}, descriptionI18n: row.description_i18n || {},
    iconKey: row.icon_key, availabilityDays: daysFromRow(row),
    sortOrder: Number(row.display_order ?? row.sort_order ?? 0), displayOrder: Number(row.display_order ?? row.sort_order ?? 0),
    isActive: !!row.is_active, isPublished: !!row.is_published, lifecycleStatus: legacyLifecycle(row),
    isOperationallyAvailable: !!row.is_operationally_available, serviceArea: row.service_area || '', pausedReason: row.paused_reason || '', isFeatured: !!row.is_featured,
  };
}

function catalogReviewIssues(row, entity, duplicateIds = new Set()) {
  const issues = [];
  const names = row?.name_i18n && typeof row.name_i18n === 'object' ? row.name_i18n : {};
  for (const locale of LOCALES) {
    if (!cleanText(names[locale], 1000)) issues.push(`missing_name_${locale}`);
  }
  if (entity !== 'category') {
    const descriptions = row?.description_i18n && typeof row.description_i18n === 'object' ? row.description_i18n : {};
    for (const locale of LOCALES) {
      if (!cleanText(descriptions[locale], 1000)) issues.push(`missing_description_${locale}`);
    }
    if (!daysFromRow(row).length) issues.push('missing_availability');
    if (!cleanText(row.service_area, 255)) issues.push('missing_service_area');
    if (legacyLifecycle(row) === 'live' && row.is_operationally_available === false) issues.push('live_not_operational');
    if (entity === 'tool' && !cleanText(row.category_slug, 100)) issues.push('missing_tool_category');
    if (row.is_bookable === true && row.is_operationally_available === false) issues.push('bookable_not_requestable');
    if (entity === 'service' && row.is_bookable === true && Number(row.assignee_pool_size || 0) === 0 && !(row._pool_size > 0)) {
      issues.push('bookable_without_pool');
    }
  }
  const lifecycleStatus = legacyLifecycle(row);
  if (['coming_soon', 'live', 'paused'].includes(lifecycleStatus) && (row.is_active !== true || row.is_published !== true)) {
    issues.push('visibility_mismatch');
  }
  if (duplicateIds.has(String(row.id))) issues.push('duplicate_english_name');
  return issues;
}

function duplicateRecordIds(rows, entity) {
  const groups = new Map();
  for (const row of rows) {
    const englishName = cleanText(row?.name_i18n?.en, 1000).toLowerCase();
    if (!englishName) continue;
    const scope = entity === 'service'
      ? String(row.category_id || '')
      : entity === 'tool'
        ? String(row.category_slug || '')
        : 'category';
    const key = `${scope}:${englishName}`;
    const group = groups.get(key) || [];
    group.push(String(row.id));
    groups.set(key, group);
  }
  return new Set([...groups.values()].filter((group) => group.length > 1).flat());
}

function reviewAdminRecords(rows, entity) {
  const duplicateIds = duplicateRecordIds(rows, entity);
  const serializer = entity === 'category' ? adminCategory : entity === 'service' ? adminService : adminTool;
  return rows.map((row) => ({
    ...serializer(row),
    reviewIssues: catalogReviewIssues(row, entity, duplicateIds),
  }));
}

function buildCatalogReviewSummary(recordsByEntity) {
  const byEntity = {};
  const issueCounts = {};
  let total = 0;
  let needsReview = 0;
  for (const [entity, records] of Object.entries(recordsByEntity)) {
    const flagged = records.filter((record) => record.reviewIssues.length);
    byEntity[entity] = { total: records.length, needsReview: flagged.length, clean: records.length - flagged.length };
    total += records.length;
    needsReview += flagged.length;
    for (const record of flagged) {
      for (const issue of record.reviewIssues) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    }
  }
  return { total, needsReview, clean: total - needsReview, byEntity, issueCounts };
}

function parseCatalogInteger(value, field, { min = 0, max = 100 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d+$/.test(String(value))) {
    throw Object.assign(new Error(`${field} must be a whole number`), { statusCode: 400 });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw Object.assign(new Error(`${field} must be between ${min} and ${max}`), { statusCode: 400 });
  }
  return parsed;
}

function parseCatalogQuery(query = {}) {
  const rawView = cleanText(query.view, 20).toLowerCase();
  const view = ['services', 'tools'].includes(rawView) ? rawView : null;
  const rawLimit = query.serviceLimit ?? query.limit;
  const rawOffset = query.serviceOffset ?? query.offset;
  const serviceLimit = parseCatalogInteger(rawLimit, 'limit', { min: 1, max: 100 });
  const serviceOffset = parseCatalogInteger(rawOffset, 'offset', { min: 0, max: 100000 }) ?? 0;
  if (serviceLimit === null && serviceOffset !== 0) {
    throw Object.assign(new Error('offset requires limit'), { statusCode: 400 });
  }
  const rawToolLimit = query.toolLimit ?? (view === 'tools' ? query.limit : undefined);
  const rawToolOffset = query.toolOffset ?? (view === 'tools' ? query.offset : undefined);
  const toolLimit = parseCatalogInteger(rawToolLimit, 'toolLimit', { min: 1, max: 100 });
  const toolOffset = parseCatalogInteger(rawToolOffset, 'toolOffset', { min: 0, max: 100000 }) ?? 0;
  if (toolLimit === null && toolOffset !== 0) {
    throw Object.assign(new Error('toolOffset requires toolLimit'), { statusCode: 400 });
  }
  const rawCategory = query.categorySlug ?? query.category;
  const categorySlug = rawCategory ? slugify(rawCategory) || null : null;
  const rawSearch = query.search ?? query.q;
  const serviceSearch = cleanText(query.serviceSearch ?? (view === 'tools' ? '' : rawSearch), 100);
  const toolSearch = cleanText(query.toolSearch ?? (view === 'tools' ? rawSearch : ''), 100);
  return { view, categorySlug, serviceSearch, serviceLimit, serviceOffset, toolSearch, toolLimit, toolOffset };
}

async function getCatalog({ locale = 'en', includeUnpublished = false, view = null, categorySlug = null, serviceSearch = '', serviceLimit = null, serviceOffset = 0, toolSearch = '', toolLimit = null, toolOffset = 0 } = {}) {
  const safeLocale = LOCALES.includes(locale) ? locale : 'en';
  const safeCategorySlug = categorySlug ? slugify(categorySlug) || null : null;
  const safeSearch = cleanText(serviceSearch, 100);
  const safeLimit = serviceLimit == null ? null : parseCatalogInteger(serviceLimit, 'limit', { min: 1, max: 100 });
  const safeOffset = parseCatalogInteger(serviceOffset, 'offset', { min: 0, max: 100000 }) ?? 0;
  const safeToolSearch = cleanText(toolSearch, 100);
  const safeToolLimit = toolLimit == null ? null : parseCatalogInteger(toolLimit, 'toolLimit', { min: 1, max: 100 });
  const safeToolOffset = parseCatalogInteger(toolOffset, 'toolOffset', { min: 0, max: 100000 }) ?? 0;
  const browseStatuses = PUBLIC_BROWSE_SERVICE_STATUSES.map((status) => `'${status}'`).join(', ');
  const visibility = includeUnpublished
    ? ''
    : ` AND c.is_active = TRUE AND c.lifecycle_status IN (${PUBLIC_CATEGORY_STATUSES.map((status) => `'${status}'`).join(', ')})
        AND s.is_active = TRUE AND s.lifecycle_status IN (${browseStatuses})`;
  const toolWhere = includeUnpublished
    ? ['1 = 1']
    : [`t.is_active = TRUE AND t.lifecycle_status IN (${browseStatuses})`];
  const toolParams = [];
  if (safeToolSearch) {
    toolParams.push(safeLocale, `%${safeToolSearch}%`);
    toolWhere.push(`(
      COALESCE(t.name_i18n ->> $1, t.name_i18n ->> 'en', '') ILIKE $2
      OR COALESCE(t.description_i18n ->> $1, t.description_i18n ->> 'en', '') ILIKE $2
    )`);
  }
  if (safeCategorySlug) {
    toolParams.push(safeCategorySlug);
    toolWhere.push(`t.category_slug = $${toolParams.length}`);
  }
  const toolBounded = safeToolLimit !== null;
  if (toolBounded) toolParams.push(safeToolOffset, safeToolOffset + safeToolLimit);
  // The locale is only needed by localized search expressions. Avoid binding
  // an unused value on the default full-catalog query.
  const serviceParams = safeSearch ? [safeLocale] : [];
  const serviceWhere = ['1 = 1'];
  if (safeCategorySlug) {
    serviceParams.push(safeCategorySlug);
    serviceWhere.push(`c.slug = $${serviceParams.length}`);
  }
  if (safeSearch) {
    serviceParams.push(`%${safeSearch}%`);
    const searchParam = serviceParams.length;
    serviceWhere.push(`(
      COALESCE(s.name_i18n ->> $1, s.name_i18n ->> 'en', '') ILIKE $${searchParam}
      OR COALESCE(s.description_i18n ->> $1, s.description_i18n ->> 'en', '') ILIKE $${searchParam}
    )`);
  }
  const bounded = safeLimit !== null;
  if (bounded) serviceParams.push(safeOffset, safeOffset + safeLimit);
  const serviceQuery = view === 'tools' ? 'SELECT NULL::text AS id WHERE FALSE' : `
    SELECT catalog_rows.*
    FROM (
      SELECT s.*, c.slug AS category_slug,
        c.lifecycle_status AS category_lifecycle_status,
        c.is_active AS category_is_active,
        COUNT(*) OVER (PARTITION BY s.category_id) AS category_service_count,
        COUNT(*) FILTER (
          WHERE s.lifecycle_status = 'live'
            AND s.is_operationally_available = TRUE
        ) OVER (PARTITION BY s.category_id) AS category_available_service_count,
        COUNT(*) FILTER (
          WHERE s.lifecycle_status IN ('live', 'paused')
        ) OVER (PARTITION BY s.category_id) AS category_visible_service_count,
        ROW_NUMBER() OVER (
          ${view === 'services' && !safeCategorySlug ? '' : 'PARTITION BY s.category_id'}
          ORDER BY COALESCE(s.display_order, s.sort_order), s.created_at, s.id
        ) - 1 AS service_rank
      FROM direct_catalog_services s
      JOIN direct_catalog_categories c ON c.id = s.category_id
      WHERE ${serviceWhere.join(' AND ')}${visibility}
    ) AS catalog_rows
    ${bounded ? `WHERE service_rank >= $${serviceParams.length - 1} AND service_rank < $${serviceParams.length}` : ''}
    ORDER BY category_id, COALESCE(display_order, sort_order), created_at, id`;
  const toolQuery = view === 'services' ? 'SELECT NULL::text AS id WHERE FALSE' : `
    SELECT tool_rows.*
    FROM (
      SELECT t.*, c.lifecycle_status AS category_lifecycle_status, c.is_active AS category_is_active,
        COUNT(*) OVER () AS tool_total_count,
        ROW_NUMBER() OVER (ORDER BY COALESCE(t.display_order, t.sort_order), t.created_at, t.id) - 1 AS tool_rank
      FROM direct_catalog_tools t
      LEFT JOIN direct_catalog_categories c ON c.slug = t.category_slug
      WHERE ${toolWhere.join(' AND ')}
    ) AS tool_rows
    ${toolBounded ? `WHERE tool_rank >= $${toolParams.length - 1} AND tool_rank < $${toolParams.length}` : ''}
    ORDER BY COALESCE(display_order, sort_order), created_at, id`;
  // The per-view placeholder query ('SELECT NULL::text AS id WHERE FALSE') binds
  // no parameters. Passing the other view's params (category slug, search, or
  // pagination bounds) makes PostgreSQL reject the bind and the whole catalog
  // request 500s, so the placeholder query always runs with an empty array.
  const [{ rows: categories }, { rows: services }, { rows: tools }] = await Promise.all([
    db.query(`SELECT * FROM direct_catalog_categories c ${includeUnpublished ? '' : `WHERE c.is_active = TRUE AND c.lifecycle_status IN (${PUBLIC_CATEGORY_STATUSES.map((status) => `'${status}'`).join(', ')})`} ORDER BY COALESCE(c.display_order, c.sort_order), c.created_at`),
    db.query(serviceQuery, view === 'tools' ? [] : serviceParams),
    db.query(toolQuery, view === 'services' ? [] : toolParams),
  ]);
  const categoryMap = new Map(categories.map((row) => [String(row.id), {
    ...adminCategory(row), name: localized(row.name_i18n, safeLocale), services: [], liveServiceCount: 0, availableServiceCount: 0, visibleServiceCount: 0, bookableServiceCount: 0,
  }]));

  // Enrich capabilities. Prefer bookable services get pool + slot hints.
  // Soft-fail when capacity tables are not migrated yet so browse still works.
  const bookableCandidates = services.filter((row) => !!row.is_bookable);
  let poolMap = new Map(services.map((row) => [String(row.id), { size: 0, roles: [], userIds: [] }]));
  if (bookableCandidates.length) {
    try {
      poolMap = await loadPoolSizes(bookableCandidates.map((row) => String(row.id)));
    } catch (_) {
      // keep empty defaults
    }
  }
  const capabilityByService = new Map();
  for (const row of services) {
    const pool = poolMap.get(String(row.id)) || { size: 0 };
    const prefersBook = !!row.is_bookable;
    const operational = row.is_operationally_available === undefined
      ? true
      : !!row.is_operationally_available;
    const requestableBase = legacyLifecycle(row) === 'live'
      && operational
      && (row.category_lifecycle_status || 'live') === 'live';
    let slotsAvailable = false;
    let nextSlotStartsAt = null;
    let capacityExhausted = false;
    if (prefersBook && requestableBase && pool.size > 0) {
      try {
        const offer = await hasOfferableSlots(row.id);
        slotsAvailable = offer.slotsAvailable;
        nextSlotStartsAt = offer.nextSlotStartsAt;
        capacityExhausted = offer.capacityExhausted;
      } catch (_) {
        slotsAvailable = false;
      }
    } else if (prefersBook && requestableBase && pool.size === 0) {
      // preference on, no pool → not bookable (reason set in derive)
    }
    capabilityByService.set(String(row.id), {
      slotsAvailable,
      nextSlotStartsAt,
      capacityExhausted,
      assigneePoolSize: prefersBook ? pool.size : undefined,
      freeCapacityInHorizon: slotsAvailable,
    });
  }

  for (const row of services) {
    const category = categoryMap.get(String(row.category_id));
    if (category) {
      const service = publicService(row, safeLocale, capabilityByService.get(String(row.id)) || {});
      category.services.push(service);
      category.liveServiceCount = Math.max(category.liveServiceCount, Number(row.category_service_count || 0), category.services.length);
      category.availableServiceCount = Math.max(category.availableServiceCount, Number(row.category_available_service_count || 0));
      category.visibleServiceCount = Math.max(category.visibleServiceCount, Number(row.category_visible_service_count || 0), category.services.length);
      if (!row.category_service_count && service.requestable) category.availableServiceCount += 1;
      if (service.bookable) category.bookableServiceCount += 1;
    }
  }
  const catalog = {
    locale: safeLocale,
    categories: [...categoryMap.values()].map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      iconKey: category.iconKey,
      services: category.services,
      lifecycleStatus: category.liveServiceCount || category.lifecycleStatus === 'paused'
        ? category.lifecycleStatus
        : 'coming_soon',
      configuredLifecycleStatus: category.lifecycleStatus,
      liveServiceCount: category.liveServiceCount,
      availableServiceCount: category.availableServiceCount,
      visibleServiceCount: category.visibleServiceCount || category.liveServiceCount,
      bookableServiceCount: category.bookableServiceCount,
      requestableServiceCount: category.availableServiceCount,
    })),
    tools: tools.map((row) => publicTool(row, safeLocale)),
  };
  if (bounded || safeCategorySlug || safeSearch) {
    catalog.servicePagination = {
      categorySlug: safeCategorySlug,
      search: safeSearch || null,
      limit: safeLimit,
      offset: safeOffset,
      ...(view === 'services' ? {
        total: [...categoryMap.values()].reduce((sum, category) => sum + Number(category.visibleServiceCount || 0), 0),
      } : {}),
    };
  }
  if (toolBounded || (view === 'tools' && (safeCategorySlug || safeToolSearch))) {
    catalog.toolPagination = {
      categorySlug: safeCategorySlug,
      search: safeToolSearch || null,
      limit: safeToolLimit,
      offset: safeToolOffset,
      total: tools.length ? Number(tools[0].tool_total_count || tools.length) : 0,
    };
  }
  return catalog;
}

async function getAdminCatalog() {
  const [{ rows: categories }, { rows: services }, { rows: tools }] = await Promise.all([
    db.query('SELECT * FROM direct_catalog_categories ORDER BY COALESCE(display_order, sort_order), created_at'),
    db.query('SELECT * FROM direct_catalog_services ORDER BY COALESCE(display_order, sort_order), created_at'),
    db.query('SELECT * FROM direct_catalog_tools ORDER BY COALESCE(display_order, sort_order), created_at'),
  ]);
  let poolMap = new Map();
  try {
    poolMap = await loadPoolSizes(services.map((row) => String(row.id)));
  } catch (_) {
    poolMap = new Map(services.map((row) => [String(row.id), { size: 0, roles: [], userIds: [] }]));
  }
  const servicesWithPool = services.map((row) => {
    const pool = poolMap.get(String(row.id)) || { size: 0, roles: [], userIds: [], eligibleIds: [] };
    return { ...row, _pool_size: pool.size, assignee_pool_size: pool.size };
  });
  const reviewedServices = reviewAdminRecords(servicesWithPool, 'service').map((record) => {
    const pool = poolMap.get(String(record.id)) || { size: 0, roles: [], userIds: [] };
    return {
      ...record,
      assigneePool: {
        roles: pool.roles || [],
        userIds: pool.userIds || [],
        size: pool.size || 0,
      },
      bookingSlotMinutes: record.bookingSlotMinutes ?? 120,
      requiredCrewSize: record.requiredCrewSize ?? 1,
    };
  });
  const records = {
    categories: reviewAdminRecords(categories, 'category'),
    services: reviewedServices,
    tools: reviewAdminRecords(tools, 'tool'),
  };
  return { ...records, locales: LOCALES, icons: [...ICONS], review: { summary: buildCatalogReviewSummary(records) } };
}

function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw Object.assign(new Error('priceCents must be a non-negative integer'), { statusCode: 400 });
  return parsed;
}

function parseLifecycleStatus(value, fallback = 'planned') {
  const status = cleanText(value, 20).toLowerCase();
  if (!status) return fallback;
  if (!LIFECYCLE_STATUSES.includes(status)) {
    throw Object.assign(new Error(`lifecycleStatus must be one of: ${LIFECYCLE_STATUSES.join(', ')}`), { statusCode: 400 });
  }
  return status;
}

function parseBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function parseEntity(entity, body) {
  const data = body && typeof body === 'object' ? body : {};
  if (!['category', 'service', 'tool'].includes(entity)) throw Object.assign(new Error('Unsupported catalog entity'), { statusCode: 400 });
  const nameI18n = normalizeTranslations(data.nameI18n || data.name);
  const descriptionI18n = entity === 'category' ? null : normalizeTranslations(data.descriptionI18n || data.description);
  const legacyStatus = data.isPublished === true ? 'live' : data.isActive === true ? 'coming_soon' : 'planned';
  const lifecycleStatus = parseLifecycleStatus(data.lifecycleStatus, legacyStatus);
  if (['coming_soon', 'live', 'paused'].includes(lifecycleStatus)) {
    requireCompleteTranslations(nameI18n, 'nameI18n');
    if (entity !== 'category') requireCompleteTranslations(descriptionI18n, 'descriptionI18n');
  }
  if (!nameI18n.en) throw Object.assign(new Error('English name is required'), { statusCode: 400 });
  if (entity !== 'category' && !descriptionI18n.en) throw Object.assign(new Error('English description is required'), { statusCode: 400 });
  // Live default: operational true unless admin explicitly opts out.
  const operationalDefault = lifecycleStatus === 'live';
  const result = {
    slug: slugify(data.slug || data.nameI18n?.en || data.name),
    nameI18n,
    descriptionI18n,
    iconKey: iconKey(data.iconKey),
    availabilityDays: normalizeDays(data.availableDays ?? data.availabilityDays),
    sortOrder: Number.isInteger(Number(data.sortOrder)) && Number(data.sortOrder) >= 0 ? Number(data.sortOrder) : 0,
    lifecycleStatus,
    isActive: lifecycleStatus !== 'retired' && data.isActive !== false,
    isPublished: ['coming_soon', 'live', 'paused'].includes(lifecycleStatus),
    isOperationallyAvailable: parseBoolean(data.isOperationallyAvailable, operationalDefault),
    isBookable: parseBoolean(data.isBookable, false),
    serviceArea: cleanText(data.serviceArea, 255) || null,
    pausedReason: cleanText(data.pausedReason, 500) || null,
    categorySlug: entity === 'tool' ? slugify(data.categorySlug || '') || null : null,
    displayOrder: Number.isInteger(Number(data.displayOrder ?? data.sortOrder)) && Number(data.displayOrder ?? data.sortOrder) >= 0 ? Number(data.displayOrder ?? data.sortOrder) : 0,
    isFeatured: parseBoolean(data.isFeatured, false),
    reason: cleanText(data.reason, 500) || null,
    expectedUpdatedAt: data.updatedAt || data.expectedUpdatedAt || null,
    bookingSlotMinutes: parseCatalogInteger(data.bookingSlotMinutes ?? data.booking_slot_minutes ?? 120, 'bookingSlotMinutes', { min: 15, max: 480 }) ?? 120,
    requiredCrewSize: parseCatalogInteger(data.requiredCrewSize ?? data.required_crew_size ?? 1, 'requiredCrewSize', { min: 1, max: 20 }) ?? 1,
    assigneePool: data.assigneePool && typeof data.assigneePool === 'object'
      ? {
        roles: Array.isArray(data.assigneePool.roles) ? data.assigneePool.roles : [],
        userIds: Array.isArray(data.assigneePool.userIds) ? data.assigneePool.userIds : (Array.isArray(data.assigneePool.user_ids) ? data.assigneePool.user_ids : []),
      }
      : null,
  };
  if (result.isBookable && !result.isOperationallyAvailable) {
    // Soft preference: bookable implies operational at write time
    result.isOperationallyAvailable = true;
  }
  if (!result.slug) throw Object.assign(new Error('A valid name or slug is required'), { statusCode: 400 });
  if (entity === 'tool' && ['coming_soon', 'live', 'paused'].includes(lifecycleStatus) && !result.categorySlug) {
    throw Object.assign(new Error('Tools require a category before Coming soon / Live / Paused'), { statusCode: 400 });
  }
  if (entity === 'service') {
    result.categoryId = cleanText(String(data.categoryId || ''), 80);
    if (!result.categoryId) throw Object.assign(new Error('categoryId is required'), { statusCode: 400 });
    result.priceCents = parsePrice(data.priceCents);
    result.currencyCode = cleanText(data.currencyCode || 'USD', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(result.currencyCode)) throw Object.assign(new Error('currencyCode must be a three-letter code'), { statusCode: 400 });
  }
  return result;
}

async function audit(actorUserId, action, entityType, entityId, payload = {}, executor = db) {
  await executor.query(`INSERT INTO direct_catalog_audit_events (actor_user_id, action, entity_type, entity_id, payload) VALUES ($1, $2, $3, $4, $5)`, [actorUserId || null, action, entityType, entityId || null, JSON.stringify(payload)]);
}

async function saveEntity(entity, body, actorUserId, id = null) {
  const data = parseEntity(entity, body);
  const table = entity === 'category' ? 'direct_catalog_categories' : entity === 'service' ? 'direct_catalog_services' : 'direct_catalog_tools';
  const columns = entity === 'category'
    ? ['slug', 'name_i18n', 'icon_key', 'sort_order', 'display_order', 'is_active', 'is_published', 'lifecycle_status']
    : entity === 'service'
      ? ['category_id', 'slug', 'name_i18n', 'description_i18n', 'price_cents', 'currency_code', 'availability_days', 'available_days', 'sort_order', 'display_order', 'is_active', 'is_published', 'lifecycle_status', 'is_operationally_available', 'is_bookable', 'service_area', 'paused_reason', 'is_featured', 'booking_slot_minutes', 'required_crew_size']
      : ['slug', 'category_slug', 'name_i18n', 'description_i18n', 'icon_key', 'availability_days', 'available_days', 'sort_order', 'display_order', 'is_active', 'is_published', 'lifecycle_status', 'is_operationally_available', 'is_bookable', 'service_area', 'paused_reason', 'is_featured'];
  const values = entity === 'category'
    ? [data.slug, data.nameI18n, data.iconKey, data.sortOrder, data.displayOrder, data.isActive, data.isPublished, data.lifecycleStatus]
    : entity === 'service'
      ? [data.categoryId, data.slug, data.nameI18n, data.descriptionI18n, data.priceCents, data.currencyCode, data.availabilityDays, data.availabilityDays, data.sortOrder, data.displayOrder, data.isActive, data.isPublished, data.lifecycleStatus, data.isOperationallyAvailable, data.isBookable, data.serviceArea, data.pausedReason, data.isFeatured, data.bookingSlotMinutes, data.requiredCrewSize]
      : [data.slug, data.categorySlug, data.nameI18n, data.descriptionI18n, data.iconKey, data.availabilityDays, data.availabilityDays, data.sortOrder, data.displayOrder, data.isActive, data.isPublished, data.lifecycleStatus, data.isOperationallyAvailable, data.isBookable, data.serviceArea, data.pausedReason, data.isFeatured];
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let previousPublished = null;
    let previousStatus = null;
    if (entity === 'service') {
      const category = await client.query('SELECT id FROM direct_catalog_categories WHERE id = $1 LIMIT 1', [data.categoryId]);
      if (!category.rows[0]) throw Object.assign(new Error('The selected service category does not exist'), { statusCode: 400 });
    }
    if (entity === 'tool' && data.categorySlug) {
      const category = await client.query('SELECT slug FROM direct_catalog_categories WHERE slug = $1 LIMIT 1', [data.categorySlug]);
      if (!category.rows[0]) throw Object.assign(new Error('The selected tool category does not exist'), { statusCode: 400 });
    }
    if (id) {
      const existing = await client.query(`SELECT is_published, is_active, lifecycle_status, updated_at FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
      if (!existing.rows[0]) throw Object.assign(new Error('Catalog record not found'), { statusCode: 404 });
      previousPublished = !!existing.rows[0].is_published;
      previousStatus = legacyLifecycle(existing.rows[0]);
      assertTransition(previousStatus, data.lifecycleStatus);
      if (data.expectedUpdatedAt) {
        const currentUpdated = existing.rows[0].updated_at
          ? new Date(existing.rows[0].updated_at).toISOString()
          : null;
        const expected = new Date(data.expectedUpdatedAt).toISOString();
        if (currentUpdated && expected && currentUpdated !== expected) {
          throw Object.assign(new Error('Catalog record was modified by someone else. Reload and try again.'), {
            statusCode: 409,
            code: 'catalog_conflict',
          });
        }
      }
    }

    // Retire category guard: block while live/requestable children exist unless cascadePauseChildren
    if (entity === 'category' && data.lifecycleStatus === 'retired' && id) {
      const children = await client.query(
        `SELECT id, lifecycle_status, is_operationally_available
           FROM direct_catalog_services
          WHERE category_id = $1
            AND lifecycle_status IN ('live', 'paused', 'coming_soon')`,
        [id]
      );
      const sellable = children.rows.filter((row) => row.lifecycle_status === 'live');
      if (sellable.length && !body?.cascadePauseChildren) {
        throw Object.assign(
          new Error(`Cannot retire category while ${sellable.length} live service(s) remain. Pass cascadePauseChildren to pause children and retire.`),
          { statusCode: 400, code: 'category_has_live_children' }
        );
      }
      if (body?.cascadePauseChildren && children.rows.length) {
        await client.query(
          `UPDATE direct_catalog_services
              SET lifecycle_status = 'paused',
                  paused_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
            WHERE category_id = $1
              AND lifecycle_status IN ('live', 'coming_soon')`,
          [id]
        );
      }
    }

    // Side effect: transition to live ⇒ operational true unless explicit false already applied in parse
    if (data.lifecycleStatus === 'live' && previousStatus !== 'live') {
      if (body?.isOperationallyAvailable === undefined && body?.is_operationally_available === undefined) {
        data.isOperationallyAvailable = true;
        if (entity !== 'category') {
          const opIdx = columns.indexOf('is_operationally_available');
          if (opIdx >= 0) values[opIdx] = true;
        }
      }
    }
    let result;
    if (id) {
      const assignments = columns.map((column, index) => `${column} = $${index + 1}`).join(', ');
      const statusParam = columns.length + 2;
      const lifecycleTimestamps = entity === 'category'
        ? ''
        : `, published_at = CASE WHEN $${statusParam} = 'live' THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE published_at END, paused_at = CASE WHEN $${statusParam} = 'paused' THEN CURRENT_TIMESTAMP ELSE paused_at END`;
      const updateValues = entity === 'category' ? [...values, id] : [...values, id, data.lifecycleStatus];
      result = await client.query(`UPDATE ${table} SET ${assignments}${lifecycleTimestamps}, updated_at = CURRENT_TIMESTAMP WHERE id = $${columns.length + 1} RETURNING *`, updateValues);
    } else {
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      const timestampColumns = entity === 'category' ? '' : ', published_at, paused_at';
      const timestampValues = entity === 'category' ? '' : `, ${data.lifecycleStatus === 'live' ? 'CURRENT_TIMESTAMP' : 'NULL'}, ${data.lifecycleStatus === 'paused' ? 'CURRENT_TIMESTAMP' : 'NULL'}`;
      result = await client.query(`INSERT INTO ${table} (${columns.join(', ')}${timestampColumns}) VALUES (${placeholders}${timestampValues}) RETURNING *`, values);
    }
    if (!result.rows[0]) throw Object.assign(new Error('Catalog record not found'), { statusCode: 404 });
    const action = !id
      ? 'create'
      : previousPublished !== data.isPublished
        ? (data.isPublished ? 'publish' : 'rollback')
        : 'update';
    await audit(actorUserId, action, entity, result.rows[0].id, { slug: data.slug }, client);
    if (previousStatus !== data.lifecycleStatus) {
      await client.query(
        `INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entity, result.rows[0].id, previousStatus, data.lifecycleStatus, actorUserId || null, data.reason]
      );
    }
    if (entity === 'service' && data.assigneePool) {
      await setServiceAssigneePool(result.rows[0].id, data.assigneePool, actorUserId, client);
    }
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function removeEntity(entity, id, actorUserId) {
  const table = entity === 'category' ? 'direct_catalog_categories' : entity === 'service' ? 'direct_catalog_services' : 'direct_catalog_tools';
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT lifecycle_status FROM ${table} WHERE id = $1`, [id]);
    if (!existing.rows[0]) throw Object.assign(new Error('Catalog record not found'), { statusCode: 404 });
    const previousStatus = legacyLifecycle(existing.rows[0]);
    const result = await client.query(`UPDATE ${table} SET is_active = FALSE, is_published = FALSE, lifecycle_status = 'retired', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id`, [id]);
    if (!result.rows[0]) throw Object.assign(new Error('Catalog record not found'), { statusCode: 404 });
    await audit(actorUserId, 'archive', entity, result.rows[0].id, {}, client);
    if (previousStatus !== 'retired') {
      await client.query(
        `INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
         VALUES ($1, $2, $3, 'retired', $4, $5)`,
        [entity, result.rows[0].id, previousStatus, actorUserId || null, 'Archived by administrator']
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const ALLOWED_TRANSITIONS = {
  planned: new Set(['planned', 'coming_soon']),
  coming_soon: new Set(['planned', 'coming_soon', 'live', 'retired']),
  live: new Set(['live', 'paused', 'retired']),
  paused: new Set(['paused', 'live', 'retired']),
  retired: new Set(['retired', 'planned']),
};

function assertTransition(fromStatus, toStatus) {
  if (!ALLOWED_TRANSITIONS[fromStatus]?.has(toStatus)) {
    throw Object.assign(new Error(`Invalid lifecycle transition: ${fromStatus} -> ${toStatus}`), { statusCode: 400 });
  }
}

async function bulkTransition(entity, ids, targetStatus, actorUserId, reason = null) {
  if (!['category', 'service', 'tool'].includes(entity)) {
    throw Object.assign(new Error('Unsupported catalog entity'), { statusCode: 400 });
  }
  const normalizedIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => cleanText(String(id), 80)).filter(Boolean))].slice(0, 100);
  if (!normalizedIds.length) throw Object.assign(new Error('At least one catalog record is required'), { statusCode: 400 });
  const cleanReason = cleanText(reason, 500);
  if (!cleanReason) throw Object.assign(new Error('A reason is required for lifecycle transitions'), { statusCode: 400 });
  const toStatus = parseLifecycleStatus(targetStatus);
  const table = entity === 'category' ? 'direct_catalog_categories' : entity === 'service' ? 'direct_catalog_services' : 'direct_catalog_tools';
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      entity === 'tool'
        ? `SELECT id, lifecycle_status, name_i18n, description_i18n, category_slug
             FROM ${table}
            WHERE id = ANY($1::uuid[])
            FOR UPDATE`
        : `SELECT id, lifecycle_status, name_i18n, description_i18n
             FROM ${table}
            WHERE id = ANY($1::uuid[])
            FOR UPDATE`,
      [normalizedIds]
    );
    if (rows.length !== normalizedIds.length) throw Object.assign(new Error('One or more catalog records were not found'), { statusCode: 404 });
    for (const row of rows) {
      const fromStatus = legacyLifecycle(row);
      assertTransition(fromStatus, toStatus);
      if (['coming_soon', 'live', 'paused'].includes(toStatus)) {
        requireCompleteTranslations(row.name_i18n, 'nameI18n');
        if (entity !== 'category') requireCompleteTranslations(row.description_i18n, 'descriptionI18n');
      }
      if (entity === 'tool' && ['coming_soon', 'live', 'paused'].includes(toStatus) && !cleanText(row.category_slug, 100)) {
        throw Object.assign(new Error('Tools require a category before Coming soon / Live / Paused'), { statusCode: 400 });
      }
      if (entity === 'category' && toStatus === 'retired') {
        const children = await client.query(
          `SELECT COUNT(*)::int AS live_count
             FROM direct_catalog_services
            WHERE category_id = $1 AND lifecycle_status = 'live'`,
          [row.id]
        );
        if (Number(children.rows[0]?.live_count || 0) > 0) {
          throw Object.assign(
            new Error('Cannot retire category while live services remain. Pause or retire children first.'),
            { statusCode: 400, code: 'category_has_live_children' }
          );
        }
      }
      const customerVisible = ['coming_soon', 'live', 'paused'].includes(toStatus);
      const active = customerVisible;
      const published = customerVisible;
      if (entity === 'category') {
        await client.query(
          `UPDATE ${table}
              SET lifecycle_status = $1,
                  is_active = $2,
                  is_published = $3,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $4`,
          [toStatus, active, published, row.id]
        );
      } else {
        await client.query(
          `UPDATE ${table}
              SET lifecycle_status = $1,
                  is_active = $2,
                  is_published = $3,
                  is_operationally_available = CASE
                    WHEN $1 = 'live' THEN TRUE
                    ELSE is_operationally_available
                  END,
                  published_at = CASE WHEN $1 = 'live' THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE published_at END,
                  paused_at = CASE WHEN $1 = 'paused' THEN CURRENT_TIMESTAMP ELSE paused_at END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $4`,
          [toStatus, active, published, row.id]
        );
      }
      await audit(actorUserId, 'lifecycle_transition', entity, row.id, { fromStatus, toStatus, reason }, client);
      if (fromStatus !== toStatus) {
        await client.query(
          `INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [entity, row.id, fromStatus, toStatus, actorUserId || null, cleanReason]
        );
      }
    }
    await client.query('COMMIT');
    return { updated: rows.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  LOCALES,
  ICONS,
  LIFECYCLE_STATUSES,
  PUBLIC_CATEGORY_STATUSES,
  PUBLIC_BROWSE_SERVICE_STATUSES,
  getCatalog,
  parseCatalogQuery,
  getAdminCatalog,
  saveEntity,
  removeEntity,
  bulkTransition,
  parseEntity,
  audit,
  catalogReviewIssues,
  buildCatalogReviewSummary,
  assertTransition,
  deriveServiceCapability,
  getServiceAssigneePool,
  setServiceAssigneePool,
};
