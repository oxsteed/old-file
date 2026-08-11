// server/controllers/businessController.js
// Business CRUD + analytics, goals, and tax estimates for the Business Hub.

const pool   = require('../db');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { ownedBusiness, canEditProfile, canManageBusinessFinance } = require('../utils/businessOwnership');
const countriesUtil = require('../utils/countries');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { invalidateHelperContext } = require('../services/helperContext');
const { resolvePublicDisplayName } = require('../utils/publicDisplayName');
const {
  listBusinessCategories: getBusinessCategoryCatalog,
  listBusinessOperatingModels,
  normalizeBusinessCategory,
  withBusinessCapabilities,
} = require('../services/businessCategories');

// ── IRS quarterly tax due dates (fixed schedule) ─────────────────────────────
const TAX_DUE_DATES = {
  1: (yr) => `${yr}-04-15`,   // Q1: Jan–Mar
  2: (yr) => `${yr}-06-15`,   // Q2: Apr–May
  3: (yr) => `${yr}-09-15`,   // Q3: Jun–Aug
  4: (yr) => `${yr + 1}-01-15`, // Q4: Sep–Dec (due January of next year)
};

// Quarter → income date range within a year
const QUARTER_RANGES = {
  1: { start: '01-01', end: '03-31' },
  2: { start: '04-01', end: '05-31' },
  3: { start: '06-01', end: '08-31' },
  4: { start: '09-01', end: '12-31' },
};

function currentQuarter() {
  const m = new Date().getMonth() + 1; // 1–12
  if (m <= 3)  return 1;
  if (m <= 5)  return 2;
  if (m <= 8)  return 3;
  return 4;
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

async function ensureDraftFoodRestaurantForBusiness(client, business, ownerUserId) {
  if (!business || business.business_mode !== 'food') return null;

  const { rows: existing } = await client.query(
    `SELECT id FROM food_restaurants WHERE business_id = $1 LIMIT 1`,
    [business.id]
  );
  if (existing[0]) return existing[0];

  const country = countriesUtil.normalizeCountry(business.address_country, 'US');
  const currencyCode = countriesUtil.getDefaultCurrency(country);
  const cuisineTags = business.business_type ? [business.business_type] : [];
  const { rows: [restaurant] } = await client.query(
    `INSERT INTO food_restaurants
       (business_id, owner_user_id, display_name, cuisine_tags, description, phone, website,
        address_street, address_city, address_state, address_zip, address_country,
        currency_code, fulfillment_modes, accepts_online_orders, accepts_in_store_orders,
        kitchen_display_enabled, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,ARRAY['pickup','dine_in','kiosk']::text[],TRUE,TRUE,TRUE,'draft')
     RETURNING id`,
    [
      business.id,
      ownerUserId,
      business.business_name,
      cuisineTags,
      business.description || null,
      business.phone || null,
      business.website || null,
      business.address_street || null,
      business.address_city || null,
      business.address_state || null,
      business.address_zip || null,
      country,
      currencyCode,
    ]
  );
  return restaurant;
}

async function ensureDraftServiceProfileForBusiness(client, business) {
  if (!business || business.business_kind !== 'service') return null;
  const { rows: [profile] } = await client.query(
    `INSERT INTO business_service_profiles (business_id, status)
     VALUES ($1, 'draft')
     ON CONFLICT (business_id) DO UPDATE
       SET updated_at = NOW()
     RETURNING *`,
    [business.id]
  );
  return profile;
}

function normalizeTimezone(value) {
  const timezone = String(value || 'UTC').trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch (_) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      timezone: 'Must be a valid IANA timezone',
    });
  }
  return timezone;
}

function normalizeCurrency(value, country) {
  const currency = String(value || countriesUtil.getDefaultCurrency(country) || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      currency_code: 'Must be a three-letter ISO currency code',
    });
  }
  return currency;
}

// ── List user's businesses ────────────────────────────────────────────────────
async function listBusinesses(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT id, business_name, business_type, industry_category, business_mode,
              business_kind, setup_status, timezone, currency_code, published_at, profile_version,
              description, website, phone,
              address_city, address_state, address_country, is_primary, is_active,
              is_listed, tax_rate, logo_url, created_at,
              COALESCE(active_template, 'default') AS active_template
       FROM businesses
       WHERE user_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [req.user.id]
    );
    return res.json({ businesses: rows.map(withBusinessCapabilities) });
  } catch (err) {
    next(err);
  }
}

async function listBusinessCategories(_req, res) {
  return res.json({
    categories: getBusinessCategoryCatalog(),
    operatingModels: listBusinessOperatingModels(),
    contract: {
      version: 'business-categories-v2',
      generatedAt: new Date().toISOString(),
      dataSource: 'backend-catalog',
    },
  });
}

