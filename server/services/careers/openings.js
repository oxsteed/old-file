'use strict';

// Openings: public listing and detail, employer create/update/close
// (careers spec §6.5, §7; fixes C-04, C-05, C-09, C-10, C-16).

const { AppError } = require('../../middleware/errorHandler');
const { OPENING_STATUS_TRANSITIONS, ACTIVE_STAGES, slugify } = require('../careerCatalog');
const { parseOpening } = require('./validation');
const { checkOpeningWithRules } = require('./compliance');
const { assertCanHireRole, assertLocationsInScope } = require('./access');
const { stampDecision } = require('./retention');
const { notifyApplicant } = require('./notify');
const { isNycOpening, addBusinessDays } = require('./matching');

const PUBLIC_COLUMNS = `
  o.id, o.employer_type, o.business_id, o.slug, o.title, o.department,
  o.employment_type, o.path_stage, o.workplace_type, o.country_code, o.region, o.city,
  o.timezone, o.currency_code, o.compensation_min, o.compensation_max,
  o.compensation_period, o.work_authorization, o.sponsorship_available, o.languages,
  o.required_languages, o.description, o.requirements, o.benefits, o.benefits_summary,
  o.schedule_summary, o.required_credentials, o.preferred_credentials, o.job_role_code,
  o.team_role, o.status, o.opens_at, o.closes_at, o.applications_close_at, o.location_ids,
  o.employer_model, o.allow_guest_applications, o.min_age, o.ai_ranking_enabled,
  o.background_check_required, o.content_locale, o.translations, o.published_at,
  o.created_at, o.updated_at, o.requirement_tags,
  (o.promoted_until IS NOT NULL AND o.promoted_until > NOW()) AS is_promoted,
  CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name,
  CASE WHEN o.employer_type = 'platform' THEN 'oxsteed'
       ELSE COALESCE(b.profile_slug::text, 'b-' || b.id::text) END AS employer_slug,
  b.logo_url AS employer_logo_url,
  COALESCE(b.is_business_verified, FALSE) AS employer_verified
`;

// C-05: deleted or deactivated businesses never show or take applications.
const PUBLIC_FILTER = `
  o.status = 'open'
  AND o.moderation_status = 'ok'
  AND o.is_internal = FALSE
  AND (o.opens_at IS NULL OR o.opens_at <= NOW())
  AND (COALESCE(o.applications_close_at, o.closes_at) IS NULL OR COALESCE(o.applications_close_at, o.closes_at) >= NOW())
  AND (o.employer_type = 'platform' OR (b.deleted_at IS NULL AND b.is_active = TRUE))
`;

function encodeCursor(row) {
  return Buffer.from(`${new Date(row.sort_at).toISOString()}|${row.id}`).toString('base64url');
}
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(String(cursor), 'base64url').toString('utf8').split('|');
    const date = new Date(at);
    if (Number.isNaN(date.getTime()) || !/^\d+$/.test(id)) return null;
    return { at: date.toISOString(), id: Number(id) };
  } catch {
    return null;
  }
}

async function resolvePostal(db, { postal, country }) {
  if (!postal) return null;
  const { rows: [c] } = await db.query(
    `SELECT id, lat, lng, country FROM geo_postal_centroids
      WHERE upper(replace(postal_code, ' ', '')) = upper(replace($1, ' ', ''))
        AND ($2::text IS NULL OR country = $2)
      ORDER BY id LIMIT 1`,
    [String(postal).slice(0, 20), country ? String(country).toUpperCase().slice(0, 2) : null]
  );
  return c || null;
}

