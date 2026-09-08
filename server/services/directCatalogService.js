'use strict';

const db = require('../db');

const LOCALES = ['en', 'es', 'fr', 'ht', 'ar'];
const ICONS = new Set(['wrench', 'zap', 'droplets', 'hammer', 'paintbrush', 'trees', 'ruler', 'drill', 'truck', 'shield-check']);
const DAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

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

function publicService(row, locale) {
  return {
    id: String(row.id),
    slug: row.slug,
    name: localized(row.name_i18n, locale),
    description: localized(row.description_i18n, locale),
    priceCents: row.price_cents == null ? null : Number(row.price_cents),
    currencyCode: row.currency_code || 'USD',
    availabilityDays: Array.isArray(row.availability_days) ? row.availability_days : [],
    sortOrder: Number(row.sort_order || 0),
  };
}

function publicTool(row, locale) {
  return {
    id: String(row.id),
    slug: row.slug,
    name: localized(row.name_i18n, locale),
    description: localized(row.description_i18n, locale),
    iconKey: row.icon_key || 'wrench',
    availabilityDays: Array.isArray(row.availability_days) ? row.availability_days : [],
    sortOrder: Number(row.sort_order || 0),
  };
}

function adminCategory(row) {
  return {
    id: String(row.id), slug: row.slug, nameI18n: row.name_i18n || {}, iconKey: row.icon_key,
    sortOrder: Number(row.sort_order || 0), isActive: !!row.is_active, isPublished: !!row.is_published,
  };
}

function adminService(row) {
  return {
    id: String(row.id), categoryId: String(row.category_id), slug: row.slug,
    nameI18n: row.name_i18n || {}, descriptionI18n: row.description_i18n || {},
    priceCents: row.price_cents == null ? null : Number(row.price_cents), currencyCode: row.currency_code || 'USD',
    availabilityDays: Array.isArray(row.availability_days) ? row.availability_days : [],
    sortOrder: Number(row.sort_order || 0), isActive: !!row.is_active, isPublished: !!row.is_published,
  };
}

function adminTool(row) {
  return {
    id: String(row.id), slug: row.slug, nameI18n: row.name_i18n || {}, descriptionI18n: row.description_i18n || {},
    iconKey: row.icon_key, availabilityDays: Array.isArray(row.availability_days) ? row.availability_days : [],
    sortOrder: Number(row.sort_order || 0), isActive: !!row.is_active, isPublished: !!row.is_published,
  };
}

async function getCatalog({ locale = 'en', includeUnpublished = false } = {}) {
  const safeLocale = LOCALES.includes(locale) ? locale : 'en';
  const visibility = includeUnpublished ? '' : ' AND c.is_active = TRUE AND c.is_published = TRUE AND s.is_active = TRUE AND s.is_published = TRUE';
  const toolVisibility = includeUnpublished ? '' : ' WHERE t.is_active = TRUE AND t.is_published = TRUE';
  const [{ rows: categories }, { rows: services }, { rows: tools }] = await Promise.all([
    db.query(`SELECT * FROM direct_catalog_categories c ${includeUnpublished ? '' : 'WHERE c.is_active = TRUE AND c.is_published = TRUE'} ORDER BY c.sort_order, c.created_at`),
    db.query(`SELECT s.*, c.slug AS category_slug FROM direct_catalog_services s JOIN direct_catalog_categories c ON c.id = s.category_id WHERE 1=1 ${visibility} ORDER BY c.sort_order, s.sort_order, s.created_at`),
    db.query(`SELECT * FROM direct_catalog_tools t${toolVisibility} ORDER BY t.sort_order, t.created_at`),
  ]);
  const categoryMap = new Map(categories.map((row) => [String(row.id), {
    ...adminCategory(row), name: localized(row.name_i18n, safeLocale), services: [],
  }]));
  for (const row of services) {
    const category = categoryMap.get(String(row.category_id));
    if (category) category.services.push(publicService(row, safeLocale));
  }
  return {
    locale: safeLocale,
    categories: [...categoryMap.values()].map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      iconKey: category.iconKey,
      services: category.services,
    })),
    tools: tools.map((row) => publicTool(row, safeLocale)),
  };
}

async function getAdminCatalog() {
  const [{ rows: categories }, { rows: services }, { rows: tools }] = await Promise.all([
    db.query('SELECT * FROM direct_catalog_categories ORDER BY sort_order, created_at'),
    db.query('SELECT * FROM direct_catalog_services ORDER BY sort_order, created_at'),
    db.query('SELECT * FROM direct_catalog_tools ORDER BY sort_order, created_at'),
  ]);
  return { categories: categories.map(adminCategory), services: services.map(adminService), tools: tools.map(adminTool), locales: LOCALES, icons: [...ICONS] };
}

