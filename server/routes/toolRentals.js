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
const toolRentalDisputesController = require('../controllers/toolRentalDisputesController');
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
    // capacity/size/weight in the 563 migration, location in the 564 migration,
    // pickup window in the 574 migration, return window + cleaning
    // instructions in the 576/580 migration)
    const { rows: trCols } = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tool_rentals'
         AND column_name IN ('avg_rating', 'review_count', 'image_gallery', 'location_lat', 'location_lng', 'moderation_hold',
           'capacity_value', 'capacity_unit', 'weight_kg', 'size_length_cm', 'size_width_cm', 'size_height_cm',
           'pickup_window_start', 'pickup_window_end',
           'return_window_start', 'return_window_end', 'cleaning_instructions')
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
      // 559: the full gallery rides with every listing read (browse,
      // public, alternatives, owner rows) so the client can render the
      // thumbnail strip; image_url above stays the cover (first photo).
      tr.has('image_gallery')
        ? 'COALESCE(t.image_gallery, ARRAY[]::text[]) AS image_gallery'
        : 'NULL::text[] AS image_gallery',
      tr.has('location_lat') ? 't.location_lat' : 'NULL::numeric AS location_lat',
      tr.has('location_lng') ? 't.location_lng' : 'NULL::numeric AS location_lng',
      tr.has('capacity_value') ? 't.capacity_value' : 'NULL::numeric AS capacity_value',
      tr.has('capacity_unit') ? 't.capacity_unit' : 'NULL AS capacity_unit',
      tr.has('weight_kg') ? 't.weight_kg' : 'NULL::numeric AS weight_kg',
      tr.has('size_length_cm') ? 't.size_length_cm' : 'NULL::numeric AS size_length_cm',
      tr.has('size_width_cm') ? 't.size_width_cm' : 'NULL::numeric AS size_width_cm',
      tr.has('size_height_cm') ? 't.size_height_cm' : 'NULL::numeric AS size_height_cm',
      tr.has('pickup_window_start') ? 't.pickup_window_start' : 'NULL::time AS pickup_window_start',
      tr.has('pickup_window_end') ? 't.pickup_window_end' : 'NULL::time AS pickup_window_end',
      tr.has('return_window_start') ? 't.return_window_start' : 'NULL::time AS return_window_start',
      tr.has('return_window_end') ? 't.return_window_end' : 'NULL::time AS return_window_end',
      tr.has('cleaning_instructions') ? 't.cleaning_instructions' : 'NULL AS cleaning_instructions',
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
      hasLocationColumns: tr.has('location_lat') && tr.has('location_lng'),
    };
  } catch {
    _resolvedFields = {
      toolFields: `${TOOL_FIELDS_BASE},\n  0 AS avg_rating, 0 AS review_count, NULL AS image_url, NULL::text[] AS image_gallery, NULL::numeric AS location_lat, NULL::numeric AS location_lng, NULL::numeric AS capacity_value, NULL AS capacity_unit, NULL::numeric AS weight_kg, NULL::numeric AS size_length_cm, NULL::numeric AS size_width_cm, NULL::numeric AS size_height_cm, NULL::time AS pickup_window_start, NULL::time AS pickup_window_end, NULL::time AS return_window_start, NULL::time AS return_window_end, NULL AS cleaning_instructions`,
      ownerRatingExpr: '0',
      hasAvatarUrl: false,
      hasResponseTime: false,
      hasImageGallery: false,
      hasModerationHold: false,
      hasCapacityColumns: false,
      hasLocationColumns: false,
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
// 565: side-by-side comparison cap. The client enforces the same cap
// (TOOL_COMPARE_MAX in client/src/types/toolDirectory.ts).
const TOOL_COMPARE_MAX = 3;
// 559 (D-290): a listing gallery holds at most 8 photos. The first photo
// is the cover (surfaced as image_url); the cap keeps the TEXT[] column,
// the browse payload and the owner editor all bounded.
const MAX_GALLERY_PHOTOS = 8;
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

// 564: pickup coordinates. A latitude/longitude pair or neither.
function parseCoordinate(value, field, min, max, errors) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    errors[field] = `${field} must be a number`;
    return null;
  }
  if (num < min || num > max) {
    errors[field] = `${field} is out of range`;
    return null;
  }
  return num;
}

