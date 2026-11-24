// server/routes/toolRentals.js
// Tool Rental listings - any authenticated user can manage their tools for rent
// GET    /api/tool-rentals/me         → list my tools
// POST   /api/tool-rentals            → create tool listing
// PUT    /api/tool-rentals/:id        → update tool listing
// DELETE /api/tool-rentals/:id        → delete tool listing
// GET    /api/tool-rentals/browse     → public browse (no auth)

const express = require('express');
const crypto = require('crypto');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const { toolOwnerCapabilityGate } = require('../middleware/requireAccess');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { generalLimiter, invoiceLimiter, reportLimiter, termsLimiter } = require('../middleware/rateLimiter');
const pool    = require('../db');
const { uploadFile, getPublicUrl, deleteFile } = require('../utils/storage');
const { resolvePublicDisplayName } = require('../utils/publicDisplayName');
const { parseDateOnlyUTC } = require('../utils/dateOnly');
const toolFavoritesController = require('../controllers/toolFavoritesController');
const toolReviewsController = require('../controllers/toolReviewsController');
const toolBookingsController = require('../controllers/toolBookingsController');
const toolAnalyticsController = require('../controllers/toolAnalyticsController');
const toolNotificationsController = require('../controllers/toolNotificationsController');
const paymentMethodController = require('../controllers/paymentMethodController');
const invoiceController = require('../controllers/invoiceController');
const userReportController = require('../controllers/userReportController');
const termsController = require('../controllers/termsController');

// Saved-search fan-out for new tool listings. Defensive require: alerts must
// never break tool creation.
let notifyToolSearches = null;
try {
  ({ notifyMatchingSavedSearchesForTool: notifyToolSearches } =
    require('./savedSearches'));
} catch (_) { notifyToolSearches = null; }

// Base fields guaranteed present since migration 039
const TOOL_FIELDS_BASE = `
  t.id, t.user_id, t.name, t.category, t.description,
  t.daily_rate, t.hourly_rate, t.deposit_amount,
  t.condition, t.brand, t.model, t.is_available,
  t.requires_deposit, t.delivery_available, t.pickup_only,
  t.location_city, t.location_state,
  t.owner_rules, t.owner_custom_terms, t.owner_custom_terms_hash,
  t.replacement_value, t.owner_attested_at, t.owner_attestation_version,
  t.created_at, t.updated_at,t.accessories,t.condition_checklist,t.equipment_version
`;

// Resolved lazily on first request — checks which optional columns exist so the
// query doesn't fail on databases where migration 078b hasn't applied yet.
let _resolvedFields = null;
async function getToolFields() {
  if (_resolvedFields) return _resolvedFields;
  try {
    // Check optional tool_rentals columns (added in 078b, moderation_hold in 675,
    // capacity/size/weight in the 563 migration, location in the 564 migration)
    const { rows: trCols } = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tool_rentals'
         AND column_name IN ('avg_rating', 'review_count', 'image_gallery', 'location_lat', 'location_lng', 'moderation_hold',
           'capacity_value', 'capacity_unit', 'weight_kg', 'size_length_cm', 'size_width_cm', 'size_height_cm')
    `);
    const tr = new Set(trCols.map(r => r.column_name));

    // Check optional users columns (added in 078b)
    const { rows: uCols } = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users'
         AND column_name IN ('avatar_url', 'avg_response_time_hours')
    `);
    const uc = new Set(uCols.map(r => r.column_name));

    const toolExtras = [
      tr.has('avg_rating')   ? 'COALESCE(t.avg_rating, 0) AS avg_rating'   : '0 AS avg_rating',
      tr.has('review_count') ? 'COALESCE(t.review_count, 0) AS review_count' : '0 AS review_count',
      tr.has('image_gallery')
        ? `CASE WHEN t.image_gallery IS NOT NULL AND array_length(t.image_gallery, 1) > 0 THEN t.image_gallery[1] ELSE NULL END AS image_url`
        : 'NULL AS image_url',
      tr.has('location_lat') ? 't.location_lat' : 'NULL::numeric AS location_lat',
      tr.has('location_lng') ? 't.location_lng' : 'NULL::numeric AS location_lng',
      tr.has('capacity_value') ? 't.capacity_value' : 'NULL::numeric AS capacity_value',
      tr.has('capacity_unit') ? 't.capacity_unit' : 'NULL AS capacity_unit',
      tr.has('weight_kg') ? 't.weight_kg' : 'NULL::numeric AS weight_kg',
      tr.has('size_length_cm') ? 't.size_length_cm' : 'NULL::numeric AS size_length_cm',
      tr.has('size_width_cm') ? 't.size_width_cm' : 'NULL::numeric AS size_width_cm',
      tr.has('size_height_cm') ? 't.size_height_cm' : 'NULL::numeric AS size_height_cm',
    ].join(',\n  ');

    // Store which optional users columns are safe to select
    _resolvedFields = {
      toolFields: `${TOOL_FIELDS_BASE},\n  ${toolExtras}`,
      ownerRatingExpr: tr.has('avg_rating') ? 'COALESCE(t.avg_rating, 0)' : '0',
      hasAvatarUrl: uc.has('avatar_url'),
      hasResponseTime: uc.has('avg_response_time_hours'),
      hasImageGallery: tr.has('image_gallery'),
      hasModerationHold: tr.has('moderation_hold'),
      hasCapacityColumns: tr.has('capacity_value') && tr.has('capacity_unit') && tr.has('weight_kg')
        && tr.has('size_length_cm') && tr.has('size_width_cm') && tr.has('size_height_cm'),
    };
  } catch {
    _resolvedFields = {
      toolFields: `${TOOL_FIELDS_BASE},\n  0 AS avg_rating, 0 AS review_count, NULL AS image_url, NULL::numeric AS location_lat, NULL::numeric AS location_lng, NULL::numeric AS capacity_value, NULL AS capacity_unit, NULL::numeric AS weight_kg, NULL::numeric AS size_length_cm, NULL::numeric AS size_width_cm, NULL::numeric AS size_height_cm`,
      ownerRatingExpr: '0',
      hasAvatarUrl: false,
      hasResponseTime: false,
      hasImageGallery: false,
      hasModerationHold: false,
      hasCapacityColumns: false,
    };
  }
  return _resolvedFields;
}