function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw Object.assign(new Error('priceCents must be a non-negative integer'), { statusCode: 400 });
  return parsed;
}

function parseEntity(entity, body) {
  const data = body && typeof body === 'object' ? body : {};
  if (!['category', 'service', 'tool'].includes(entity)) throw Object.assign(new Error('Unsupported catalog entity'), { statusCode: 400 });
  const nameI18n = normalizeTranslations(data.nameI18n || data.name);
  const descriptionI18n = entity === 'category' ? null : normalizeTranslations(data.descriptionI18n || data.description);
  if (data.isPublished === true) {
    requireCompleteTranslations(nameI18n, 'nameI18n');
    if (entity !== 'category') requireCompleteTranslations(descriptionI18n, 'descriptionI18n');
  }
  if (!nameI18n.en) throw Object.assign(new Error('English name is required'), { statusCode: 400 });
  if (entity !== 'category' && !descriptionI18n.en) throw Object.assign(new Error('English description is required'), { statusCode: 400 });
  const result = {
    slug: slugify(data.slug || data.nameI18n?.en || data.name),
    nameI18n,
    descriptionI18n,
    iconKey: iconKey(data.iconKey),
    availabilityDays: normalizeDays(data.availabilityDays),
    sortOrder: Number.isInteger(Number(data.sortOrder)) && Number(data.sortOrder) >= 0 ? Number(data.sortOrder) : 0,
    isActive: data.isActive !== false,
    isPublished: data.isPublished === true,
  };
  if (!result.slug) throw Object.assign(new Error('A valid name or slug is required'), { statusCode: 400 });
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
    ? ['slug', 'name_i18n', 'icon_key', 'sort_order', 'is_active', 'is_published']
    : entity === 'service'
      ? ['category_id', 'slug', 'name_i18n', 'description_i18n', 'price_cents', 'currency_code', 'availability_days', 'sort_order', 'is_active', 'is_published']
      : ['slug', 'name_i18n', 'description_i18n', 'icon_key', 'availability_days', 'sort_order', 'is_active', 'is_published'];
  const values = entity === 'category'
    ? [data.slug, data.nameI18n, data.iconKey, data.sortOrder, data.isActive, data.isPublished]
    : entity === 'service'
      ? [data.categoryId, data.slug, data.nameI18n, data.descriptionI18n, data.priceCents, data.currencyCode, data.availabilityDays, data.sortOrder, data.isActive, data.isPublished]
      : [data.slug, data.nameI18n, data.descriptionI18n, data.iconKey, data.availabilityDays, data.sortOrder, data.isActive, data.isPublished];
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let previousPublished = null;
    if (entity === 'service') {
      const category = await client.query('SELECT id FROM direct_catalog_categories WHERE id = $1 LIMIT 1', [data.categoryId]);
      if (!category.rows[0]) throw Object.assign(new Error('The selected service category does not exist'), { statusCode: 400 });
    }
    if (id) {
      const existing = await client.query(`SELECT is_published FROM ${table} WHERE id = $1`, [id]);
      if (!existing.rows[0]) throw Object.assign(new Error('Catalog record not found'), { statusCode: 404 });
      previousPublished = !!existing.rows[0].is_published;
    }
    let result;
    if (id) {
      const assignments = columns.map((column, index) => `${column} = $${index + 1}`).join(', ');
      result = await client.query(`UPDATE ${table} SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = $${columns.length + 1} RETURNING *`, [...values, id]);
    } else {
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      result = await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`, values);
    }
    if (!result.rows[0]) throw Object.assign(new Error('Catalog record not found'), { statusCode: 404 });
    const action = !id
      ? 'create'
      : previousPublished !== data.isPublished
        ? (data.isPublished ? 'publish' : 'rollback')
        : 'update';
    await audit(actorUserId, action, entity, result.rows[0].id, { slug: data.slug }, client);
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
    const result = await client.query(`UPDATE ${table} SET is_active = FALSE, is_published = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id`, [id]);
    if (!result.rows[0]) throw Object.assign(new Error('Catalog record not found'), { statusCode: 404 });
    await audit(actorUserId, 'archive', entity, result.rows[0].id, {}, client);
    await client.query('COMMIT');
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
  getCatalog,
  getAdminCatalog,
  saveEntity,
  removeEntity,
  parseEntity,
  audit,
};