// ── Add a business ────────────────────────────────────────────────────────────
async function addBusiness(req, res, next) {
  try {
    const {
      business_name, business_type, ein, description, website, phone,
      address_street, address_city, address_state, address_zip,
      address_country, tax_rate, industry_category, business_mode,
      business_kind, timezone, currency_code,
      creation_idempotency_key,
    } = req.body;

    const fields = {};
    if (!business_name?.trim()) fields.business_name = 'Business name is required';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Normalize country (ISO-2 upper, fallback US) and uppercase state for
    // fixed-list countries to keep address matching consistent with users.
    const country = countriesUtil.normalizeCountry(address_country) || 'US';
    const normalizedState = (address_state && countriesUtil.hasRegions(country))
      ? String(address_state).toUpperCase().trim()
      : (address_state || null);
    const category = normalizeBusinessCategory({
      businessKind: business_kind,
      industryCategory: industry_category,
      businessMode: business_mode,
      businessType: business_type,
    });
    if (category.error) {
      throw new AppError(category.error, 400, 'unsupported_business_category');
    }

    if (!category.businessKind) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        business_kind: 'Choose Restaurant or Service Business',
      });
    }

    const normalizedTimezone = normalizeTimezone(timezone);
    const normalizedCurrency = normalizeCurrency(currency_code, country);
    const idempotencyKey = String(
      req.get('Idempotency-Key') || creation_idempotency_key || ''
    ).trim() || null;
    if (idempotencyKey && idempotencyKey.length > 100) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        creation_idempotency_key: 'Idempotency key must be 100 characters or less',
      });
    }

    const { biz, reused } = await withTransaction(pool, async (client) => {
      if (idempotencyKey) {
        const { rows: [existingByKey] } = await client.query(
          `SELECT * FROM businesses
            WHERE user_id = $1 AND creation_idempotency_key = $2
            LIMIT 1`,
          [req.user.id, idempotencyKey]
        );
        if (existingByKey) return { biz: existingByKey, reused: true };
      }

      const { rows: existing } = await client.query(
        'SELECT COUNT(*) as count FROM businesses WHERE user_id = $1',
        [req.user.id]
      );
      const isPrimary = parseInt(existing[0].count) === 0;

      const { rows: [createdBusiness] } = await client.query(
        `INSERT INTO businesses
           (user_id, business_name, business_type, ein, description, website, phone,
            address_street, address_city, address_state, address_zip, address_country,
            is_primary, tax_rate, industry_category, business_mode,
            business_kind, setup_status, timezone, currency_code,
            creation_idempotency_key, is_active, is_listed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'in_progress',$18,$19,$20,FALSE,FALSE)
         RETURNING *`,
        [
          req.user.id, business_name.trim(), category.businessType, ein || null,
          description || null, website || null, phone || null,
          address_street || null, address_city || null, normalizedState,
          address_zip || null, country, isPrimary,
          tax_rate != null ? parseFloat(tax_rate) : 25.00,
          category.industryCategory,
          category.businessMode,
          category.businessKind,
          normalizedTimezone,
          normalizedCurrency,
          idempotencyKey,
        ]
      );
      await ensureDraftFoodRestaurantForBusiness(client, createdBusiness, req.user.id);
      await ensureDraftServiceProfileForBusiness(client, createdBusiness);
      await client.query(
        `INSERT INTO business_setup_progress
           (business_id, current_step, completed_steps, draft_data)
         VALUES ($1, 'vertical_setup', ARRAY['kind','category','identity','location']::TEXT[], $2::jsonb)
         ON CONFLICT (business_id) DO UPDATE
           SET current_step = EXCLUDED.current_step,
               completed_steps = EXCLUDED.completed_steps,
               draft_data = business_setup_progress.draft_data || EXCLUDED.draft_data,
               version = business_setup_progress.version + 1,
               updated_at = NOW()`,
        [
          createdBusiness.id,
          JSON.stringify({
            businessKind: category.businessKind,
            industryCategory: category.industryCategory,
            businessType: category.businessType,
          }),
        ]
      );
      await client.query(
        `INSERT INTO business_audit_log
           (business_id, actor_user_id, actor_role, action, target_type, target_id, after_state, metadata)
         VALUES ($1,$2,'owner','business.created','business',$3,$4::jsonb,$5::jsonb)`,
        [
          createdBusiness.id,
          req.user.id,
          String(createdBusiness.id),
          JSON.stringify(createdBusiness),
          JSON.stringify({ source: 'business_setup_v2', idempotencyKey }),
        ]
      );
      return { biz: createdBusiness, reused: false };
    }, 'business_create');

    return res.status(reused ? 200 : 201).json({
      business: withBusinessCapabilities(biz),
      reused: !!reused,
      onboarding: {
        currentStep: biz.business_kind === 'restaurant' ? 'restaurant_setup' : 'service_setup',
        nextRoute: biz.business_kind === 'restaurant'
          ? '/food/merchant'
          : `/business/${biz.id}/workspace/profile`,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Update a business ─────────────────────────────────────────────────────────
async function updateBusiness(req, res, next) {
  try {
    const { id } = req.params;

    // Allow owner OR active manager to update the business profile.
    const access = await canEditProfile(req.user.id, id);
    if (!access) throw new AppError('Business not found', 404, 'not_found');

    const ownerId = access.owner_id;

    const {
      business_name, business_type, ein, description, website, phone,
      address_street, address_city, address_state, address_zip,
      address_country,
      industry_category, business_mode, business_kind,
      timezone, currency_code,
      is_active, is_listed, tax_rate,
      // Public-profile fields
      logo_url, cover_photo_url,
      clear_logo_url, clear_cover_photo_url,
      // Helper-profile fields that surface on the public business page (belong to owner)
      profile_headline, service_radius_miles,
    } = req.body;

    // Country normalization. We resolve the effective country first because
    // state casing depends on it. If the request includes a new country use
    // that, otherwise fall back to whatever the row already has.
    const { rows: [existingBusiness] } = await pool.query(
      `SELECT address_country, business_kind, industry_category, business_mode,
              business_type, setup_status, published_at
         FROM businesses WHERE id = $1`,
      [id]
    );
    let effectiveCountry = countriesUtil.normalizeCountry(address_country);
    if (!effectiveCountry) effectiveCountry = existingBusiness?.address_country || 'US';
    const normalizedState = (address_state && countriesUtil.hasRegions(effectiveCountry))
      ? String(address_state).toUpperCase().trim()
      : (address_state ?? undefined);
    const category = normalizeBusinessCategory({
      businessKind: business_kind || existingBusiness?.business_kind,
      industryCategory: industry_category || existingBusiness?.industry_category,
      businessMode: business_mode || existingBusiness?.business_mode,
      businessType: business_type || existingBusiness?.business_type,
    });
    if (category.error) {
      throw new AppError(category.error, 400, 'unsupported_business_category');
    }

    if (existingBusiness?.business_kind && category.businessKind !== existingBusiness.business_kind) {
      if (!['draft', 'in_progress'].includes(existingBusiness.setup_status)) {
        throw new AppError(
          'A published business cannot change operating models. Create a separate business instead.',
          409,
          'business_kind_locked'
        );
      }
      const { rows: [usage] } = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM food_orders WHERE business_id = $1) AS food_orders,
           (SELECT COUNT(*)::int FROM business_appointments WHERE business_id = $1) AS appointments,
           (SELECT COUNT(*)::int FROM business_invoices WHERE business_id = $1) AS invoices`,
        [id]
      );
      if (Number(usage?.food_orders || 0) + Number(usage?.appointments || 0) + Number(usage?.invoices || 0) > 0) {
        throw new AppError(
          'This business already has operational history and cannot change operating models.',
          409,
          'business_kind_locked'
        );
      }
    }

    const isOwner = req.user.id === ownerId;
    const logoExplicitNull = clear_logo_url === true;
    const coverExplicitNull = clear_cover_photo_url === true;
    // Managers may edit marketing/contact/address only - not tax identity or lifecycle flags.
    const sensitiveEin = isOwner ? ein : undefined;
    const sensitiveTax = isOwner ? tax_rate : undefined;
    const sensitiveActive = isOwner && is_active != null ? is_active : null;
    const listingVisibility = isOwner && typeof is_listed === 'boolean' ? is_listed : null;
    const requestsPublication = sensitiveActive === true || listingVisibility === true;
    if (
      requestsPublication
      && existingBusiness?.setup_status !== 'active'
      && !existingBusiness?.published_at
    ) {
      throw new AppError(
        'Complete business setup before publishing this business.',
        409,
        'business_setup_incomplete'
      );
    }

    const { rows: [biz] } = await pool.query(
      `UPDATE businesses
       SET business_name   = COALESCE($1,  business_name),
           business_type   = COALESCE($2,  business_type),
           ein             = CASE WHEN $16::boolean THEN COALESCE($3, ein) ELSE ein END,
           description     = COALESCE($4,  description),
           website         = COALESCE($5,  website),
           phone           = COALESCE($6,  phone),
           address_street  = COALESCE($7,  address_street),
           address_city    = COALESCE($8,  address_city),
           address_state   = COALESCE($9,  address_state),
           address_zip     = COALESCE($10, address_zip),
           address_country = COALESCE($19, address_country),
           is_active       = CASE WHEN $16::boolean THEN COALESCE($11, is_active) ELSE is_active END,
           tax_rate        = CASE WHEN $16::boolean THEN COALESCE($12, tax_rate) ELSE tax_rate END,
           logo_url        = CASE WHEN $17::boolean THEN NULL ELSE COALESCE($13, logo_url) END,
           cover_photo_url = CASE WHEN $18::boolean THEN NULL ELSE COALESCE($14, cover_photo_url) END,
           industry_category = COALESCE($20, industry_category),
           business_mode     = COALESCE($21, business_mode),
           is_listed         = COALESCE($22, is_listed),
           business_kind     = COALESCE($23, business_kind),
           timezone          = COALESCE($24, timezone),
           currency_code     = COALESCE($25, currency_code),
           setup_status      = CASE
                                 WHEN $11::boolean = FALSE THEN 'paused'
                                 WHEN $11::boolean = TRUE AND COALESCE($22, is_listed) = TRUE THEN 'active'
                                 ELSE setup_status
                               END,
           published_at      = CASE
                                 WHEN $11::boolean = TRUE AND COALESCE($22, is_listed) = TRUE
                                   THEN COALESCE(published_at, NOW())
                                 ELSE published_at
                               END,
           profile_version   = profile_version + 1,
           updated_at      = NOW()
       WHERE id = $15
       RETURNING *`,
      [
        business_name, category.businessType,
        sensitiveEin !== undefined ? sensitiveEin : null,
        description, website, phone,
        address_street, address_city,
        normalizedState !== undefined ? normalizedState : null,
        address_zip,
        sensitiveActive,
        sensitiveTax != null ? parseFloat(sensitiveTax) : null,
        logo_url        || null,
        cover_photo_url || null,
        id,
        isOwner,
        logoExplicitNull,
        coverExplicitNull,
        // $19 - only update country when the client sent a normalized value
        countriesUtil.normalizeCountry(address_country) || null,
        category.industryCategory,
        category.businessMode,
        listingVisibility,
        category.businessKind,
        timezone !== undefined ? normalizeTimezone(timezone) : null,
        currency_code !== undefined ? normalizeCurrency(currency_code, effectiveCountry) : null,
      ]
    );

    if (!biz) throw new AppError('Business not found', 404, 'not_found');

    if (biz.business_mode === 'food') {
      await ensureDraftFoodRestaurantForBusiness(pool, biz, ownerId);
    } else if (biz.business_kind === 'service') {
      await ensureDraftServiceProfileForBusiness(pool, biz);
    }

    if (req.body.ai_knowledge !== undefined) {
      const raw = req.body.ai_knowledge;
      const s = raw == null ? '' : String(raw);
      if (s.length > 8000) {
        throw new AppError('ai_knowledge must be 8000 characters or less', 400, 'validation_failed');
      }
      await pool.query(
        `UPDATE businesses SET ai_knowledge = $1, updated_at = NOW() WHERE id = $2`,
        [s.trim() || null, id]
      );
      invalidateHelperContext(ownerId, Number(id)).catch(() => {});
    }

    // Update profile_headline / service_radius_miles on the OWNER's helper_profiles
    // row (keyed by ownerId, not the requester - a manager editing profile must not
    // overwrite their own helper_profiles row).
// profile_headline and service_radius_miles are stored on businesses, not helper_profiles.
        const bizCols = [];
        const bizVals = [];
        if (profile_headline !== undefined) {
          bizVals.push(profile_headline || null);
          bizCols.push(`profile_headline = $${bizVals.length}`);
        }
        if (service_radius_miles !== undefined) {
          bizVals.push(service_radius_miles != null ? parseFloat(service_radius_miles) : null);
          bizCols.push(`service_radius_miles = $${bizVals.length}`);
        }
        if (bizCols.length > 0) {
          bizVals.push(id);
          await pool.query(
            `UPDATE businesses SET ${bizCols.join(', ')}, updated_at = NOW() WHERE id = $${bizVals.length}`,
            bizVals
          );
          invalidateHelperContext(ownerId, Number(id)).catch(() => {});
        }

    return res.json({ business: withBusinessCapabilities(biz) });
  } catch (err) {
    next(err);
  }
}

async function loadBusinessSetupReadiness(db, businessId) {
  const { rows: [row] } = await db.query(
    `SELECT b.*,
            (SELECT COUNT(*)::int
               FROM business_services bs
              WHERE bs.business_id = b.id AND bs.is_active = TRUE) AS service_count,
            (SELECT fr.id
               FROM food_restaurants fr
              WHERE fr.business_id = b.id
              LIMIT 1) AS restaurant_id,
            (SELECT fr.status
               FROM food_restaurants fr
              WHERE fr.business_id = b.id
              LIMIT 1) AS restaurant_status,
            (SELECT COUNT(*)::int
               FROM food_menu_items fmi
               JOIN food_restaurants fr ON fr.id = fmi.restaurant_id
              WHERE fr.business_id = b.id AND fmi.is_available = TRUE) AS menu_item_count
       FROM businesses b
      WHERE b.id = $1`,
    [businessId]
  );
  if (!row) return null;

  const kind = row.business_kind || (row.business_mode === 'food' ? 'restaurant' : 'service');
  const checks = [
    { id: 'name', label: 'Business name', complete: !!row.business_name?.trim() },
    { id: 'category', label: 'Business category', complete: !!(row.industry_category || row.business_type) },
    { id: 'location', label: 'City or service location', complete: !!row.address_city?.trim() },
  ];
  if (kind === 'restaurant') {
    checks.push(
      { id: 'restaurant_profile', label: 'Restaurant profile', complete: !!row.restaurant_id },
      { id: 'menu', label: 'At least one available menu item', complete: Number(row.menu_item_count || 0) > 0 },
    );
  } else {
    checks.push(
      { id: 'description', label: 'Customer-facing description', complete: !!row.description?.trim() },
      { id: 'service', label: 'At least one active service', complete: Number(row.service_count || 0) > 0 },
    );
  }

  return {
    business: withBusinessCapabilities(row),
    checks,
    readyToPublish: checks.every((check) => check.complete),
  };
}

// GET /api/businesses/:id/onboarding
async function getBusinessOnboarding(req, res, next) {
  try {
    const access = await canEditProfile(req.user.id, req.params.id);
    if (!access) throw new AppError('Business not found', 404, 'not_found');
    const readiness = await loadBusinessSetupReadiness(pool, access.id);
    const { rows: [progress] } = await pool.query(
      `SELECT current_step, completed_steps, draft_data, version, updated_at
         FROM business_setup_progress
        WHERE business_id = $1`,
      [access.id]
    );
    return res.json({
      ...readiness,
      progress: progress || {
        current_step: 'identity',
        completed_steps: [],
        draft_data: {},
        version: 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

// PUT /api/businesses/:id/onboarding
async function updateBusinessOnboarding(req, res, next) {
  try {
    const access = await canEditProfile(req.user.id, req.params.id);
    if (!access) throw new AppError('Business not found', 404, 'not_found');
    const currentStep = String(req.body.currentStep || req.body.current_step || 'identity').trim().slice(0, 60);
    const completedStepsInput = req.body.completedSteps || req.body.completed_steps || [];
    const completedSteps = Array.isArray(completedStepsInput)
      ? [...new Set(completedStepsInput.map((step) => String(step).trim().slice(0, 60)).filter(Boolean))].slice(0, 30)
      : [];
    const draftData = req.body.draftData || req.body.draft_data || {};
    if (!draftData || Array.isArray(draftData) || typeof draftData !== 'object') {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        draft_data: 'Must be an object',
      });
    }
    if (JSON.stringify(draftData).length > 20000) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        draft_data: 'Saved setup data is too large',
      });
    }

    const { rows: [progress] } = await pool.query(
      `INSERT INTO business_setup_progress
         (business_id, current_step, completed_steps, draft_data)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (business_id) DO UPDATE
         SET current_step = EXCLUDED.current_step,
             completed_steps = EXCLUDED.completed_steps,
             draft_data = business_setup_progress.draft_data || EXCLUDED.draft_data,
             version = business_setup_progress.version + 1,
             updated_at = NOW()
       RETURNING current_step, completed_steps, draft_data, version, updated_at`,
      [access.id, currentStep, completedSteps, JSON.stringify(draftData)]
    );
    await pool.query(
      `UPDATE businesses
          SET setup_status = CASE WHEN setup_status = 'draft' THEN 'in_progress' ELSE setup_status END,
              updated_at = NOW()
        WHERE id = $1`,
      [access.id]
    );
    return res.json({ progress });
  } catch (err) {
    next(err);
  }
}

// POST /api/businesses/:id/onboarding/complete
async function completeBusinessOnboarding(req, res, next) {
  try {
    const access = await canEditProfile(req.user.id, req.params.id);
    if (!access) throw new AppError('Business not found', 404, 'not_found');
    if (req.user.id !== access.owner_id) {
      throw new AppError('Only the business owner can publish this business', 403, 'forbidden');
    }
    const readiness = await loadBusinessSetupReadiness(pool, access.id);
    if (!readiness?.readyToPublish) {
      throw new AppError('Complete the required setup before publishing', 409, 'business_setup_incomplete', {
        missing: readiness?.checks.filter((check) => !check.complete).map((check) => check.id) || [],
      });
    }

    const { business } = await withTransaction(pool, async (client) => {
      const { rows: [published] } = await client.query(
        `UPDATE businesses
            SET setup_status = 'active', is_active = TRUE, is_listed = TRUE,
                published_at = COALESCE(published_at, NOW()),
                profile_version = profile_version + 1,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [access.id]
      );
      if (published.business_kind === 'restaurant') {
        await client.query(
          `UPDATE food_restaurants
              SET status = 'active', discovery_status = 'visible', updated_at = NOW()
            WHERE business_id = $1`,
          [access.id]
        );
      } else {
        await client.query(
          `UPDATE business_service_profiles
              SET status = 'active', updated_at = NOW()
            WHERE business_id = $1`,
          [access.id]
        );
      }
      await client.query(
        `INSERT INTO business_setup_progress
           (business_id, current_step, completed_steps, draft_data)
         VALUES ($1,'complete',ARRAY['kind','category','identity','location','vertical_setup','publish']::TEXT[],'{}'::jsonb)
         ON CONFLICT (business_id) DO UPDATE
           SET current_step = 'complete',
               completed_steps = ARRAY['kind','category','identity','location','vertical_setup','publish']::TEXT[],
               version = business_setup_progress.version + 1,
               updated_at = NOW()`,
        [access.id]
      );
      await client.query(
        `INSERT INTO business_audit_log
           (business_id, actor_user_id, actor_role, action, target_type, target_id, after_state)
         VALUES ($1,$2,'owner','business.published','business',$3,$4::jsonb)`,
        [access.id, req.user.id, String(access.id), JSON.stringify(published)]
      );
      return { business: published };
    }, 'business_publish');

    return res.json({ business: withBusinessCapabilities(business), readiness });
  } catch (err) {
    next(err);
  }
}