function buildUserFields(hasAvatarUrl, hasResponseTime) {
  const parts = ['u.first_name', 'u.last_name', 'u.display_name_preference', 'pb.business_name AS primary_business_name'];
  parts.push(hasAvatarUrl ? 'u.avatar_url' : 'NULL AS avatar_url');
  parts.push(hasResponseTime ? 'COALESCE(u.avg_response_time_hours, 24) AS avg_response_time_hours' : '24 AS avg_response_time_hours');
  return parts.join(',\n              ');
}

function attachPublicOwnerNames(rows) {
  return rows.map((row) => {
    const ownerName = resolvePublicDisplayName(row);
    return {
      ...row,
      owner_name: ownerName,
      first_name: ownerName,
      last_name: null,
      display_name_preference: undefined,
      primary_business_name: undefined,
    };
  });
}

// Seeded common tool categories (also merged with DB distinct values)
const SEED_TOOL_CATEGORIES = [
  'Power Tools','Hand Tools','Measuring & Layout','Cutting Tools',
  'Drilling & Fastening','Sanding & Finishing','Welding & Metalwork',
  'Plumbing Tools','Electrical Tools','HVAC Tools',
  'Landscaping & Outdoor','Lawn & Garden','Pressure Washing',
  'Concrete & Masonry','Flooring Tools','Painting Equipment',
  'Scaffolding & Ladders','Lifting & Material Handling',
  'Compressors & Air Tools','Generators & Power',
  'Automotive & Mechanical','Trailers & Hauling',
  'Safety Equipment','Cleaning Equipment','Diagnostic Equipment',
];

const TOOL_RENTAL_ATTESTATION_VERSION = 'peer-rental-v1';
const VALID_CONDITIONS = ['excellent', 'good', 'fair', 'poor'];
// 563: capacity units. kg/lb = load, L/gal = volume, W/kW/hp = power.
const VALID_CAPACITY_UNITS = ['kg', 'lb', 'L', 'gal', 'W', 'kW', 'hp'];
const MAX_TOOL_NAME_LEN = 200;
const MAX_TOOL_CATEGORY_LEN = 100;
const MAX_TOOL_DESCRIPTION_LEN = 4000;
const MAX_TOOL_SHORT_LEN = 100;
const MAX_TOOL_STATE_LEN = 50;
const MAX_RENTAL_AMOUNT = 100000;

function parseMoney(value, field, errors, { required = false, positive = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) errors[field] = `${field} is required`;
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    errors[field] = `${field} must be a number`;
    return null;
  }
  if (positive ? num <= 0 : num < 0) {
    errors[field] = positive ? `${field} must be greater than 0` : `${field} cannot be negative`;
    return null;
  }
  if (num > MAX_RENTAL_AMOUNT) {
    errors[field] = `${field} is too high`;
    return null;
  }
  return Number(num.toFixed(2));
}

function parseNonNegativeNumber(value, field, errors, { max = 1000000 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    errors[field] = `${field} must be a number`;
    return null;
  }
  if (num < 0) {
    errors[field] = `${field} cannot be negative`;
    return null;
  }
  if (num > max) {
    errors[field] = `${field} is too high`;
    return null;
  }
  return num;
}

function cleanText(value, maxLen, field, errors, { required = false } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    if (required) errors[field] = `${field} is required`;
    return null;
  }
  if (text.length > maxLen) {
    errors[field] = `${field} is too long`;
    return null;
  }
  return text;
}

function parseBoolean(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return Boolean(value);
}

function hashCustomTerms(value) {
  const text = String(value || '').trim();
  return text ? crypto.createHash('sha256').update(text).digest('hex') : null;
}