function buildPublicWhere(query, params, centroid) {
  const where = [PUBLIC_FILTER];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('$?', `$${params.length}`)); };
  if (query.employer === 'platform') where.push("o.employer_type = 'platform'");
  if (query.employer === 'business') where.push("o.employer_type = 'business'");
  if (query.business_id && /^\d+$/.test(String(query.business_id))) add('o.business_id = $?', Number(query.business_id));
  if (query.country) add('o.country_code = $?', String(query.country).toUpperCase().slice(0, 2));
  if (query.workplace) add('o.workplace_type = $?', String(query.workplace));
  if (query.department) add('o.department = $?', String(query.department));
  if (query.path) add('o.path_stage = $?', String(query.path));
  if (query.role) add('o.job_role_code = $?', String(query.role).slice(0, 40));
  if (query.lang) add('($?::text = ANY(o.languages))', String(query.lang).toLowerCase().slice(0, 3));
  if (query.pay_min !== undefined && query.pay_min !== '') {
    const n = Number(query.pay_min);
    if (Number.isFinite(n) && n >= 0) add('o.compensation_max >= $?', n);
  }
  if (query.pay_period) add('o.compensation_period = $?', String(query.pay_period));
  const q = String(query.q || '').trim().slice(0, 120);
  if (q) {
    params.push(q);
    const p = `$${params.length}`;
    where.push(`(o.search_tsv @@ websearch_to_tsquery('simple', ${p}) OR o.title % ${p})`);
  }
  if (centroid) {
    const radius = Math.min(Math.max(Number(query.radius_km) || 25, 1), 500);
    params.push(centroid.lng, centroid.lat, radius * 1000);
    const [lng, lat, meters] = [params.length - 2, params.length - 1, params.length].map((i) => `$${i}`);
    where.push(`(o.workplace_type = 'remote' OR EXISTS (
      SELECT 1 FROM geo_postal_centroids gc WHERE gc.id = o.postal_centroid_id
        AND ST_DWithin(gc.geog, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${meters})
    ) OR EXISTS (
      SELECT 1 FROM restaurant_locations rl WHERE rl.id = ANY(o.location_ids) AND rl.latitude IS NOT NULL
        AND ST_DWithin(ST_SetSRID(ST_MakePoint(rl.longitude, rl.latitude), 4326)::geography,
                       ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${meters})
    ))`);
  }
  return where;
}

/**
 * Public listing with cursor pagination (C-16). Promoted openings are
 * returned separately in `promoted` (labeled); `openings` is the organic
 * list, ordered by publish date, and is identical with or without boosts.
 */
async function listPublic(db, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
  const centroid = await resolvePostal(db, { postal: query.near, country: query.country });
  if (query.near && !centroid) return { openings: [], promoted: [], nextCursor: null, near: { found: false } };
  const params = [];
  const where = buildPublicWhere(query, params, centroid);
  const cursor = decodeCursor(query.cursor);
  const organicWhere = [...where];
  const organicParams = [...params];
  if (cursor) {
    organicParams.push(cursor.at, cursor.id);
    organicWhere.push(`(COALESCE(o.published_at, o.created_at), o.id) < ($${organicParams.length - 1}::timestamptz, $${organicParams.length}::bigint)`);
  }
  organicParams.push(limit + 1);
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, COALESCE(o.published_at, o.created_at) AS sort_at
       FROM career_openings o
       LEFT JOIN businesses b ON b.id = o.business_id
      WHERE ${organicWhere.join(' AND ')}
      ORDER BY COALESCE(o.published_at, o.created_at) DESC, o.id DESC
      LIMIT $${organicParams.length}`,
    organicParams
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  let promoted = [];
  if (!cursor) {
    const promoParams = [...params];
    const { rows: promo } = await db.query(
      `SELECT ${PUBLIC_COLUMNS}
         FROM career_openings o
         LEFT JOIN businesses b ON b.id = o.business_id
        WHERE ${where.join(' AND ')} AND o.promoted_until > NOW()
        ORDER BY o.promoted_until DESC, o.id DESC
        LIMIT 3`,
      promoParams
    );
    promoted = promo;
  }
  return {
    openings: page.map(({ sort_at, ...o }) => o),
    promoted,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    near: centroid ? { found: true, country: centroid.country } : null,
  };
}

/**
 * One public opening by numeric id or by employer slug + slug (C-04: no
 * global slug lookup; an all-digit param is always an id).
 */
async function getPublic(db, { id = null, employerSlug = null, slug = null, includeClosed = false }) {
  const params = [];
  let match;
  if (id != null) {
    if (!/^\d+$/.test(String(id))) return null;
    params.push(Number(id));
    match = 'o.id = $1';
  } else if (employerSlug && slug) {
    params.push(String(employerSlug).toLowerCase().slice(0, 120), String(slug).toLowerCase().slice(0, 120));
    match = `o.slug = $2 AND (
      ($1 = 'oxsteed' AND o.employer_type = 'platform')
      OR (o.employer_type = 'business' AND (lower(b.profile_slug::text) = $1 OR ('b-' || b.id::text) = $1)))`;
  } else return null;
  const { rows: [opening] } = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, (${PUBLIC_FILTER}) AS is_accepting
       FROM career_openings o
       LEFT JOIN businesses b ON b.id = o.business_id
      WHERE ${match}
        AND (o.employer_type = 'platform' OR (b.deleted_at IS NULL AND b.is_active = TRUE))
        AND o.moderation_status <> 'removed' AND o.is_internal = FALSE
      LIMIT 1`,
    params
  );
  if (!opening) return null;
  if (!opening.is_accepting && !includeClosed) return null;
  return opening;
}