// ── Upload business photos (logo + cover) ─────────────────────────────────────
// PUT /api/businesses/:id/photos  multipart/form-data
// fields: logo (optional), cover (optional)
// Access: owner OR active manager
function mediaPublicUrl(req, assetId) {
  const configuredBase = String(process.env.PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const requestBase = `${req.protocol}://${req.get('host')}`;
  const usableConfiguredBase = /^https?:\/\/(?!localhost(?::|\/|$)|127\.0\.0\.1(?::|\/|$))/i.test(configuredBase)
    ? configuredBase
    : '';
  return `${usableConfiguredBase || requestBase}/api/businesses/media/${assetId}`;
}

async function persistBusinessMediaFallback(req, businessId, kind, file) {
  const assetId = crypto.randomUUID();
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const { rows: [asset] } = await pool.query(
    `INSERT INTO business_media_assets
       (id, business_id, kind, content_type, content, size_bytes, sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (business_id, kind) DO UPDATE
       SET id = EXCLUDED.id,
           content_type = EXCLUDED.content_type,
           content = EXCLUDED.content,
           size_bytes = EXCLUDED.size_bytes,
           sha256 = EXCLUDED.sha256,
           updated_at = NOW()
     RETURNING id`,
    [assetId, businessId, kind, file.mimetype, file.buffer, file.size, sha256]
  );
  return mediaPublicUrl(req, asset.id);
}

async function storeBusinessPhoto(req, businessId, kind, file) {
  const { uploadFile, getPublicUrl } = require('../utils/storage');
  try {
    const key = await uploadFile(
      file.buffer,
      kind === 'logo' ? 'business-logos' : 'business-covers',
      file.originalname,
      file.mimetype
    );
    if (key) return getPublicUrl(key);
  } catch (storageError) {
    logger.error('Object storage upload failed; using database media fallback', {
      businessId,
      kind,
      error: storageError.message,
    });
  }
  return persistBusinessMediaFallback(req, businessId, kind, file);
}

async function uploadBusinessPhotos(req, res, next) {
  try {
    const { id } = req.params;

    // Allow owner OR active manager to upload photos.
    const access = await canEditProfile(req.user.id, id);
    if (!access) throw new AppError('Business not found', 404, 'not_found');

    const updates = {};
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (req.files?.logo?.[0]) {
      const file = req.files.logo[0];
      if (!allowed.includes(file.mimetype))
        throw new AppError('Logo must be a JPG, PNG, WebP, or GIF', 400, 'invalid_format');
      updates.logo_url = await storeBusinessPhoto(req, id, 'logo', file);
    }

    if (req.files?.cover?.[0]) {
      const file = req.files.cover[0];
      if (!allowed.includes(file.mimetype))
        throw new AppError('Cover photo must be a JPG, PNG, WebP, or GIF', 400, 'invalid_format');
      updates.cover_photo_url = await storeBusinessPhoto(req, id, 'cover', file);
    }

    if (Object.keys(updates).length === 0)
      throw new AppError('No files uploaded', 400, 'validation_failed');

    // Access already verified above - update by id only (no user_id guard needed here).
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...Object.values(updates), id];
    const { rows: [updated] } = await pool.query(
      `UPDATE businesses SET ${setClauses}, profile_version = profile_version + 1, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, logo_url, cover_photo_url`,
      values
    );

    return res.json({ business: updated, ...updates });
  } catch (err) {
    next(err);
  }
}