async function resolveToolImageUrl(req) {
  const file = req.file;
  if (file) {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      const err = new Error('Tool photo must be an image');
      err.status = 400;
      throw err;
    }

    const key = await uploadFile(file.buffer, 'tool-rentals', file.originalname, file.mimetype);
    if (key) {
      const url = getPublicUrl(key);
      if (!url) {
        await deleteFile(key).catch((cleanupError) => {
          require('../utils/logger').warn('[toolRentals] failed to clean up image without public URL', {
            key,
            error: cleanupError.message,
          });
        });
        const err = new Error('Tool photo URL unavailable');
        err.status = 503;
        throw err;
      }
      return { url, key };
    }

    if (file.size > 2 * 1024 * 1024) {
      const err = new Error('Tool photo is too large. Configure file storage or upload an image under 2MB.');
      err.status = 400;
      throw err;
    }
    return { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`, key: null };
  }

  const imageUrl = cleanText(req.body.image_url, 2048, 'image_url', {});
  if (!imageUrl) return { url: null, key: null };
  try {
    new URL(imageUrl);
  } catch {
    const err = new Error('Tool photo URL is invalid');
    err.status = 400;
    throw err;
  }
  return { url: imageUrl, key: null };
}

function normalizeToolPayload(body, { partial = false, existing = null } = {}) {
  const errors = {};
  const payload = {};

  if (!partial || body.name !== undefined) {
    payload.name = cleanText(body.name, MAX_TOOL_NAME_LEN, 'name', errors, { required: !partial });
  }
  if (!partial || body.category !== undefined) {
    payload.category = cleanText(body.category, MAX_TOOL_CATEGORY_LEN, 'category', errors, { required: !partial });
  }
  if (!partial || body.description !== undefined) {
    payload.description = cleanText(body.description, MAX_TOOL_DESCRIPTION_LEN, 'description', errors);
  }
  if (!partial || body.brand !== undefined) {
    payload.brand = cleanText(body.brand, MAX_TOOL_SHORT_LEN, 'brand', errors);
  }
  if (!partial || body.model !== undefined) {
    payload.model = cleanText(body.model, MAX_TOOL_SHORT_LEN, 'model', errors);
  }
  if (!partial || body.location_city !== undefined) {
    payload.location_city = cleanText(body.location_city, MAX_TOOL_SHORT_LEN, 'location_city', errors, { required: !partial });
  }
  if (!partial || body.location_state !== undefined) {
    payload.location_state = cleanText(body.location_state, MAX_TOOL_STATE_LEN, 'location_state', errors);
  }

  if (!partial || body.daily_rate !== undefined) {
    payload.daily_rate = parseMoney(body.daily_rate, 'daily_rate', errors, { required: !partial || body.daily_rate !== undefined, positive: true });
  }
  if (!partial || body.hourly_rate !== undefined) {
    payload.hourly_rate = parseMoney(body.hourly_rate, 'hourly_rate', errors, { positive: true });
  }
  if (!partial || body.deposit_amount !== undefined) {
    payload.deposit_amount = parseMoney(body.deposit_amount, 'deposit_amount', errors);
  }
  if (!partial || body.replacement_value !== undefined) {
    payload.replacement_value = parseMoney(body.replacement_value, 'replacement_value', errors);
  }
  if (!partial || body.owner_rules !== undefined) {
    payload.owner_rules = cleanText(body.owner_rules, MAX_TOOL_DESCRIPTION_LEN, 'owner_rules', errors);
  }
  if (!partial || body.owner_custom_terms !== undefined) {
    payload.owner_custom_terms = cleanText(body.owner_custom_terms, MAX_TOOL_DESCRIPTION_LEN, 'owner_custom_terms', errors);
    payload.owner_custom_terms_hash = hashCustomTerms(payload.owner_custom_terms);
  }

  if (!partial || body.condition !== undefined) {
    payload.condition = body.condition || null;
    if (payload.condition && !VALID_CONDITIONS.includes(payload.condition)) {
      errors.condition = 'Invalid condition value';
    }
  }

  // 563: capacity is a value+unit pair; weight and dimensions are plain
  // non-negative measures. A blank value means "not provided" (and on a
  // partial update leaves the stored value alone, like the money fields).
  if (!partial || body.capacity_value !== undefined) {
    payload.capacity_value = parseNonNegativeNumber(body.capacity_value, 'capacity_value', errors);
  }
  if (!partial || body.capacity_unit !== undefined) {
    const unit = typeof body.capacity_unit === 'string' ? body.capacity_unit.trim() : '';
    payload.capacity_unit = unit || null;
    if (payload.capacity_unit && !VALID_CAPACITY_UNITS.includes(payload.capacity_unit)) {
      errors.capacity_unit = 'Invalid capacity unit';
    }
  }
  for (const field of ['weight_kg', 'size_length_cm', 'size_width_cm', 'size_height_cm']) {
    if (!partial || body[field] !== undefined) {
      payload[field] = parseNonNegativeNumber(body[field], field, errors);
    }
  }
  // The pair is validated on the merged row: a partial update that sets a
  // value inherits the stored unit (and vice versa), so an edit that does
  // not touch capacity can never break the pair.
  const mergedCapacityValue = payload.capacity_value ?? existing?.capacity_value ?? null;
  const mergedCapacityUnit = payload.capacity_unit ?? existing?.capacity_unit ?? null;
  if ((mergedCapacityValue != null) !== (mergedCapacityUnit != null)) {
    errors.capacity_unit = 'capacity_unit is required when a capacity is set';
  }

  for (const field of ['is_available', 'requires_deposit', 'delivery_available', 'pickup_only']) {
    if (!partial || body[field] !== undefined) {
      payload[field] = parseBoolean(body[field]);
    }
  }

  if (payload.requires_deposit && !(payload.deposit_amount > 0)) {
    errors.deposit_amount = 'deposit_amount is required when a deposit is required';
  }
  payload.owner_attestation_accepted = parseBoolean(body.owner_attestation_accepted);
  if (!partial && !payload.owner_attestation_accepted) {
    errors.owner_attestation_accepted = 'Confirm the peer rental acknowledgement before listing this tool';
  }

  return { payload, errors };
}

// GET /api/tool-rentals/categories?q=pow&limit=20
router.use('/operations',require('./equipmentOperations'));
// Public - returns merged list of seeded + DB categories for autocomplete
router.get('/categories', async (req, res) => {
  try {
    const { q = '', limit = 25 } = req.query;
    const limitN  = Math.min(Math.max(1, parseInt(limit) || 25), 50);
    const term    = q.trim().toLowerCase();

    // Fetch distinct categories already in the DB
    const dbRes = await pool.query(
      `SELECT DISTINCT category FROM tool_rentals
        WHERE category IS NOT NULL AND category <> ''
        ORDER BY category LIMIT 100`
    ).catch(() => ({ rows: [] }));

    const dbCats = dbRes.rows.map(r => r.category);
    const merged = [...new Set([...SEED_TOOL_CATEGORIES, ...dbCats])];
    const filtered = term
      ? merged.filter(c => c.toLowerCase().includes(term))
      : merged;

    res.json({ categories: filtered.slice(0, limitN) });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] categories error', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET /api/tool-rentals/browse?category=&city=&name=&priceMin=&priceMax=&sort=&limit=30&startDate=&endDate=
// Group 11 item 562: a browse-level date filter. When startDate+endDate are
// given, listings with an overlapping live booking (pending / invoice_sent /
// payment_confirmed, same overlap rule as createBooking) are excluded, so
// the renter only sees tools free for the whole requested range.
async function browseTools(req, res) {
  try {
    const { category, city, name, priceMin, priceMax, sort = 'newest', limit = 30, offset = 0, startDate, endDate,
      capacityMin, capacityUnit, weightMax, lengthMax, widthMax, heightMax } = req.query;
    // 562: both dates together, valid calendar dates, end after start.
    // A single date is not a rental range, so it is rejected rather than
    // silently treated as open-ended.
    let dateRange = null;
    if (startDate !== undefined || endDate !== undefined) {
      const start = parseDateOnlyUTC(startDate);
      const end = parseDateOnlyUTC(endDate);
      if (!start || !end || end <= start) {
        return res.status(400).json({
          error: 'Invalid rental dates',
          code: 'validation_failed',
          fields: {
            startDate: start ? undefined : 'Invalid date',
            endDate: end && end > start ? undefined : 'End date must be after the start date',
          },
        });
      }
      dateRange = { startDate, endDate };
    }
    const params = [true];
    let where = 'WHERE t.is_available = $1';
    let idx = 2;

    const { toolFields, ownerRatingExpr, hasAvatarUrl, hasResponseTime, hasModerationHold, hasCapacityColumns } = await getToolFields();
    // An admin moderation hold (e.g. safety recall) keeps the tool out of the
    // public listing even if the owner flips is_available back on.
    if (hasModerationHold) where += ' AND NOT t.moderation_hold';

    if (category) { where += ` AND t.category ILIKE $${idx++}`; params.push(`%${category}%`); }
    if (city)     { where += ` AND t.location_city ILIKE $${idx++}`; params.push(`%${city}%`); }
    if (name)     { where += ` AND t.name ILIKE $${idx++}`; params.push(`%${name}%`); }
    if (priceMin) { where += ` AND t.daily_rate >= $${idx++}`; params.push(parseFloat(priceMin)); }
    if (priceMax) { where += ` AND t.daily_rate <= $${idx++}`; params.push(parseFloat(priceMax)); }
    // 563: capacity/size filters. A minimum capacity is meaningless without
    // its unit (10 kg is not 10 lb), so capacityMin requires capacityUnit.
    const capacityFilters = { capacityMin, capacityUnit, weightMax, lengthMax, widthMax, heightMax };
    if (Object.values(capacityFilters).some((v) => v !== undefined)) {
      if (!hasCapacityColumns) {
        return res.status(400).json({ error: 'Capacity filters are unavailable', code: 'unavailable' });
      }
      const badNumber = (value) => {
        const n = Number(value);
        return !Number.isFinite(n) || n < 0;
      };
      const filterErrors = {};
      if (capacityUnit !== undefined && !VALID_CAPACITY_UNITS.includes(capacityUnit)) {
        filterErrors.capacityUnit = 'Invalid capacity unit';
      }
      if (capacityMin !== undefined && (badNumber(capacityMin) || !capacityUnit)) {
        filterErrors.capacityMin = capacityUnit ? 'Invalid capacity minimum' : 'capacityUnit is required with capacityMin';
      }
      for (const field of ['weightMax', 'lengthMax', 'widthMax', 'heightMax']) {
        if (capacityFilters[field] !== undefined && badNumber(capacityFilters[field])) {
          filterErrors[field] = 'Invalid value';
        }
      }
      if (Object.keys(filterErrors).length) {
        return res.status(400).json({ error: 'Invalid capacity filters', code: 'validation_failed', fields: filterErrors });
      }
      if (capacityUnit) { where += ` AND t.capacity_unit = $${idx++}`; params.push(capacityUnit); }
      if (capacityMin !== undefined) { where += ` AND t.capacity_value >= $${idx++}`; params.push(Number(capacityMin)); }
      if (weightMax !== undefined) { where += ` AND t.weight_kg <= $${idx++}`; params.push(Number(weightMax)); }
      if (lengthMax !== undefined) { where += ` AND t.size_length_cm <= $${idx++}`; params.push(Number(lengthMax)); }
      if (widthMax !== undefined) { where += ` AND t.size_width_cm <= $${idx++}`; params.push(Number(widthMax)); }
      if (heightMax !== undefined) { where += ` AND t.size_height_cm <= $${idx++}`; params.push(Number(heightMax)); }
    }
    if (dateRange) {
      where += ` AND NOT EXISTS (
        SELECT 1 FROM tool_rentals_bookings b
         WHERE b.tool_id = t.id
           AND b.status IN ('pending', 'invoice_sent', 'payment_confirmed')
           AND b.start_date <= $${idx}
           AND b.end_date >= $${idx + 1}
      )`;
      params.push(dateRange.endDate, dateRange.startDate);
      idx += 2;
    }

    let orderBy = 't.created_at DESC';
    if (sort === 'price-asc') orderBy = 't.daily_rate ASC';
    if (sort === 'price-desc') orderBy = 't.daily_rate DESC';

    params.push(Math.min(parseInt(limit) || 30, 100));
    params.push(parseInt(offset) || 0);

    const result = await pool.query(
      `SELECT ${toolFields},
              ${buildUserFields(hasAvatarUrl, hasResponseTime)},
              t.user_id AS owner_id,
              ${ownerRatingExpr} AS owner_rating
         FROM tool_rentals t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
        ${where}
          AND u.is_active = TRUE
          AND u.deleted_at IS NULL
          AND u.email_verified = TRUE
          AND u.onboarding_completed = TRUE
        ORDER BY ${orderBy}
        LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );
    res.json({ tools: attachPublicOwnerNames(result.rows) });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] browse error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
}