// 574: pickup window times are HH:MM (24-hour). Blank means unset.
function parseTimeOfDay(value, field, errors) {
  if (value === undefined || value === null || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    errors[field] = `${field} must be a time like 09:30`;
    return null;
  }
  return text;
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

// 559 (D-290): per-file version of the single-image upload path above
// (same storage call, same data-URL fallback for unconfigured storage).
// The gallery add endpoint stores one uploaded file at a time through it;
// the caller owns deleting the returned key when the write fails.
async function resolveGalleryImageFile(file) {
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    const err = new Error('Gallery photos must be images');
    err.status = 400;
    throw err;
  }
  const key = await uploadFile(file.buffer, 'tool-rentals', file.originalname, file.mimetype);
  if (key) {
    const url = getPublicUrl(key);
    if (!url) {
      await deleteFile(key).catch((cleanupError) => {
        require('../utils/logger').warn('[toolRentals] failed to clean up gallery image without public URL', {
          key,
          error: cleanupError.message,
        });
      });
      const err = new Error('Gallery photo URL unavailable');
      err.status = 503;
      throw err;
    }
    return { url, key };
  }
  if (file.size > 2 * 1024 * 1024) {
    const err = new Error('Gallery photo is too large. Configure file storage or upload an image under 2MB.');
    err.status = 400;
    throw err;
  }
  return { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`, key: null };
}

// 559: owner-only gallery load. A stranger (or another owner) gets the
// same 404 as PUT /:id, so gallery membership never leaks.
async function loadOwnedToolGallery(toolId, userId) {
  const id = Number(toolId);
  if (!Number.isInteger(id) || id < 1) return { error: 'invalid' };
  const { rows } = await pool.query(
    'SELECT id, user_id, image_gallery FROM tool_rentals WHERE id = $1',
    [id],
  );
  const tool = rows[0];
  if (!tool || String(tool.user_id) !== String(userId)) return { error: 'not_found' };
  return { tool, gallery: Array.isArray(tool.image_gallery) ? tool.image_gallery : [] };
}

function galleryResponse(toolId, gallery) {
  return {
    tool_id: toolId,
    image_gallery: gallery,
    image_url: gallery.length ? gallery[0] : null,
  };
}

function parseGalleryOrder(body, storedGallery) {
  if (!body || !Array.isArray(body.image_gallery)) return { error: 'image_gallery must be an array of photo URLs' };
  if (body.image_gallery.length > MAX_GALLERY_PHOTOS) {
    return { error: `A listing can have up to ${MAX_GALLERY_PHOTOS} photos` };
  }
  const seen = new Set();
  for (const entry of body.image_gallery) {
    if (typeof entry !== 'string' || !entry.trim() || entry.trim().length > 2048) {
      return { error: 'image_gallery must be an array of photo URLs' };
    }
    const url = entry.trim();
    try {
      new URL(url);
    } catch {
      return { error: 'image_gallery must be an array of photo URLs' };
    }
    if (seen.has(url)) return { error: 'image_gallery must not repeat a photo' };
    if (!storedGallery.includes(url)) return { error: 'image_gallery can only reorder photos already in the gallery' };
    seen.add(url);
  }
  return { gallery: body.image_gallery.map((entry) => entry.trim()) };
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

  // 564: pickup coordinates, same pair rule as capacity (merged with the
  // stored row on partial updates).
  if (!partial || body.location_lat !== undefined) {
    payload.location_lat = parseCoordinate(body.location_lat, 'location_lat', -90, 90, errors);
  }
  if (!partial || body.location_lng !== undefined) {
    payload.location_lng = parseCoordinate(body.location_lng, 'location_lng', -180, 180, errors);
  }
  const mergedLat = payload.location_lat ?? existing?.location_lat ?? null;
  const mergedLng = payload.location_lng ?? existing?.location_lng ?? null;
  if ((mergedLat != null) !== (mergedLng != null)) {
    errors.location_lat = 'location_lat and location_lng must be set together';
  }

  // 574: pickup window, same pair rule as capacity (merged with the
  // stored row on partial updates). Blank means the owner sets no
  // window and the renter may pick any time.
  if (!partial || body.pickup_window_start !== undefined) {
    payload.pickup_window_start = parseTimeOfDay(body.pickup_window_start, 'pickup_window_start', errors);
  }
  if (!partial || body.pickup_window_end !== undefined) {
    payload.pickup_window_end = parseTimeOfDay(body.pickup_window_end, 'pickup_window_end', errors);
  }
  const mergedWindowStart = payload.pickup_window_start ?? existing?.pickup_window_start ?? null;
  const mergedWindowEnd = payload.pickup_window_end ?? existing?.pickup_window_end ?? null;
  if ((mergedWindowStart != null) !== (mergedWindowEnd != null)) {
    errors.pickup_window_start = 'pickup_window_start and pickup_window_end must be set together';
  }
  if (mergedWindowStart != null && mergedWindowEnd != null && mergedWindowEnd <= mergedWindowStart) {
    errors.pickup_window_end = 'pickup_window_end must be after pickup_window_start';
  }

  // 576: return window, same pair rule as the pickup window (merged with
  // the stored row on partial updates). Blank means the owner sets no
  // window and the renter may pick any return time.
  if (!partial || body.return_window_start !== undefined) {
    payload.return_window_start = parseTimeOfDay(body.return_window_start, 'return_window_start', errors);
  }
  if (!partial || body.return_window_end !== undefined) {
    payload.return_window_end = parseTimeOfDay(body.return_window_end, 'return_window_end', errors);
  }
  const mergedReturnStart = payload.return_window_start ?? existing?.return_window_start ?? null;
  const mergedReturnEnd = payload.return_window_end ?? existing?.return_window_end ?? null;
  if ((mergedReturnStart != null) !== (mergedReturnEnd != null)) {
    errors.return_window_start = 'return_window_start and return_window_end must be set together';
  }
  if (mergedReturnStart != null && mergedReturnEnd != null && mergedReturnEnd <= mergedReturnStart) {
    errors.return_window_end = 'return_window_end must be after return_window_start';
  }

  // 580: owner-written cleaning instructions for the renter. Plain text,
  // shown at booking and at return, frozen into the agreement snapshot.
  if (!partial || body.cleaning_instructions !== undefined) {
    payload.cleaning_instructions = cleanText(body.cleaning_instructions, MAX_TOOL_DESCRIPTION_LEN, 'cleaning_instructions', errors);
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
// Group 11 item 564: a pickup distance filter. lat+lng+radius (miles) keep
// only listings within the radius, computed with haversine in SQL; results
// carry distance_miles and, with no explicit sort, come back nearest first.
async function browseTools(req, res) {
  try {
    const { category, city, name, priceMin, priceMax, sort = 'newest', limit = 30, offset = 0, startDate, endDate,
      capacityMin, capacityUnit, weightMax, lengthMax, widthMax, heightMax,
      lat, lng, radius, ids } = req.query;
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

    // 565: compare fetch. `ids` is a comma-separated list of 1-3 numeric
    // listing ids; the rows come back in the requested order (see the
    // ORDER BY override below) and still pass every public gate in this
    // query (availability, owner status, moderation hold).
    let idsFilter = null;
    let idsIdx = null;
    if (ids !== undefined) {
      const parsed = String(ids).split(',').map((s) => s.trim()).filter(Boolean);
      if (parsed.length === 0 || parsed.length > TOOL_COMPARE_MAX || parsed.some((s) => !/^\d+$/.test(s))) {
        return res.status(400).json({
          error: 'Invalid ids',
          code: 'validation_failed',
          fields: { ids: `Provide 1 to ${TOOL_COMPARE_MAX} numeric listing ids` },
        });
      }
      idsFilter = parsed.map(Number);
    }

    const { toolFields, ownerRatingExpr, hasAvatarUrl, hasResponseTime, hasModerationHold, hasCapacityColumns, hasLocationColumns } = await getToolFields();
    // An admin moderation hold (e.g. safety recall) keeps the tool out of the
    // public listing even if the owner flips is_available back on.
    if (hasModerationHold) where += ' AND NOT t.moderation_hold';

    if (category) { where += ` AND t.category ILIKE $${idx++}`; params.push(`%${category}%`); }
    if (city)     { where += ` AND t.location_city ILIKE $${idx++}`; params.push(`%${city}%`); }
    if (name)     { where += ` AND t.name ILIKE $${idx++}`; params.push(`%${name}%`); }
    if (idsFilter) {
      idsIdx = idx++;
      params.push(idsFilter);
      where += ` AND t.id = ANY($${idsIdx}::int[])`;
    }
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
    // 564: pickup distance filter. lat+lng+radius arrive together (a radius
    // without a point, or a point without a radius, is a 400); listings
    // without coordinates never match an active distance filter. Distance is
    // haversine in SQL, miles, with the acos argument clamped so float
    // error on coincident points cannot push it out of [-1, 1]. The same
    // lat/lng placeholders are reused in the SELECT and the WHERE, so the
    // values are bound once.
    let distanceSelect = '';
    let distanceFilter = null;
    if (lat !== undefined || lng !== undefined || radius !== undefined) {
      const latN = Number(lat);
      const lngN = Number(lng);
      const radiusN = Number(radius);
      const distanceErrors = {};
      if (!Number.isFinite(latN) || latN < -90 || latN > 90) distanceErrors.lat = 'Invalid latitude';
      if (!Number.isFinite(lngN) || lngN < -180 || lngN > 180) distanceErrors.lng = 'Invalid longitude';
      if (!Number.isFinite(radiusN) || radiusN <= 0 || radiusN > 500) distanceErrors.radius = 'Invalid radius';
      if (Object.keys(distanceErrors).length) {
        return res.status(400).json({ error: 'Invalid distance filter', code: 'validation_failed', fields: distanceErrors });
      }
      if (!hasLocationColumns) {
        return res.status(400).json({ error: 'Distance filter is unavailable', code: 'unavailable' });
      }
      distanceFilter = { lat: latN, lng: lngN, radius: radiusN };
      const latIdx = idx++;
      const lngIdx = idx++;
      const radiusIdx = idx++;
      params.push(latN, lngN, radiusN);
      const haversine = `(3959 * acos(LEAST(1, GREATEST(-1, cos(radians($${latIdx})) * cos(radians(t.location_lat)) * cos(radians(t.location_lng) - radians($${lngIdx})) + sin(radians($${latIdx})) * sin(radians(t.location_lat))))))`;
      distanceSelect = `, ${haversine} AS distance_miles`;
      where += ` AND t.location_lat IS NOT NULL AND t.location_lng IS NOT NULL AND ${haversine} <= $${radiusIdx}`;
    }
    if (sort === 'distance' && !distanceFilter) {
      return res.status(400).json({ error: 'Invalid sort', code: 'validation_failed', fields: { sort: 'distance sort requires lat, lng and radius' } });
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
    // 564: an explicit distance sort orders nearest first; with a distance
    // filter and no explicit sort, nearest first is the default too.
    if (sort === 'distance' || (distanceFilter && req.query.sort === undefined)) orderBy = 'distance_miles ASC';
    // 565: a compare fetch comes back in the requested id order.
    if (idsFilter) orderBy = `array_position($${idsIdx}::int[], t.id)`;

    params.push(Math.min(parseInt(limit) || 30, 100));
    params.push(parseInt(offset) || 0);

    const result = await pool.query(
      `SELECT ${toolFields}${distanceSelect},
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

// Group 11 item 584 (D-279): replacement listing suggestions. When a
// listing is unavailable for the requested dates (or a booking is
// cancelled), suggest alternatives: same category, free for the whole
// requested range (the 562 NOT EXISTS availability join), nearest first
// when a point is given (the 564 haversine), excluding the listing
// itself. The alternatives pass the same public gates as browse.
async function getToolAlternatives(req, res) {
  try {
    const toolId = parseInt(req.params.toolId, 10);
    if (!Number.isInteger(toolId) || toolId < 1) {
      return res.status(400).json({ error: 'Invalid tool id', code: 'validation_failed' });
    }
    const { startDate, endDate, lat, lng, radius } = req.query;
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 5), 10);
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
    const toolResult = await pool.query(
      'SELECT id, category FROM tool_rentals WHERE id = $1',
      [toolId]
    );
    if (!toolResult.rows.length) {
      return res.status(404).json({ error: 'Tool not found' });
    }
    const category = toolResult.rows[0].category;
    const { toolFields, ownerRatingExpr, hasAvatarUrl, hasResponseTime, hasModerationHold, hasLocationColumns } = await getToolFields();

    // 564: optional distance filter/ordering. lat+lng+radius arrive
    // together; a partial set is a 400, like browse.
    let distanceSelect = '';
    let distanceFilter = null;
    const params = [category, toolId, endDate, startDate];
    let idx = 5;
    if (lat !== undefined || lng !== undefined || radius !== undefined) {
      const latN = Number(lat);
      const lngN = Number(lng);
      const radiusN = Number(radius);
      const distanceErrors = {};
      if (!Number.isFinite(latN) || latN < -90 || latN > 90) distanceErrors.lat = 'Invalid latitude';
      if (!Number.isFinite(lngN) || lngN < -180 || lngN > 180) distanceErrors.lng = 'Invalid longitude';
      if (!Number.isFinite(radiusN) || radiusN <= 0 || radiusN > 500) distanceErrors.radius = 'Invalid radius';
      if (Object.keys(distanceErrors).length) {
        return res.status(400).json({ error: 'Invalid distance filter', code: 'validation_failed', fields: distanceErrors });
      }
      if (!hasLocationColumns) {
        return res.status(400).json({ error: 'Distance filter is unavailable', code: 'unavailable' });
      }
      distanceFilter = { lat: latN, lng: lngN, radius: radiusN };
      const latIdx = idx++;
      const lngIdx = idx++;
      const radiusIdx = idx++;
      params.push(latN, lngN, radiusN);
      const haversine = `(3959 * acos(LEAST(1, GREATEST(-1, cos(radians($${latIdx})) * cos(radians(t.location_lat)) * cos(radians(t.location_lng) - radians($${lngIdx})) + sin(radians($${latIdx})) * sin(radians(t.location_lat))))))`;
      distanceSelect = `, ${haversine} AS distance_miles`;
      params.push(limit);
      const limitIdx = idx++;
      const result = await pool.query(
        `SELECT ${toolFields}${distanceSelect},
                ${buildUserFields(hasAvatarUrl, hasResponseTime)},
                t.user_id AS owner_id,
                ${ownerRatingExpr} AS owner_rating
           FROM tool_rentals t
           JOIN users u ON u.id = t.user_id
           LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
          WHERE t.is_available = TRUE
            AND t.category = $1
            AND t.id <> $2
            ${hasModerationHold ? 'AND NOT t.moderation_hold' : ''}
            AND t.location_lat IS NOT NULL AND t.location_lng IS NOT NULL
            AND ${haversine} <= $${radiusIdx}
            AND NOT EXISTS (
              SELECT 1 FROM tool_rentals_bookings b
               WHERE b.tool_id = t.id
                 AND b.status IN ('pending', 'invoice_sent', 'payment_confirmed')
                 AND b.start_date <= $3
                 AND b.end_date >= $4
            )
            AND u.is_active = TRUE
            AND u.deleted_at IS NULL
            AND u.email_verified = TRUE
            AND u.onboarding_completed = TRUE
          ORDER BY distance_miles ASC
          LIMIT $${limitIdx}`,
        params
      );
      return res.json({ tools: attachPublicOwnerNames(result.rows) });
    }
    void distanceFilter;
    params.push(limit);
    const limitIdx = idx++;
    const result = await pool.query(
      `SELECT ${toolFields}${distanceSelect},
              ${buildUserFields(hasAvatarUrl, hasResponseTime)},
              t.user_id AS owner_id,
              ${ownerRatingExpr} AS owner_rating
         FROM tool_rentals t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
        WHERE t.is_available = TRUE
          AND t.category = $1
          AND t.id <> $2
          ${hasModerationHold ? 'AND NOT t.moderation_hold' : ''}
          AND NOT EXISTS (
            SELECT 1 FROM tool_rentals_bookings b
             WHERE b.tool_id = t.id
               AND b.status IN ('pending', 'invoice_sent', 'payment_confirmed')
               AND b.start_date <= $3
               AND b.end_date >= $4
          )
          AND u.is_active = TRUE
          AND u.deleted_at IS NULL
          AND u.email_verified = TRUE
          AND u.onboarding_completed = TRUE
        ORDER BY t.created_at DESC
        LIMIT $${limitIdx}`,
      params
    );
    res.json({ tools: attachPublicOwnerNames(result.rows) });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] alternatives error:', err.message);
    res.status(500).json({ error: 'Failed to fetch alternatives' });
  }
}