// GET /api/businesses/media/:assetId - public profile image bytes.
async function getBusinessMediaAsset(req, res, next) {
  try {
    const { assetId } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
      throw new AppError('Media not found', 404, 'not_found');
    }
    const { rows: [asset] } = await pool.query(
      `SELECT content_type, content, size_bytes, sha256, updated_at
         FROM business_media_assets
        WHERE id = $1`,
      [assetId]
    );
    if (!asset) throw new AppError('Media not found', 404, 'not_found');

    const etag = `"${asset.sha256}"`;
    if (req.get('if-none-match') === etag) return res.status(304).end();
    res.set({
      'Content-Type': asset.content_type,
      'Content-Length': String(asset.size_bytes),
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(asset.content);
  } catch (err) {
    next(err);
  }
}

// ── Set primary business ──────────────────────────────────────────────────────
async function setPrimary(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await pool.query('UPDATE businesses SET is_primary = FALSE WHERE user_id = $1', [userId]);
    const { rows: [biz] } = await pool.query(
      'UPDATE businesses SET is_primary = TRUE WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (!biz) throw new AppError('Business not found', 404, 'not_found');
    return res.json({ business: biz });
  } catch (err) {
    next(err);
  }
}

// ── Delete a business ─────────────────────────────────────────────────────────
async function deleteBusiness(req, res, next) {
  try {
    const { id } = req.params;
    // Soft-delete: set is_active = FALSE instead of hard DELETE (preserves audit trail)
    const result = await pool.query(
      `UPDATE businesses SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE RETURNING id`,
      [id, req.user.id]
    );
    if (!result.rows.length) {
      throw new AppError('Business not found or already deleted', 404, 'not_found');
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ── Analytics: P&L, trends, job stats ────────────────────────────────────────
// GET /api/businesses/:id/analytics?period=6m
async function getBusinessAnalytics(req, res, next) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) throw new AppError('Business not found', 404, 'not_found');

    const bizId   = access.id;
    const ownerId = access.owner_id;

    // 6-month monthly breakdown
    const [invoiceRevRes, oxsteedRevRes, expenseRes, jobStatsRes, invoiceSummaryRes] = await Promise.all([

      // Paid invoice revenue by month (last 6 months)
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', paid_at), 'YYYY-MM') AS month,
          COALESCE(SUM(total), 0)                           AS revenue
        FROM business_invoices
        WHERE business_id = $1
          AND status = 'paid'
          AND paid_at >= NOW() - INTERVAL '6 months'
        GROUP BY 1
        ORDER BY 1
      `, [bizId]),

      // OxSteed payment income by month (for primary business only)
      access.is_primary
        ? pool.query(`
            SELECT
              TO_CHAR(DATE_TRUNC('month', COALESCE(captured_at, released_at)), 'YYYY-MM') AS month,
              COALESCE(SUM(helper_payout), 0) AS revenue
            FROM payments
            WHERE payee_id = $1
              AND status IN ('captured','released')
              AND COALESCE(captured_at, released_at) >= NOW() - INTERVAL '6 months'
            GROUP BY 1
            ORDER BY 1
          `, [ownerId])
        : Promise.resolve({ rows: [] }),

      // Business-tagged expenses by month
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', occurred_at::date), 'YYYY-MM') AS month,
          COALESCE(SUM(amount), 0)                                     AS expenses
        FROM expenses
        WHERE business_id = $1
          AND type = 'expense'
          AND occurred_at >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY 1
        ORDER BY 1
      `, [bizId]),

      // OxSteed job stats (primary business only)
      access.is_primary
        ? pool.query(`
            SELECT
              COUNT(*)::int AS jobs_completed,
              COALESCE(AVG(helper_payout), 0) AS avg_job_value,
              COALESCE(MAX(helper_payout), 0) AS max_job_value
            FROM payments
            WHERE payee_id = $1
              AND status IN ('captured','released')
              AND COALESCE(captured_at, released_at) >= NOW() - INTERVAL '6 months'
          `, [ownerId])
        : Promise.resolve({ rows: [{ jobs_completed: 0, avg_job_value: 0, max_job_value: 0 }] }),

      // Outstanding invoices summary - include per-status counts for the Overview KPIs
      pool.query(`
        SELECT
          COALESCE(SUM(total - amount_paid) FILTER (WHERE status IN ('sent','overdue')), 0) AS outstanding,
          COALESCE(SUM(total - amount_paid) FILTER (WHERE status = 'overdue'), 0)            AS overdue,
          COUNT(*) FILTER (WHERE status = 'sent')                                            AS sent_count,
          COUNT(*) FILTER (WHERE status = 'overdue')                                         AS overdue_count
        FROM business_invoices
        WHERE business_id = $1
      `, [bizId]),
    ]);

    // Merge monthly revenue (invoice + OxSteed) and expenses into a unified series
    const months = generateLast6Months();
    const invoiceByMonth  = Object.fromEntries(invoiceRevRes.rows.map(r  => [r.month, parseFloat(r.revenue)]));
    const oxsteedByMonth  = Object.fromEntries(oxsteedRevRes.rows.map(r  => [r.month, parseFloat(r.revenue)]));
    const expenseByMonth  = Object.fromEntries(expenseRes.rows.map(r     => [r.month, parseFloat(r.expenses)]));

    const monthly = months.map(m => {
      const revenue  = round2((invoiceByMonth[m] || 0) + (oxsteedByMonth[m] || 0));
      const expenses = round2(expenseByMonth[m] || 0);
      return { month: m, revenue, expenses, profit: round2(revenue - expenses) };
    });

    // MTD totals (current month only)
    const thisMo    = monthly[monthly.length - 1];
    const lastMo    = monthly[monthly.length - 2];

    // YTD totals
    const currentYear = new Date().getFullYear().toString();
    const ytd = monthly
      .filter(m => m.month.startsWith(currentYear))
      .reduce((acc, m) => ({
        revenue:  round2(acc.revenue + m.revenue),
        expenses: round2(acc.expenses + m.expenses),
        profit:   round2(acc.profit + m.profit),
      }), { revenue: 0, expenses: 0, profit: 0 });

    const jobStats    = jobStatsRes.rows[0];
    const invSummary  = invoiceSummaryRes.rows[0];

    return res.json({
      business_id: bizId,
      monthly,
      mtd: thisMo || { revenue: 0, expenses: 0, profit: 0 },
      last_month: lastMo || { revenue: 0, expenses: 0, profit: 0 },
      ytd,
      // Nested shape expected by the frontend OverviewTab
      invoices: {
        outstanding_total: round2(parseFloat(invSummary.outstanding || 0)),
        overdue_total:     round2(parseFloat(invSummary.overdue || 0)),
        sent:              parseInt(invSummary.sent_count || 0),
        overdue_count:     parseInt(invSummary.overdue_count || 0),
      },
      jobs: {
        completed_6m: parseInt(jobStats.jobs_completed || 0),
        avg_value:    round2(parseFloat(jobStats.avg_job_value || 0)),
        max_value:    round2(parseFloat(jobStats.max_job_value || 0)),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Tax estimates ─────────────────────────────────────────────────────────────
// GET /api/businesses/:id/tax  - returns current + future estimates
// POST /api/businesses/:id/tax/refresh - recalculate based on latest data
async function getBusinessTax(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { rows } = await pool.query(
      `SELECT * FROM business_tax_estimates
       WHERE user_id = $1 AND (business_id = $2 OR business_id IS NULL)
       ORDER BY tax_year ASC, quarter ASC`,
      [access.owner_id, access.id]
    );

    return res.json({ estimates: rows, tax_rate: access.tax_rate });
  } catch (err) {
    logger.error('getBusinessTax error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load tax estimates' });
  }
}

async function refreshTaxEstimates(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const userId   = access.owner_id;
    const bizId    = access.id;
    const taxRate  = parseFloat(access.tax_rate) / 100;
    const year     = new Date().getFullYear();
    const cq       = currentQuarter();

    // Build estimates for current quarter + remaining quarters of this year
    const upserted = [];

    for (let q = cq; q <= 4; q++) {
      const range = QUARTER_RANGES[q];
      const qStart = `${year}-${range.start}`;
      const qEnd   = `${year}-${range.end}`;
      const dueDate = q < 4 ? TAX_DUE_DATES[q](year) : TAX_DUE_DATES[4](year);

      // Quarterly net income = OxSteed income (primary) + invoice income - biz expenses
      const [oxRes, invRes, expRes] = await Promise.all([
        access.is_primary
          ? pool.query(`
              SELECT COALESCE(SUM(helper_payout), 0) AS total
              FROM payments
              WHERE payee_id = $1
                AND status IN ('captured','released')
                AND COALESCE(captured_at, released_at) BETWEEN $2::date AND $3::date + INTERVAL '1 day'
            `, [userId, qStart, qEnd])
          : Promise.resolve({ rows: [{ total: 0 }] }),

        pool.query(`
          SELECT COALESCE(SUM(total), 0) AS total
          FROM business_invoices
          WHERE business_id = $1 AND status = 'paid'
            AND paid_at BETWEEN $2::date AND $3::date + INTERVAL '1 day'
        `, [bizId, qStart, qEnd]),

        pool.query(`
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM expenses
          WHERE business_id = $1 AND type = 'expense'
            AND occurred_at BETWEEN $2 AND $3
        `, [bizId, qStart, qEnd]),
      ]);

      const gross   = parseFloat(oxRes.rows[0].total) + parseFloat(invRes.rows[0].total);
      const deduct  = parseFloat(expRes.rows[0].total);
      const net     = Math.max(0, gross - deduct);
      const estTax  = round2(net * taxRate);

      const { rows: [est] } = await pool.query(`
        INSERT INTO business_tax_estimates
          (user_id, business_id, tax_year, quarter, estimated_net_income,
           tax_rate_used, estimated_tax, due_date, last_refreshed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (user_id, business_id, tax_year, quarter)
        DO UPDATE SET
          estimated_net_income = EXCLUDED.estimated_net_income,
          tax_rate_used        = EXCLUDED.tax_rate_used,
          estimated_tax        = EXCLUDED.estimated_tax,
          last_refreshed_at    = NOW(),
          updated_at           = NOW()
        RETURNING *
      `, [userId, bizId, year, q, round2(net), parseFloat(access.tax_rate), estTax, dueDate]);

      upserted.push(est);
    }

    return res.json({ estimates: upserted, tax_rate: access.tax_rate });
  } catch (err) {
    logger.error('refreshTaxEstimates error', { err: err.message });
    return res.status(500).json({ error: 'Failed to refresh tax estimates' });
  }
}

async function markTaxPaid(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { amount } = req.body;
    const paidAmt = parseFloat(amount || 0);
    if (paidAmt <= 0) return res.status(400).json({ error: 'Amount must be positive' });

    const { rows: [est] } = await pool.query(`
      UPDATE business_tax_estimates
      SET status       = 'paid',
          paid_amount  = $1,
          paid_at      = NOW(),
          updated_at   = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [paidAmt, req.params.estimateId, access.owner_id]);

    if (!est) return res.status(404).json({ error: 'Estimate not found' });
    return res.json({ estimate: est });
  } catch (err) {
    logger.error('markTaxPaid error', { err: err.message });
    return res.status(500).json({ error: 'Failed to mark tax paid' });
  }
}

// ── Business goals ────────────────────────────────────────────────────────────
async function listGoals(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { rows } = await pool.query(
      `SELECT * FROM business_goals WHERE business_id = $1 ORDER BY created_at DESC`,
      [access.id]
    );
    return res.json({ goals: rows });
  } catch (err) {
    logger.error('listGoals error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load goals' });
  }
}

async function createGoal(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { title, goal_type, period, target_value, period_start, period_end } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    if (!target_value || parseFloat(target_value) <= 0) return res.status(400).json({ error: 'Target value must be positive' });

    const { rows: [goal] } = await pool.query(`
      INSERT INTO business_goals
        (user_id, business_id, title, goal_type, period, target_value, period_start, period_end)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [
      access.owner_id, access.id, title.trim(), goal_type || 'revenue',
      period || 'monthly', parseFloat(target_value),
      period_start || null, period_end || null,
    ]);

    return res.status(201).json({ goal });
  } catch (err) {
    logger.error('createGoal error', { err: err.message });
    return res.status(500).json({ error: 'Failed to create goal' });
  }
}

async function updateGoal(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { title, target_value, current_value, is_completed } = req.body;
    const { rows: [goal] } = await pool.query(`
      UPDATE business_goals
      SET title         = COALESCE($1, title),
          target_value  = COALESCE($2, target_value),
          current_value = COALESCE($3, current_value),
          is_completed  = COALESCE($4, is_completed),
          updated_at    = NOW()
      WHERE id = $5 AND business_id = $6 AND user_id = $7
      RETURNING *
    `, [
      title, target_value ? parseFloat(target_value) : null,
      current_value != null ? parseFloat(current_value) : null,
      is_completed != null ? is_completed : null,
      req.params.goalId, access.id, access.owner_id,
    ]);

    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    return res.json({ goal });
  } catch (err) {
    logger.error('updateGoal error', { err: err.message });
    return res.status(500).json({ error: 'Failed to update goal' });
  }
}