router.get('/', browseTools);
router.get('/browse', browseTools);

// GET /api/tool-rentals/public/:id - single listing for deep links (Discover, etc.)
router.get('/public/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid tool id' });
    const { toolFields, ownerRatingExpr, hasAvatarUrl, hasResponseTime, hasModerationHold } = await getToolFields();
    // An admin moderation hold hides the listing even if is_available is on.
    const holdFilter = hasModerationHold ? ' AND NOT t.moderation_hold' : '';
    const result = await pool.query(
      `SELECT ${toolFields},
              ${buildUserFields(hasAvatarUrl, hasResponseTime)},
              t.user_id AS owner_id,
              ${ownerRatingExpr} AS owner_rating
         FROM tool_rentals t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
        WHERE t.id = $1
          AND t.is_available = TRUE
          AND u.is_active = TRUE
          AND u.deleted_at IS NULL
          AND u.email_verified = TRUE
          AND u.onboarding_completed = TRUE${holdFilter}`,
      [id],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tool not found' });
    return res.json({ tool: attachPublicOwnerNames(result.rows)[0] });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] public get error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch tool' });
  }
});

// GET /api/tool-rentals/me
// Group 11 item 555: the owner-facing activation-status surface reads this
// endpoint, so each row carries the flags the status derives from:
// moderation_hold and image_gallery (readiness, item 552) plus the
// publication_blocked and activation_status computed from the owner's
// tool_owner.list_equipment grant (same gate POST/PUT apply).
router.get('/me', authenticate, async (req, res) => {
  try {
    const { toolFields, hasImageGallery, hasModerationHold } = await getToolFields();
    const galleryExpr = hasImageGallery ? 't.image_gallery' : 'NULL::text[] AS image_gallery';
    const holdExpr = hasModerationHold ? 't.moderation_hold' : 'FALSE AS moderation_hold';
    const result = await pool.query(
      `SELECT ${toolFields}, ${galleryExpr}, ${holdExpr}
         FROM tool_rentals t
        WHERE t.user_id = $1
        ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    let publicationBlocked = false;
    try {
      const flags = require('../services/access/flags');
      if (flags.toolOwnerEnforcement() !== 'off' && !['admin', 'super_admin'].includes(req.user.role)) {
        const access = require('../services/access/accessService');
        publicationBlocked = !(await access.can(req.user.id, 'tool_owner.list_equipment')).allowed;
      }
    } catch { publicationBlocked = false; }
    const { computeListingReadiness } = require('../services/toolListingReadiness');
    res.json({
      tools: result.rows.map((tool) => {
        const activationStatus = tool.moderation_hold === true
          ? 'blocked_hold'
          : publicationBlocked
            ? 'blocked_access'
            : tool.is_available === false
              ? 'unavailable'
              : 'published';
        // 552: server-computed readiness checklist for the owner dashboard.
        return { ...tool, publication_blocked: publicationBlocked, activation_status: activationStatus, readiness: computeListingReadiness(tool) };
      }),
    });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch your tools' });
  }
});

// PAYMENT METHODS (Option C)
// NOTE: static paths must be registered before /:toolId/* and /:id or
// Express matches them as tool IDs and these routes are never reached.
router.get('/payment-method', authenticate, paymentMethodController.getPaymentMethod);
router.post('/payment-method', authenticate, paymentMethodController.setPaymentMethod);
router.delete('/payment-method', authenticate, paymentMethodController.deletePaymentMethod);

// POST /api/tool-rentals
router.post('/', authenticate, toolOwnerCapabilityGate, upload.single('image'), validateFileUpload, async (req, res) => {
  let uploadedKey = null;
  try {
    const { payload, errors } = normalizeToolPayload(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', code: 'validation_failed', fields: errors });
    }
    if (req.toolOwnerAccessPending) payload.is_available = false;
    const { hasImageGallery } = await getToolFields();
    const imageResult = hasImageGallery ? await resolveToolImageUrl(req) : { url: null, key: null };
    const imageUrl = imageResult.url;
    uploadedKey = imageResult.key;
    const insertColumns = [
      'user_id', 'name', 'category', 'description',
      'daily_rate', 'hourly_rate', 'deposit_amount',
      'condition', 'brand', 'model',
      'is_available', 'requires_deposit', 'delivery_available', 'pickup_only',
      'location_city', 'location_state', 'owner_rules', 'owner_custom_terms',
      'owner_custom_terms_hash', 'replacement_value',
      'owner_attested_at', 'owner_attestation_version',
      // 563: capacity / size / weight (migration 20261124011000).
      'capacity_value', 'capacity_unit', 'weight_kg',
      'size_length_cm', 'size_width_cm', 'size_height_cm',
    ];
    const insertValues = [
      req.user.id,
      payload.name,
      payload.category,
      payload.description,
      payload.daily_rate,
      payload.hourly_rate,
      payload.deposit_amount,
      payload.condition,
      payload.brand,
      payload.model,
      payload.is_available ?? true,
      payload.requires_deposit ?? false,
      payload.delivery_available ?? false,
      payload.pickup_only ?? true,
      payload.location_city,
      payload.location_state,
      payload.owner_rules,
      payload.owner_custom_terms,
      payload.owner_custom_terms_hash,
      payload.replacement_value,
      new Date(),
      TOOL_RENTAL_ATTESTATION_VERSION,
      payload.capacity_value ?? null,
      payload.capacity_unit ?? null,
      payload.weight_kg ?? null,
      payload.size_length_cm ?? null,
      payload.size_width_cm ?? null,
      payload.size_height_cm ?? null,
    ];
    if (hasImageGallery && imageUrl) {
      insertColumns.push('image_gallery');
      insertValues.push([imageUrl]);
    }
    const placeholders = insertValues.map((_, index) => `$${index + 1}`).join(',');

    const result = await pool.query(
      `INSERT INTO tool_rentals
         (${insertColumns.join(', ')})
       VALUES (${placeholders})
       RETURNING id, user_id, name, category, description,
                 daily_rate, hourly_rate, deposit_amount,
                 condition, brand, model, is_available,
                 requires_deposit, delivery_available, pickup_only,
                 location_city, location_state, owner_rules, owner_custom_terms,
                 owner_custom_terms_hash, replacement_value,
                 capacity_value, capacity_unit, weight_kg,
                 size_length_cm, size_width_cm, size_height_cm,
                 owner_attested_at, owner_attestation_version,
                 created_at, updated_at`,
      insertValues
    );

    uploadedKey = null;
    res.status(201).json({
      tool: result.rows[0],
      publication_blocked: Boolean(req.toolOwnerAccessPending),
      ...(req.toolOwnerAccessPending ? { code: 'access_required', capability: 'tool_owner.list_equipment' } : {}),
    });

    // ── Fan out alerts to users with matching saved searches ────────────────
    // Fire-and-forget: alerts must never fail tool creation.
    if (typeof notifyToolSearches === 'function') {
      notifyToolSearches(result.rows[0]).catch(() => {});
    }
  } catch (err) {
    if (uploadedKey) {
      await deleteFile(uploadedKey).catch((cleanupError) => {
        require('../utils/logger').warn('[toolRentals] failed to clean up uploaded image', {
          key: uploadedKey,
          error: cleanupError.message,
        });
      });
    }
    require('../utils/logger').error('[toolRentals] create error:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Failed to create tool listing' });
  }
});

// PUT /api/tool-rentals/:id
router.put('/:id', authenticate, toolOwnerCapabilityGate, upload.single('image'), validateFileUpload, async (req, res) => {
  let uploadedKey = null;
  try {
    const { id } = req.params;

    // Fetch existing record first (ownership check)
    const existing = await pool.query(
      'SELECT id, moderation_hold, capacity_value, capacity_unit FROM tool_rentals WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Tool not found' });
    }
    const underAdminHold = existing.rows[0].moderation_hold === true;

    const { payload, errors } = normalizeToolPayload(req.body, { partial: true, existing: existing.rows[0] });
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', code: 'validation_failed', fields: errors });
    }
    if (underAdminHold) {
      // An admin moderation hold is independent of the owner's is_available
      // flag: owner edits can neither clear the hold nor re-enable listing.
      payload.is_available = false;
    }
    if (req.toolOwnerAccessPending) payload.is_available = false;
    const { hasImageGallery } = await getToolFields();
    const imageResult = hasImageGallery ? await resolveToolImageUrl(req) : { url: null, key: null };
    const imageUrl = imageResult.url;
    uploadedKey = imageResult.key;
    const removeImage = hasImageGallery ? parseBoolean(req.body.remove_image) : false;
    const imageSetSql = hasImageGallery
      ? `image_gallery = CASE
           WHEN $21::boolean THEN '{}'::text[]
           WHEN $22::text IS NOT NULL THEN ARRAY[$22::text]
           ELSE image_gallery
         END,`
      : '';
    // 563: capacity columns sit after the image params, so their positions
    // shift by two when the gallery column exists.
    const capacityBase = hasImageGallery ? 23 : 21;
    const capacitySetSql = `
         capacity_value = COALESCE($${capacityBase}, capacity_value),
         capacity_unit  = COALESCE($${capacityBase + 1}, capacity_unit),
         weight_kg      = COALESCE($${capacityBase + 2}, weight_kg),
         size_length_cm = COALESCE($${capacityBase + 3}, size_length_cm),
         size_width_cm  = COALESCE($${capacityBase + 4}, size_width_cm),
         size_height_cm = COALESCE($${capacityBase + 5}, size_height_cm),`;
    const whereOffset = capacityBase + 7; // six capacity params, then id, then user_id

    const result = await pool.query(
      `UPDATE tool_rentals SET
         name               = COALESCE($1,  name),
         category           = COALESCE($2,  category),
         description        = COALESCE($3,  description),
         daily_rate         = COALESCE($4, daily_rate),
         hourly_rate        = COALESCE($5, hourly_rate),
         deposit_amount     = COALESCE($6, deposit_amount),
         condition          = COALESCE($7,  condition),
         brand              = COALESCE($8,  brand),
         model              = COALESCE($9,  model),
         is_available       = COALESCE($10, is_available),
         requires_deposit   = COALESCE($11, requires_deposit),
         delivery_available = COALESCE($12, delivery_available),
         pickup_only        = COALESCE($13, pickup_only),
         location_city      = COALESCE($14, location_city),
         location_state     = COALESCE($15, location_state),
         owner_rules        = COALESCE($16, owner_rules),
         owner_custom_terms = COALESCE($17, owner_custom_terms),
         owner_custom_terms_hash = COALESCE($18, owner_custom_terms_hash),
         replacement_value  = COALESCE($19, replacement_value),
         owner_attested_at  = CASE WHEN $20::boolean THEN NOW() ELSE owner_attested_at END,
         owner_attestation_version = CASE WHEN $20::boolean THEN '${TOOL_RENTAL_ATTESTATION_VERSION}' ELSE owner_attestation_version END,
         ${imageSetSql}
         ${capacitySetSql}
         updated_at         = NOW()
       WHERE id = $${whereOffset - 1} AND user_id = $${whereOffset}
       RETURNING id, user_id, name, category, description,
                 daily_rate, hourly_rate, deposit_amount,
                 condition, brand, model, is_available,
                 requires_deposit, delivery_available, pickup_only,
                 location_city, location_state, owner_rules, owner_custom_terms,
                 owner_custom_terms_hash, replacement_value,
                 capacity_value, capacity_unit, weight_kg,
                 size_length_cm, size_width_cm, size_height_cm,
                 owner_attested_at, owner_attestation_version,
                 created_at, updated_at`,
      [
        payload.name ?? null,
        payload.category ?? null,
        payload.description ?? null,
        payload.daily_rate ?? null,
        payload.hourly_rate ?? null,
        payload.deposit_amount ?? null,
        payload.condition ?? null,
        payload.brand ?? null,
        payload.model ?? null,
        payload.is_available       !== undefined ? payload.is_available       : null,
        payload.requires_deposit   !== undefined ? payload.requires_deposit   : null,
        payload.delivery_available !== undefined ? payload.delivery_available : null,
        payload.pickup_only        !== undefined ? payload.pickup_only        : null,
        payload.location_city ?? null,
        payload.location_state ?? null,
        payload.owner_rules ?? null,
        payload.owner_custom_terms ?? null,
        payload.owner_custom_terms_hash ?? null,
        payload.replacement_value ?? null,
        !!payload.owner_attestation_accepted,
        ...(hasImageGallery ? [removeImage, imageUrl] : []),
        payload.capacity_value ?? null,
        payload.capacity_unit ?? null,
        payload.weight_kg ?? null,
        payload.size_length_cm ?? null,
        payload.size_width_cm ?? null,
        payload.size_height_cm ?? null,
        id,
        req.user.id,
      ]
    );

    uploadedKey = null;
    res.json({
      tool: result.rows[0],
      publication_blocked: Boolean(req.toolOwnerAccessPending),
      ...(req.toolOwnerAccessPending ? { code: 'access_required', capability: 'tool_owner.list_equipment' } : {}),
    });
  } catch (err) {
    if (uploadedKey) {
      await deleteFile(uploadedKey).catch((cleanupError) => {
        require('../utils/logger').warn('[toolRentals] failed to clean up uploaded image', {
          key: uploadedKey,
          error: cleanupError.message,
        });
      });
    }
    require('../utils/logger').error('[toolRentals] update error:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Failed to update tool listing' });
  }
});

// DELETE /api/tool-rentals/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM tool_rentals WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Tool not found' });
    }
    res.json({ deleted: true });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete tool listing' });
  }
});

// FAVORITES
router.get('/favorites', authenticate, toolFavoritesController.getFavorites);
router.post('/:toolId/favorite', authenticate, toolFavoritesController.toggleFavorite);
router.get('/:toolId/is-favorited', authenticate, toolFavoritesController.isFavorited);

// REVIEWS
router.get('/:toolId/reviews', toolReviewsController.getToolReviews);
router.post('/:toolId/review', authenticate, toolReviewsController.submitReview);

// BOOKINGS
router.post('/bookings', authenticate, toolBookingsController.createBooking);
router.get('/bookings/my', authenticate, toolBookingsController.getMyBookings);
router.get('/bookings/owner', authenticate, toolBookingsController.getBookingsByOwner);
router.get('/:toolId/availability', toolBookingsController.checkAvailability);
router.put('/bookings/:bookingId', authenticate, toolBookingsController.updateBookingStatus);

// ANALYTICS
router.post('/analytics/track', authenticate, generalLimiter, toolAnalyticsController.trackEvent);
router.get('/:toolId/analytics', toolAnalyticsController.getAnalytics);
router.get('/analytics/top', toolAnalyticsController.getTopTools);
router.get('/analytics/dashboard', authenticate, toolAnalyticsController.getOwnerDashboard);

// NOTIFICATIONS
router.get('/notifications/prefs', authenticate, toolNotificationsController.getNotificationPrefs);
router.put('/notifications/prefs', authenticate, toolNotificationsController.updateNotificationPrefs);

// INVOICES (Option C)
router.post('/invoices', authenticate, invoiceLimiter, invoiceController.createInvoice);
router.get('/invoices/:invoiceId', authenticate, invoiceController.getInvoice);
router.get('/invoices/:invoiceId/pdf', authenticate, invoiceController.generateInvoicePDF);
router.post('/invoices/:invoiceId/confirm-payment', authenticate, invoiceLimiter, invoiceController.confirmPayment);
router.post('/bookings/:bookingId/deposit/resolve', authenticate, invoiceLimiter, invoiceController.resolveDeposit);

// USER REPORTS (Option C)
router.post('/reports', authenticate, reportLimiter, userReportController.submitReport);
router.get('/reports/me/submitted', authenticate, userReportController.getMyReports);
router.get('/reports/me/against', authenticate, userReportController.getReportsAgainstMe);
router.get('/admin/reports', authenticate, requireAdmin, requirePermission('moderate_content'), userReportController.adminGetReports);
router.put('/admin/reports/:reportId', authenticate, requireAdmin, requirePermission('moderate_content'), userReportController.adminUpdateReportStatus);

// TERMS & CONDITIONS (Option C)
router.get('/terms', termsController.getTerms);
router.post('/terms/accept', authenticate, termsLimiter, termsController.acceptTerms);
router.get('/bookings/:bookingId/terms-status', authenticate, termsController.getBookingTermsStatus);

module.exports = router;