router.get('/:toolId/alternatives', getToolAlternatives);

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
    // Group 11 item 594: safety documents ride with the public listing so
    // a renter can read them before booking.
    let safetyDocuments = [];
    try {
      const { rows: docs } = await pool.query(
        `SELECT id, tool_id, title, file_url, mime_type, created_at
           FROM tool_rental_safety_documents WHERE tool_id = $1 ORDER BY created_at DESC`,
        [id],
      );
      safetyDocuments = docs;
    } catch { safetyDocuments = []; }
    return res.json({ tool: { ...attachPublicOwnerNames(result.rows)[0], safety_documents: safetyDocuments } });
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
    const { toolFields, hasModerationHold } = await getToolFields();
    const holdExpr = hasModerationHold ? 't.moderation_hold' : 'FALSE AS moderation_hold';
    const result = await pool.query(
      `SELECT ${toolFields}, ${holdExpr}
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
    // Group 11 item 594: safety documents ride with the owner's rows.
    let safetyByTool = new Map();
    try {
      const { rows: docs } = await pool.query(
        `SELECT id, tool_id, title, file_url, mime_type, created_at
           FROM tool_rental_safety_documents
          WHERE tool_id = ANY($1::int[]) ORDER BY created_at DESC`,
        [result.rows.map((t) => t.id)],
      );
      for (const doc of docs) {
        if (!safetyByTool.has(doc.tool_id)) safetyByTool.set(doc.tool_id, []);
        safetyByTool.get(doc.tool_id).push(doc);
      }
    } catch { safetyByTool = new Map(); }
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
        return { ...tool, publication_blocked: publicationBlocked, activation_status: activationStatus, readiness: computeListingReadiness(tool), safety_documents: safetyByTool.get(tool.id) || [] };
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
      // 564: pickup coordinates (migration 20261124011100).
      'location_lat', 'location_lng',
      // 574: pickup window (migration 20261124014500).
      'pickup_window_start', 'pickup_window_end',
      // 576/580: return window + cleaning instructions (migration 20261124023000).
      'return_window_start', 'return_window_end', 'cleaning_instructions',
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
      payload.location_lat ?? null,
      payload.location_lng ?? null,
      payload.pickup_window_start ?? null,
      payload.pickup_window_end ?? null,
      payload.return_window_start ?? null,
      payload.return_window_end ?? null,
      payload.cleaning_instructions ?? null,
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
                 location_lat, location_lng,
                 pickup_window_start, pickup_window_end,
                 return_window_start, return_window_end, cleaning_instructions,
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
      'SELECT id, is_available, moderation_hold, image_gallery, capacity_value, capacity_unit, location_lat, location_lng, pickup_window_start, pickup_window_end, return_window_start, return_window_end FROM tool_rentals WHERE id = $1 AND user_id = $2',
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
    // Group 11 item 595: returning a tool to availability is gated on the
    // server-side checklist (condition report filed for the last booking,
    // no unresolved missing accessories, no open damage claim, cleaning
    // confirmed). The client shows the checklist; the server enforces it.
    if (payload.is_available === true && existing.rows[0].is_available === false) {
      const cleaningConfirmed = req.body.cleaning_confirmed === true || req.body.cleaning_confirmed === 'true';
      const checklist = await toolRentalDisputesController.computeAvailabilityChecklist(Number(id), cleaningConfirmed);
      if (!checklist.complete) {
        return res.status(409).json({
          error: 'Return-to-availability checklist is incomplete',
          code: 'availability_checklist_incomplete',
          checks: checklist.checks,
        });
      }
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
    // 559: a single image uploaded on edit becomes the new cover (first
    // photo) instead of replacing the gallery: the old ARRAY[new] wiped
    // every other photo on any edit. Removing still clears the gallery.
    const existingGallery = Array.isArray(existing.rows[0].image_gallery)
      ? existing.rows[0].image_gallery
      : [];
    const newGallery = !hasImageGallery
      ? null
      : removeImage
        ? []
        : imageUrl
          ? [imageUrl, ...existingGallery.filter((url) => url !== imageUrl)].slice(0, MAX_GALLERY_PHOTOS)
          : null;
    const imageSetSql = hasImageGallery
      ? `image_gallery = CASE
           WHEN $21::boolean THEN '{}'::text[]
           WHEN $22::text[] IS NOT NULL THEN $22::text[]
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
    // 564: pickup coordinates sit after the capacity params.
    const locationBase = capacityBase + 6;
    const locationSetSql = `
         location_lat = COALESCE($${locationBase}, location_lat),
         location_lng = COALESCE($${locationBase + 1}, location_lng),`;
    // 574: pickup window sits after the location params.
    const pickupWindowBase = locationBase + 2;
    const pickupWindowSetSql = `
         pickup_window_start = COALESCE($${pickupWindowBase}, pickup_window_start),
         pickup_window_end = COALESCE($${pickupWindowBase + 1}, pickup_window_end),`;
    // 576: return window sits after the pickup window params.
    const returnWindowBase = pickupWindowBase + 2;
    const returnWindowSetSql = `
         return_window_start = COALESCE($${returnWindowBase}, return_window_start),
         return_window_end = COALESCE($${returnWindowBase + 1}, return_window_end),`;
    // 580: cleaning instructions sit after the return window params.
    const cleaningBase = returnWindowBase + 2;
    const cleaningSetSql = `
         cleaning_instructions = COALESCE($${cleaningBase}, cleaning_instructions),`;
    const whereOffset = cleaningBase + 2; // cleaning param, then id, then user_id

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
         ${locationSetSql}
         ${pickupWindowSetSql}
         ${returnWindowSetSql}
         ${cleaningSetSql}
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
                 location_lat, location_lng,
                 pickup_window_start, pickup_window_end,
                 return_window_start, return_window_end, cleaning_instructions,
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
        ...(hasImageGallery ? [removeImage, newGallery] : []),
        payload.capacity_value ?? null,
        payload.capacity_unit ?? null,
        payload.weight_kg ?? null,
        payload.size_length_cm ?? null,
        payload.size_width_cm ?? null,
        payload.size_height_cm ?? null,
        payload.location_lat ?? null,
        payload.location_lng ?? null,
        payload.pickup_window_start ?? null,
        payload.pickup_window_end ?? null,
        payload.return_window_start ?? null,
        payload.return_window_end ?? null,
        payload.cleaning_instructions ?? null,
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
// G11-A2 (D-604): a listing with a live booking cannot be deleted.
// Deleting would cascade the bookings, invoices, reports and claims
// (FKs ON DELETE CASCADE) and strand the renter mid-rental with no
// record. Live = pending / invoice_sent / payment_confirmed / returned
// (the live booking-status CHECK); completed / cancelled bookings do
// not block. Deliberately no toolOwnerCapabilityGate here: a revoked
// owner must still be able to remove their own listings.
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rows: live } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM tool_rentals_bookings
        WHERE tool_id = $1 AND owner_id = $2
          AND status IN ('pending', 'invoice_sent', 'payment_confirmed', 'returned')`,
      [req.params.id, req.user.id]
    );
    if (live[0]?.count > 0) {
      return res.status(409).json({
        error: 'This listing has active bookings and cannot be deleted',
        code: 'active_bookings',
        active_bookings: live[0].count,
      });
    }
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
router.post('/bookings/:bookingId/approve', authenticate, toolBookingsController.approveBooking);
router.post('/bookings/:bookingId/decline', authenticate, toolBookingsController.declineBooking);
router.post('/bookings/:bookingId/checkout-acknowledge', authenticate, toolBookingsController.acknowledgeCheckout);
// Group 11 item 576: return reschedule (renter proposes, owner decides).
router.post('/bookings/:bookingId/return-reschedule', authenticate, toolBookingsController.proposeReturnReschedule);
router.post('/bookings/:bookingId/return-reschedule/approve', authenticate, toolBookingsController.approveReturnReschedule);
router.post('/bookings/:bookingId/return-reschedule/decline', authenticate, toolBookingsController.declineReturnReschedule);
// Group 11 item 583: cancellation recovery (record-only refund agreement).
router.get('/bookings/:bookingId/recovery', authenticate, toolBookingsController.getCancellationRecovery);
router.post('/bookings/:bookingId/recovery/refund', authenticate, toolBookingsController.proposeRefundSettlement);
router.post('/bookings/:bookingId/recovery/confirm', authenticate, toolBookingsController.confirmRefundSettlement);
router.post('/bookings/:bookingId/recovery/settle', authenticate, toolBookingsController.settleRefundSettlement);
// Group 11 item 586/590: dedicated damage claim (record-only, D-257).
router.get('/bookings/:bookingId/damage-claims', authenticate, toolRentalDisputesController.listDamageClaims);
router.post('/bookings/:bookingId/damage-claims', authenticate, toolRentalDisputesController.fileDamageClaim);
router.post('/bookings/:bookingId/damage-claims/:claimId/resolve', authenticate, toolRentalDisputesController.resolveDamageClaim);
router.post('/bookings/:bookingId/damage-claims/:claimId/acknowledge', authenticate, toolRentalDisputesController.acknowledgeDamageClaim);
// Group 11 item 589: rental-specific escalation thread.
router.get('/bookings/:bookingId/escalations', authenticate, toolRentalDisputesController.listEscalations);
router.post('/bookings/:bookingId/escalations', authenticate, toolRentalDisputesController.openEscalation);
router.post('/escalations/:escalationId/messages', authenticate, toolRentalDisputesController.postEscalationMessage);
// Wave 3 (589, D-569): either party accepts or disputes an admin-closed
// escalation; a dispute reopens the thread.
router.post('/escalations/:escalationId/acknowledge', authenticate, toolRentalDisputesController.acknowledgeEscalation);
router.get('/admin/escalations', authenticate, requireAdmin, requirePermission('moderate_content'), toolRentalDisputesController.adminListEscalations);
router.get('/admin/escalations/:escalationId', authenticate, requireAdmin, requirePermission('moderate_content'), toolRentalDisputesController.adminGetEscalation);
router.post('/admin/escalations/:escalationId/messages', authenticate, requireAdmin, requirePermission('moderate_content'), toolRentalDisputesController.adminPostEscalationMessage);
router.post('/admin/escalations/:escalationId/status', authenticate, requireAdmin, requirePermission('moderate_content'), toolRentalDisputesController.adminSetEscalationStatus);
// Group 11 item 590: explicit acknowledgment of the missing-accessory (578)
// and deposit (588) resolutions.
router.post('/bookings/:bookingId/missing/:reportId/acknowledge', authenticate, toolRentalDisputesController.acknowledgeMissingResolution);
router.post('/bookings/:bookingId/deposit/acknowledge', authenticate, toolRentalDisputesController.acknowledgeDepositResolution);
// Group 11 item 591: maintenance calendar per tool.
router.get('/:toolId/maintenance', authenticate, toolRentalDisputesController.listMaintenanceEvents);
router.post('/:toolId/maintenance', authenticate, toolRentalDisputesController.createMaintenanceEvent);
router.post('/:toolId/maintenance/:eventId/complete', authenticate, toolRentalDisputesController.completeMaintenanceEvent);
router.post('/:toolId/maintenance/:eventId/cancel', authenticate, toolRentalDisputesController.cancelMaintenanceEvent);
// Group 11 item 594: safety documents per listing.
router.get('/:toolId/safety-documents', authenticate, toolRentalDisputesController.listSafetyDocuments);
router.get('/:toolId/safety-documents/public', toolRentalDisputesController.listPublicSafetyDocuments);
router.post('/:toolId/safety-documents', authenticate, upload.single('document'), validateFileUpload, toolRentalDisputesController.uploadSafetyDocument);
router.delete('/:toolId/safety-documents/:docId', authenticate, toolRentalDisputesController.deleteSafetyDocument);
router.get('/admin/tool-rentals/:toolId/safety-documents', authenticate, requireAdmin, requirePermission('moderate_content'), toolRentalDisputesController.adminListSafetyDocuments);
// Group 11 item 559: multi-photo gallery management (D-290). Owner-only,
// server-enforced via loadOwnedToolGallery (stranger 404). Photos are
// stored through the same upload path as the single listing image
// (resolveGalleryImageFile: uploadFile/getPublicUrl, data-URL fallback
// when no storage is configured). The first photo is the cover
// (image_url); reorder moves the cover, removing it promotes the next.
router.post('/:toolId/gallery', authenticate, upload.array('images', MAX_GALLERY_PHOTOS), validateFileUpload, async (req, res) => {
  const uploadedKeys = [];
  try {
    const { hasImageGallery } = await getToolFields();
    if (!hasImageGallery) return res.status(503).json({ error: 'Photo gallery is unavailable', code: 'unavailable' });
    const loaded = await loadOwnedToolGallery(req.params.toolId, req.user.id);
    if (loaded.error === 'invalid') return res.status(400).json({ error: 'Invalid tool id', code: 'validation_failed' });
    if (loaded.error) return res.status(404).json({ error: 'Tool not found' });
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: 'Choose at least one photo', code: 'validation_failed' });
    if (loaded.gallery.length + files.length > MAX_GALLERY_PHOTOS) {
      return res.status(400).json({ error: `A listing can have up to ${MAX_GALLERY_PHOTOS} photos`, code: 'gallery_full' });
    }
    const urls = [];
    for (const file of files) {
      const stored = await resolveGalleryImageFile(file);
      if (stored.key) uploadedKeys.push(stored.key);
      urls.push(stored.url);
    }
    const gallery = [...loaded.gallery, ...urls];
    await pool.query('UPDATE tool_rentals SET image_gallery = $1, updated_at = NOW() WHERE id = $2', [gallery, loaded.tool.id]);
    uploadedKeys.length = 0;
    return res.status(201).json(galleryResponse(loaded.tool.id, gallery));
  } catch (err) {
    for (const key of uploadedKeys) {
      await deleteFile(key).catch(() => {});
    }
    require('../utils/logger').error('[toolRentals] gallery add error:', err.message);
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Failed to add photos' });
  }
});
router.put('/:toolId/gallery', authenticate, async (req, res) => {
  try {
    const { hasImageGallery } = await getToolFields();
    if (!hasImageGallery) return res.status(503).json({ error: 'Photo gallery is unavailable', code: 'unavailable' });
    const loaded = await loadOwnedToolGallery(req.params.toolId, req.user.id);
    if (loaded.error === 'invalid') return res.status(400).json({ error: 'Invalid tool id', code: 'validation_failed' });
    if (loaded.error) return res.status(404).json({ error: 'Tool not found' });
    const parsed = parseGalleryOrder(req.body, loaded.gallery);
    if (parsed.error) return res.status(400).json({ error: parsed.error, code: 'validation_failed' });
    await pool.query('UPDATE tool_rentals SET image_gallery = $1, updated_at = NOW() WHERE id = $2', [parsed.gallery, loaded.tool.id]);
    return res.json(galleryResponse(loaded.tool.id, parsed.gallery));
  } catch (err) {
    require('../utils/logger').error('[toolRentals] gallery reorder error:', err.message);
    return res.status(500).json({ error: 'Failed to update photos' });
  }
});
router.delete('/:toolId/gallery/:index', authenticate, async (req, res) => {
  try {
    const { hasImageGallery } = await getToolFields();
    if (!hasImageGallery) return res.status(503).json({ error: 'Photo gallery is unavailable', code: 'unavailable' });
    const loaded = await loadOwnedToolGallery(req.params.toolId, req.user.id);
    if (loaded.error === 'invalid') return res.status(400).json({ error: 'Invalid tool id', code: 'validation_failed' });
    if (loaded.error) return res.status(404).json({ error: 'Tool not found' });
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= loaded.gallery.length) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    const gallery = loaded.gallery.filter((_, i) => i !== index);
    await pool.query('UPDATE tool_rentals SET image_gallery = $1, updated_at = NOW() WHERE id = $2', [gallery, loaded.tool.id]);
    return res.json(galleryResponse(loaded.tool.id, gallery));
  } catch (err) {
    require('../utils/logger').error('[toolRentals] gallery remove error:', err.message);
    return res.status(500).json({ error: 'Failed to remove photo' });
  }
});
// Group 11 item 595: return-to-availability checklist (read side; the
// flip itself is gated server-side in PUT /:id below).
router.get('/:toolId/availability-checklist', authenticate, toolRentalDisputesController.getAvailabilityChecklist);
// Group 11 item 600: repeat renters + follow-up notes.
router.get('/renters/repeat', authenticate, toolRentalDisputesController.listRepeatRenters);
router.post('/renters/followups', authenticate, toolRentalDisputesController.recordFollowup);
router.get('/bookings/:bookingId/receipt', authenticate, toolBookingsController.getBookingReceipt);
router.get('/:toolId/availability', toolBookingsController.checkAvailability);
router.put('/bookings/:bookingId', authenticate, toolBookingsController.updateBookingStatus);

// ANALYTICS
router.post('/analytics/track', authenticate, generalLimiter, toolAnalyticsController.trackEvent);
router.get('/analytics/utilization', authenticate, toolAnalyticsController.getUtilization);
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
router.post('/invoices/:invoiceId/record-payment', authenticate, invoiceLimiter, invoiceController.recordPayment);
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