async function deleteGoal(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const result = await pool.query(
      'DELETE FROM business_goals WHERE id = $1 AND business_id = $2 AND user_id = $3 RETURNING id',
      [req.params.goalId, access.id, access.owner_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Goal not found' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('deleteGoal error', { userId: req.user?.id, businessId: access?.id, goalId: req.params?.goalId, err: err.message });
    return res.status(500).json({ error: 'Failed to delete goal' });
  }
}

// ── helper: generate last 6 calendar month keys (YYYY-MM) ────────────────────
function generateLast6Months() {
  const months = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) {
    const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(
      `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
    );
  }
  return months;
}

// ── Public business profile ───────────────────────────────────────────────────
// GET /api/businesses/:id/public - no auth required.
// Returns everything a customer needs to see the business profile page.
async function getBusinessPublicProfile(req, res) {
  try {
    const bizId = req.params.id;

    // Core business record + owner info
    // Per migration 214, businesses are FULLY independent from the owner's helper_profile:
    //   * Service area, ratings, headline, photos, and visibility are read from `businesses` columns.
    //   * The owner is referenced only for chat initiation (owner_name / owner_id).
    //   * The helper_profile join is retained ONLY to support the legacy
    //     allow_guest_contact and active_template fallbacks during the migration window.
    const bizRes = await pool.query(
      `SELECT
         b.id, b.business_name, b.business_type, b.industry_category,
         b.business_mode, b.business_kind, b.setup_status, b.description,
         b.website, b.phone, b.logo_url, b.cover_photo_url,
         b.address_city, b.address_state, b.address_country,
         b.is_primary, b.is_active, b.is_listed, b.created_at,
         u.id           AS owner_id,
         u.first_name   AS owner_first_name,
         u.last_name    AS owner_last_name,
         u.display_name_preference,
         pb_prim.business_name AS primary_business_name,
         b.profile_headline,
         b.service_city, b.service_state, b.service_radius_miles,
         b.service_lat, b.service_lng,
         b.avg_rating, b.total_reviews, b.completed_jobs_count,
         b.is_business_verified,
         b.stripe_charges_enabled, b.stripe_account_status,
         COALESCE(hp.allow_guest_contact, TRUE) AS owner_allow_guest_contact,
         COALESCE(b.active_template, 'default') AS active_template
       FROM businesses b
       JOIN users u          ON u.id  = b.user_id
       LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
       LEFT JOIN businesses pb_prim ON pb_prim.user_id = u.id AND pb_prim.is_primary = TRUE AND pb_prim.is_active = TRUE
       WHERE b.id        = $1
         AND b.is_active = TRUE
         AND b.is_listed = TRUE
         AND b.setup_status = 'active'
         AND b.business_kind = 'service'
         AND u.deleted_at IS NULL
         AND u.is_active = TRUE
         AND u.email_verified = TRUE`,
      [bizId]
    );

    const biz = bizRes.rows[0];
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    const ownerId = biz.owner_id;

    // Parallel: services, reviews, gallery, FAQs, policies, hours, active team members
    // Query from business_* tables (Phase 3 content) instead of helper_* tables
    const [svcRes, reviewRes, galRes, faqRes, polRes, hoursRes, teamRes] = await Promise.all([
      pool.query(
        `SELECT id, name, description, price, price_unit, duration, popular, category, sort_order
         FROM business_services
         WHERE business_id = $1 AND is_active = TRUE
         ORDER BY sort_order, id`,
        [bizId]
      ),
      // Business reviews are now sourced from the business_reviews table keyed
      // on business_id - not the owner's personal review pool. See migration 214.
      pool.query(
        `SELECT br.id, br.rating, br.testimonial AS comment, br.created_at,
                br.response, br.updated_at AS response_at,
                u.first_name, u.last_name,
                helper.first_name AS helper_first_name, helper.last_name AS helper_last_name
         FROM business_reviews br
         JOIN users u ON u.id = br.customer_id
         LEFT JOIN users helper ON helper.id = br.helper_id
         WHERE br.business_id = $1
         ORDER BY br.created_at DESC
         LIMIT 20`,
        [bizId]
      ),
      pool.query(
        `SELECT id, url, caption, alt FROM business_gallery WHERE business_id = $1 ORDER BY sort_order, id`,
        [bizId]
      ),
      pool.query(
        `SELECT id, question, answer FROM business_faqs WHERE business_id = $1 ORDER BY sort_order, id`,
        [bizId]
      ),
      pool.query(
        `SELECT id, title, content, icon FROM business_policies WHERE business_id = $1 ORDER BY sort_order, id`,
        [bizId]
      ),
      pool.query(
        `SELECT day_of_week, start_time, end_time, is_closed FROM business_hours
         WHERE business_id = $1 ORDER BY day_of_week`,
        [bizId]
      ),
      // Active team members (name + role only - no email exposed publicly)
      pool.query(
        `SELECT bm.role, u.first_name, u.last_name
         FROM business_members bm
         JOIN users u ON u.id = bm.member_id
         WHERE bm.business_id = $1 AND bm.status = 'active'
         ORDER BY bm.accepted_at`,
        [bizId]
      ),
    ]);

    return res.json({
      business: withBusinessCapabilities({
        id:             biz.id,
        business_name:  biz.business_name,
        business_type:  biz.business_type,
        description:    biz.description,
        website:        biz.website,
        phone:          biz.phone,
        logo_url:       biz.logo_url,
        cover_photo_url: biz.cover_photo_url || null,
        address_city:    biz.address_city    || biz.service_city,
        address_state:   biz.address_state   || biz.service_state,
        address_country: biz.address_country || 'US',
        service_radius_miles: biz.service_radius_miles,
        service_lat: biz.service_lat != null ? parseFloat(biz.service_lat) : null,
        service_lng: biz.service_lng != null ? parseFloat(biz.service_lng) : null,
        is_primary:     biz.is_primary,
        member_since:   biz.created_at,
        // Business verification badge
          is_business_verified:    biz.is_business_verified,
        avg_rating:              biz.avg_rating,
        total_reviews:           biz.total_reviews,
        completed_jobs_count:    biz.completed_jobs_count,
        // Owner context - needed for chat initiation
        owner_id:        ownerId,
        owner_name:      resolvePublicDisplayName({
          display_name_preference: biz.display_name_preference,
          first_name: biz.owner_first_name,
          last_name: biz.owner_last_name,
          primary_business_name: biz.primary_business_name,
        }),
        // Business avatar shown to customers is the business's own logo; we
        // intentionally no longer fall back to the owner's helper profile photo.
        owner_photo:      biz.logo_url,
        profile_headline: biz.profile_headline,
        bio_short:        biz.description,
        // Payment readiness signal so the booking page can decide whether to
        // collect payment up-front or fall back to invoicing.
        accepts_payments: !!biz.stripe_charges_enabled,
        /** Same gate as `/helpers/:id` guest chat - owner's helper_profiles.allow_guest_contact */
        allow_guest_contact: biz.owner_allow_guest_contact !== false,
        /** Active profile template slug */
        active_template: biz.active_template || 'default',
        business_kind: biz.business_kind,
        business_mode: biz.business_mode,
        industry_category: biz.industry_category,
        setup_status: biz.setup_status,
      }),
      services:  svcRes.rows,
      reviews:   reviewRes.rows,
      gallery:   galRes.rows,
      faqs:      faqRes.rows,
      policies:  polRes.rows,
      hours:     hoursRes.rows,
      team:      teamRes.rows,
    });
  } catch (err) {
    logger.error('getBusinessPublicProfile error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load business profile' });
  }
}

// ── Authenticated profile editor payload ──────────────────────────────────────
// GET /api/businesses/:id/profile-edit - owner or active manager; includes full address.
async function getBusinessProfileForEditor(req, res) {
  try {
    const { id } = req.params;
    const access = await canEditProfile(req.user.id, id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { rows: [row] } = await pool.query(
      `SELECT
         b.id,
         b.business_name,
         b.business_type,
         b.industry_category,
         b.business_mode,
         b.business_kind,
         b.setup_status,
         b.timezone,
         b.currency_code,
         b.published_at,
         b.profile_version,
         b.description,
         b.website,
         b.phone,
         b.address_street,
         b.address_city,
         b.address_state,
         b.address_zip,
         b.address_country,
         b.logo_url,
         b.cover_photo_url,         COALESCE(b.profile_headline, hp.profile_headline) AS profile_headline,
         b.service_radius_miles,
         hp.bio_short,
         b.ai_knowledge
       FROM businesses b
       LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
       WHERE b.id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Business not found' });
    return res.json({ business: withBusinessCapabilities(row) });
  } catch (err) {
    logger.error('getBusinessProfileForEditor error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load business profile' });
  }
}

module.exports = {
  listBusinesses, listBusinessCategories, addBusiness, updateBusiness, setPrimary, deleteBusiness,
  getBusinessOnboarding, updateBusinessOnboarding, completeBusinessOnboarding,
  uploadBusinessPhotos, getBusinessMediaAsset,
  getBusinessPublicProfile,
  getBusinessProfileForEditor,
  getBusinessAnalytics,
  getBusinessTax, refreshTaxEstimates, markTaxPaid,
  listGoals, createGoal, updateGoal, deleteGoal,
};