async function uniqueSlug(db, { employerType, businessId, title, excludeId }) {
  const base = slugify(title);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { rows } = await db.query(
      employerType === 'platform'
        ? `SELECT id FROM career_openings WHERE employer_type = 'platform' AND slug = $1 AND ($2::bigint IS NULL OR id <> $2)`
        : `SELECT id FROM career_openings WHERE business_id = $1 AND slug = $2 AND ($3::bigint IS NULL OR id <> $3)`,
      employerType === 'platform' ? [candidate, excludeId || null] : [businessId, candidate, excludeId || null]
    );
    if (!rows.length) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Stores must belong to the business; returns { restaurantId, regionId }.
async function resolveStores(db, businessId, locationIds) {
  if (!locationIds.length) return { restaurantId: null, regionId: null, brandId: null };
  const { rows } = await db.query(
    `SELECT l.id, l.restaurant_id, l.region_id, fr.brand_id
       FROM restaurant_locations l
       JOIN food_restaurants fr ON fr.id = l.restaurant_id
      WHERE fr.business_id = $1 AND l.id = ANY($2::bigint[])`,
    [businessId, locationIds]
  );
  if (rows.length !== locationIds.length) {
    throw new AppError('Validation failed', 400, 'validation_failed', { location_ids: 'Pick stores that belong to this business' });
  }
  const one = (key) => {
    const set = new Set(rows.map((r) => (r[key] == null ? null : Number(r[key]))));
    return set.size === 1 ? [...set][0] : null;
  };
  return { restaurantId: one('restaurant_id'), regionId: one('region_id'), brandId: one('brand_id') };
}

async function loadSettings(db, businessId) {
  if (!businessId) return null;
  const { rows: [s] } = await db.query('SELECT * FROM career_business_settings WHERE business_id = $1', [businessId]);
  return s || null;
}

function applySettingDefaults(body, settings) {
  if (!settings) return body;
  const out = { ...body };
  if (out.allow_guest_applications === undefined) out.allow_guest_applications = settings.allow_guest_applications_default;
  if (out.hide_identity_until_offer === undefined) out.hide_identity_until_offer = settings.hide_identity_default;
  if (out.ai_ranking_enabled === undefined) out.ai_ranking_enabled = settings.ai_ranking_default;
  if (out.employer_model === undefined && ['shift', 'seasonal', 'temporary'].includes(out.path_stage || out.employment_type)) {
    out.employer_model = settings.default_employer_model;
  }
  return out;
}

async function assertJobRole(db, code) {
  if (!code) return;
  const { rows } = await db.query('SELECT 1 FROM team_job_roles WHERE code = $1', [code]);
  if (!rows.length) throw new AppError('Validation failed', 400, 'validation_failed', { job_role_code: 'Unknown job role' });
}

async function assertEorMarket(db, value) {
  if (value.employer_model !== 'oxsteed_eor') return;
  const { rows } = await db.query(
    `SELECT 1 FROM career_eor_markets
      WHERE country = $1 AND (region IS NULL OR upper(region) = upper(COALESCE($2, '')))
        AND approved_at IS NOT NULL AND revoked_at IS NULL
      LIMIT 1`,
    [value.country_code, value.region]
  );
  if (!rows.length) {
    throw new AppError('OxSteed is not yet licensed as employer of record here', 409, 'eor_market_unavailable', {
      employer_model: 'Employer of record is not available in this market yet; hire directly instead',
    });
  }
}

async function postalCentroid(db, value) {
  if (!value.postal_code || !value.country_code) return null;
  const c = await resolvePostal(db, { postal: value.postal_code, country: value.country_code });
  return c ? c.id : null;
}

/**
 * Shared create/update persistence. `access` is from assertCanManageOpening
 * or requireHiringAccess (kind 'platform' or 'business').
 */
async function saveOpening(db, { access, user, body, existing = null, employerType, businessId }) {
  const merged = applySettingDefaults(body, existing ? null : await loadSettings(db, businessId));
  const { value, errors } = parseOpening(merged, { existing, employerType });
  errors.throwIfAny();
  if (employerType === 'platform') {
    value.team_role = null; value.location_ids = []; value.employer_model = 'direct';
  } else {
    assertCanHireRole(access, value.team_role);
    assertLocationsInScope(access, value.location_ids);
  }
  await assertJobRole(db, value.job_role_code);
  await assertEorMarket(db, value);
  const stores = employerType === 'business' ? await resolveStores(db, businessId, value.location_ids) : { restaurantId: null, regionId: null, brandId: null };
  const centroidId = (await postalCentroid(db, value)) ?? existing?.postal_centroid_id ?? null;

  // Status machine (C-09).
  const requested = body.status !== undefined ? String(body.status) : (existing ? existing.status : 'draft');
  if (existing && requested !== existing.status) {
    const allowed = OPENING_STATUS_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(requested)) throw new AppError(`An opening can't go from ${existing.status} to ${requested}`, 409, 'invalid_transition');
  } else if (!existing && !['draft', 'open'].includes(requested)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { status: 'New openings start as draft or open' });
  }

  const compliance = await checkOpeningWithRules(db, value);
  if (requested === 'open' && !compliance.ok) {
    throw new AppError('This opening needs changes before it can be published', 422, 'compliance_blocked', { compliance: compliance.blocking.map((b) => b.code).join(',') });
  }
  // K6: only verified businesses publish.
  if (requested === 'open' && employerType === 'business') {
    const { rows: [biz] } = await db.query('SELECT is_business_verified FROM businesses WHERE id = $1', [businessId]);
    if (!biz?.is_business_verified) throw new AppError('Verify your business before publishing openings', 403, 'business_not_verified');
  }

  const slugSource = value.title;
  const slug = existing && existing.title === value.title ? existing.slug
    : await uniqueSlug(db, { employerType, businessId, title: slugSource, excludeId: existing?.id });
  const cols = {
    title: value.title, slug, department: value.department, employment_type: value.employment_type,
    path_stage: value.path_stage, workplace_type: value.workplace_type, country_code: value.country_code,
    region: value.region, city: value.city, timezone: value.timezone, currency_code: value.currency_code,
    compensation_min: value.compensation_min, compensation_max: value.compensation_max,
    compensation_period: value.compensation_period, work_authorization: value.work_authorization,
    sponsorship_available: value.sponsorship_available, languages: value.languages,
    required_languages: value.required_languages, description: value.description, requirements: value.requirements,
    benefits: value.benefits, benefits_summary: value.benefits_summary, schedule_summary: value.schedule_summary,
    required_credentials: value.required_credentials, preferred_credentials: value.preferred_credentials,
    job_role_code: value.job_role_code, team_role: value.team_role, location_ids: value.location_ids,
    restaurant_id: stores.restaurantId, region_id: stores.regionId, brand_id: stores.brandId,
    postal_centroid_id: centroidId, opens_at: value.opens_at, closes_at: value.closes_at,
    applications_close_at: value.applications_close_at, min_age: value.min_age, min_age_reason: value.min_age_reason,
    allow_guest_applications: value.allow_guest_applications, hide_identity_until_offer: value.hide_identity_until_offer,
    ai_ranking_enabled: value.ai_ranking_enabled, is_internal: value.is_internal, employer_model: value.employer_model,
    background_check_required: value.background_check_required, background_check_package: value.background_check_package,
    background_check_reason: value.background_check_reason, content_locale: value.content_locale,
    translations: JSON.stringify(value.translations), pay_required_reason: compliance.payRequiredReason,
    status: requested,
  };
  if (body.requirement_tags && typeof body.requirement_tags === 'object') {
    const tags = body.requirement_tags;
    cols.requirement_tags = JSON.stringify({
      schedule: Array.isArray(tags.schedule) ? tags.schedule.slice(0, 6) : [],
      skills: Array.isArray(tags.skills) ? tags.skills.map(String).slice(0, 20) : [],
      roles: Array.isArray(tags.roles) ? tags.roles.map(String).slice(0, 5) : [],
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
    });
  }
  let row;
  if (existing) {
    const keys = Object.keys(cols);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    if (requested === 'open' && existing.status !== 'open') sets.push('published_at = COALESCE(published_at, NOW())');
    if (requested === 'closed' && existing.status !== 'closed') sets.push('closed_at = NOW()');
    if (requested === 'filled' && existing.status !== 'filled') sets.push('filled_at = NOW()');
    ({ rows: [row] } = await db.query(
      `UPDATE career_openings SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [existing.id, ...keys.map((k) => cols[k])]
    ));
  } else {
    const all = { ...cols, employer_type: employerType, business_id: businessId, created_by: user.id };
    const keys = Object.keys(all);
    ({ rows: [row] } = await db.query(
      `INSERT INTO career_openings (${keys.join(', ')}, published_at)
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}, CASE WHEN $${keys.indexOf('status') + 1} = 'open' THEN NOW() ELSE NULL END)
       RETURNING *`,
      keys.map((k) => all[k])
    ));
  }
  // NYC LL144: candidates get notice 10 business days before ranking.
  if (row.ai_ranking_enabled && isNycOpening(row) && row.status === 'open') {
    await db.query(
      `INSERT INTO career_ai_ranking_notices (opening_id, rank_allowed_from) VALUES ($1, $2)
       ON CONFLICT (opening_id) DO NOTHING`,
      [row.id, addBusinessDays(new Date(), 10)]
    );
  }
  if (existing && ['closed', 'filled'].includes(row.status) && existing.status !== row.status) {
    await closeRemainingApplications(db, row, user.id);
  }
  return { opening: row, compliance };
}

/**
 * R1: when an opening closes, remaining applications move to the final
 * closed_unfilled stage (never rejected), live offers are withdrawn and
 * candidates get a neutral notice.
 */
async function closeRemainingApplications(db, opening, actorId) {
  const { rows } = await db.query(
    `UPDATE career_applications SET stage = 'closed_unfilled', updated_at = NOW()
      WHERE opening_id = $1 AND stage = ANY($2::text[])
        AND NOT EXISTS (SELECT 1 FROM career_offers co WHERE co.application_id = career_applications.id AND co.status = 'accepted')
      RETURNING id, stage, user_id, applicant_email, locale, anonymized_at`,
    [opening.id, ACTIVE_STAGES]
  );
  const { rows: [emp] } = await db.query(
    `SELECT CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS name
       FROM career_openings o LEFT JOIN businesses b ON b.id = o.business_id WHERE o.id = $1`,
    [opening.id]
  );
  for (const app of rows) {
    await db.query(
      `INSERT INTO career_application_events (application_id, actor_user_id, from_stage, to_stage, reason_code)
       VALUES ($1, $2, NULL, 'closed_unfilled', 'position_closed')`,
      [app.id, actorId]
    );
    await db.query(
      `UPDATE career_offers SET status = 'withdrawn', decided_at = NOW(), withdrawn_reason = 'opening_closed'
        WHERE application_id = $1 AND status IN ('pending','awaiting_approval')`,
      [app.id]
    );
    await stampDecision(db, app.id, { decidedBy: actorId });
    await notifyApplicant(db, app, {
      type: 'career_application_closed',
      params: { openingTitle: opening.title, employerName: emp?.name || '' },
      deliveryKey: `career_closed:${app.id}`,
    });
  }
  return rows.length;
}

module.exports = {
  PUBLIC_COLUMNS,
  PUBLIC_FILTER,
  encodeCursor,
  decodeCursor,
  resolvePostal,
  listPublic,
  getPublic,
  uniqueSlug,
  resolveStores,
  loadSettings,
  saveOpening,
  closeRemainingApplications,
};
