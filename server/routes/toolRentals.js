// server/routes/toolRentals.js
// Tool Rental listings - any authenticated user can manage their tools for rent
// GET    /api/tool-rentals/me         → list my tools
// POST   /api/tool-rentals            → create tool listing
// PUT    /api/tool-rentals/:id        → update tool listing
// DELETE /api/tool-rentals/:id        → delete tool listing
// GET    /api/tool-rentals/browse     → public browse (no auth)

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { invoiceLimiter, reportLimiter, termsLimiter } = require('../middleware/rateLimiter');
const pool    = require('../db');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const { resolvePublicDisplayName } = require('../utils/publicDisplayName');
const toolFavoritesController = require('../controllers/toolFavoritesController');
const toolReviewsController = require('../controllers/toolReviewsController');
const toolBookingsController = require('../controllers/toolBookingsController');
const toolAnalyticsController = require('../controllers/toolAnalyticsController');
const toolNotificationsController = require('../controllers/toolNotificationsController');
const paymentMethodController = require('../controllers/paymentMethodController');
const invoiceController = require('../controllers/invoiceController');
const userReportController = require('../controllers/userReportController');
const termsController = require('../controllers/termsController');

// Base fields guaranteed present since migration 039
const TOOL_FIELDS_BASE = `
  t.id, t.user_id, t.name, t.category, t.description,
  t.daily_rate, t.hourly_rate, t.deposit_amount,
  t.condition, t.brand, t.model, t.is_available,
  t.requires_deposit, t.delivery_available, t.pickup_only,
  t.location_city, t.location_state, t.created_at, t.updated_at
`;

// Resolved lazily on first request — checks which optional columns exist so the
// query doesn't fail on databases where migration 078b hasn't applied yet.
let _resolvedFields = null;
async function getToolFields() {
  if (_resolvedFields) return _resolvedFields;
  try {
    // Check optional tool_rentals columns (added in 078b)
    const { rows: trCols } = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tool_rentals'
         AND column_name IN ('avg_rating', 'review_count', 'image_gallery')
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
    ].join(',\n  ');

    // Store which optional users columns are safe to select
    _resolvedFields = {
      toolFields: `${TOOL_FIELDS_BASE},\n  ${toolExtras}`,
      hasAvatarUrl: uc.has('avatar_url'),
      hasResponseTime: uc.has('avg_response_time_hours'),
      hasImageGallery: tr.has('image_gallery'),
    };
  } catch {
    _resolvedFields = {
      toolFields: `${TOOL_FIELDS_BASE},\n  0 AS avg_rating, 0 AS review_count, NULL AS image_url`,
      hasAvatarUrl: false,
      hasResponseTime: false,
      hasImageGallery: false,
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

const VALID_CONDITIONS = ['excellent', 'good', 'fair', 'poor'];
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

async function resolveToolImageUrl(req) {
  const file = req.file;
  if (file) {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      const err = new Error('Tool photo must be an image');
      err.status = 400;
      throw err;
    }

    const key = await uploadFile(file.buffer, 'tool-rentals', file.originalname, file.mimetype);
    if (key) return getPublicUrl(key);

    if (file.size > 2 * 1024 * 1024) {
      const err = new Error('Tool photo is too large. Configure file storage or upload an image under 2MB.');
      err.status = 400;
      throw err;
    }
    return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  }

  const imageUrl = cleanText(req.body.image_url, 2048, 'image_url', {});
  if (!imageUrl) return null;
  try {
    new URL(imageUrl);
  } catch {
    const err = new Error('Tool photo URL is invalid');
    err.status = 400;
    throw err;
  }
  return imageUrl;
}

function normalizeToolPayload(body, { partial = false } = {}) {
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

  if (!partial || body.condition !== undefined) {
    payload.condition = body.condition || null;
    if (payload.condition && !VALID_CONDITIONS.includes(payload.condition)) {
      errors.condition = 'Invalid condition value';
    }
  }

  for (const field of ['is_available', 'requires_deposit', 'delivery_available', 'pickup_only']) {
    if (!partial || body[field] !== undefined) {
      payload[field] = parseBoolean(body[field]);
    }
  }

  if (payload.requires_deposit && !(payload.deposit_amount > 0)) {
    errors.deposit_amount = 'deposit_amount is required when a deposit is required';
  }

  return { payload, errors };
}

// GET /api/tool-rentals/categories?q=pow&limit=20
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

// GET /api/tool-rentals/browse?category=&city=&name=&priceMin=&priceMax=&sort=&limit=30
router.get('/browse', async (req, res) => {
  try {
    const { category, city, name, priceMin, priceMax, sort = 'newest', limit = 30, offset = 0 } = req.query;
    const params = [true];
    let where = 'WHERE t.is_available = $1';
    let idx = 2;

    if (category) { where += ` AND t.category ILIKE $${idx++}`; params.push(`%${category}%`); }
    if (city)     { where += ` AND t.location_city ILIKE $${idx++}`; params.push(`%${city}%`); }
    if (name)     { where += ` AND t.name ILIKE $${idx++}`; params.push(`%${name}%`); }
    if (priceMin) { where += ` AND t.daily_rate >= $${idx++}`; params.push(parseFloat(priceMin)); }
    if (priceMax) { where += ` AND t.daily_rate <= $${idx++}`; params.push(parseFloat(priceMax)); }

    let orderBy = 't.created_at DESC';
    if (sort === 'price-asc') orderBy = 't.daily_rate ASC';
    if (sort === 'price-desc') orderBy = 't.daily_rate DESC';

    params.push(Math.min(parseInt(limit) || 30, 100));
    params.push(parseInt(offset) || 0);

    const { toolFields, hasAvatarUrl, hasResponseTime } = await getToolFields();
    const result = await pool.query(
      `SELECT ${toolFields},
              ${buildUserFields(hasAvatarUrl, hasResponseTime)},
              t.user_id AS owner_id,
              COALESCE(t.avg_rating, 0) AS owner_rating
         FROM tool_rentals t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
        ${where}
        ORDER BY ${orderBy}
        LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );
    res.json({ tools: attachPublicOwnerNames(result.rows) });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] browse error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
});

// GET /api/tool-rentals/public/:id - single listing for deep links (Discover, etc.)
router.get('/public/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid tool id' });
    const { toolFields, hasAvatarUrl, hasResponseTime } = await getToolFields();
    const result = await pool.query(
      `SELECT ${toolFields},
              ${buildUserFields(hasAvatarUrl, hasResponseTime)},
              t.user_id AS owner_id,
              COALESCE(t.avg_rating, 0) AS owner_rating
         FROM tool_rentals t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
        WHERE t.id = $1 AND t.is_available = TRUE AND u.is_active = TRUE`,
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
router.get('/me', authenticate, async (req, res) => {
  try {
    const { toolFields } = await getToolFields();
    const result = await pool.query(
      `SELECT ${toolFields}
         FROM tool_rentals t
        WHERE t.user_id = $1
        ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    res.json({ tools: result.rows });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch your tools' });
  }
});

// POST /api/tool-rentals
router.post('/', authenticate, upload.single('image'), validateFileUpload, async (req, res) => {
  try {
    const { payload, errors } = normalizeToolPayload(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', code: 'validation_failed', fields: errors });
    }
    const { hasImageGallery } = await getToolFields();
    const imageUrl = hasImageGallery ? await resolveToolImageUrl(req) : null;
    const insertColumns = [
      'user_id', 'name', 'category', 'description',
      'daily_rate', 'hourly_rate', 'deposit_amount',
      'condition', 'brand', 'model',
      'is_available', 'requires_deposit', 'delivery_available', 'pickup_only',
      'location_city', 'location_state',
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
                 location_city, location_state, created_at, updated_at`,
      insertValues
    );

    res.status(201).json({ tool: result.rows[0] });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] create error:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Failed to create tool listing' });
  }
});

// PUT /api/tool-rentals/:id
router.put('/:id', authenticate, upload.single('image'), validateFileUpload, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch existing record first (ownership check)
    const existing = await pool.query(
      'SELECT id FROM tool_rentals WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    const { payload, errors } = normalizeToolPayload(req.body, { partial: true });
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', code: 'validation_failed', fields: errors });
    }
    const { hasImageGallery } = await getToolFields();
    const imageUrl = hasImageGallery ? await resolveToolImageUrl(req) : null;
    const removeImage = hasImageGallery ? parseBoolean(req.body.remove_image) : false;
    const imageSetSql = hasImageGallery
      ? `image_gallery = CASE
           WHEN $16::boolean THEN '{}'::text[]
           WHEN $17::text IS NOT NULL THEN ARRAY[$17::text]
           ELSE image_gallery
         END,`
      : '';
    const whereOffset = hasImageGallery ? 19 : 17;

    const result = await pool.query(
      `UPDATE tool_rentals SET
         name               = COALESCE($1,  name),
         category           = COALESCE($2,  category),
         description        = COALESCE($3,  description),
         daily_rate         = $4,
         hourly_rate        = $5,
         deposit_amount     = $6,
         condition          = COALESCE($7,  condition),
         brand              = COALESCE($8,  brand),
         model              = COALESCE($9,  model),
         is_available       = COALESCE($10, is_available),
         requires_deposit   = COALESCE($11, requires_deposit),
         delivery_available = COALESCE($12, delivery_available),
         pickup_only        = COALESCE($13, pickup_only),
         location_city      = COALESCE($14, location_city),
         location_state     = COALESCE($15, location_state),
         ${imageSetSql}
         updated_at         = NOW()
       WHERE id = $${whereOffset - 1} AND user_id = $${whereOffset}
       RETURNING id, user_id, name, category, description,
                 daily_rate, hourly_rate, deposit_amount,
                 condition, brand, model, is_available,
                 requires_deposit, delivery_available, pickup_only,
                 location_city, location_state, created_at, updated_at`,
      [
        payload.name ?? null,
        payload.category ?? null,
        payload.description ?? null,
        payload.daily_rate,
        payload.hourly_rate,
        payload.deposit_amount,
        payload.condition ?? null,
        payload.brand ?? null,
        payload.model ?? null,
        payload.is_available       !== undefined ? payload.is_available       : null,
        payload.requires_deposit   !== undefined ? payload.requires_deposit   : null,
        payload.delivery_available !== undefined ? payload.delivery_available : null,
        payload.pickup_only        !== undefined ? payload.pickup_only        : null,
        payload.location_city ?? null,
        payload.location_state ?? null,
        ...(hasImageGallery ? [removeImage, imageUrl] : []),
        id,
        req.user.id,
      ]
    );

    res.json({ tool: result.rows[0] });
  } catch (err) {
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
router.post('/analytics/track', toolAnalyticsController.trackEvent);
router.get('/:toolId/analytics', toolAnalyticsController.getAnalytics);
router.get('/analytics/top', toolAnalyticsController.getTopTools);
router.get('/analytics/dashboard', authenticate, toolAnalyticsController.getOwnerDashboard);

// NOTIFICATIONS
router.get('/notifications/prefs', authenticate, toolNotificationsController.getNotificationPrefs);
router.put('/notifications/prefs', authenticate, toolNotificationsController.updateNotificationPrefs);

// PAYMENT METHODS (Option C)
router.get('/payment-method', authenticate, paymentMethodController.getPaymentMethod);
router.post('/payment-method', authenticate, paymentMethodController.setPaymentMethod);
router.delete('/payment-method', authenticate, paymentMethodController.deletePaymentMethod);

// INVOICES (Option C)
router.post('/invoices', authenticate, invoiceLimiter, invoiceController.createInvoice);
router.get('/invoices/:invoiceId', authenticate, invoiceController.getInvoice);
router.get('/invoices/:invoiceId/pdf', authenticate, invoiceController.generateInvoicePDF);
router.post('/invoices/:invoiceId/confirm-payment', authenticate, invoiceLimiter, invoiceController.confirmPayment);

// USER REPORTS (Option C)
router.post('/reports', authenticate, reportLimiter, userReportController.submitReport);
router.get('/reports/me/submitted', authenticate, userReportController.getMyReports);
router.get('/reports/me/against', authenticate, userReportController.getReportsAgainstMe);
router.get('/admin/reports', authenticate, userReportController.adminGetReports);
router.put('/admin/reports/:reportId', authenticate, userReportController.adminUpdateReportStatus);

// TERMS & CONDITIONS (Option C)
router.get('/terms', termsController.getTerms);
router.post('/terms/accept', authenticate, termsLimiter, termsController.acceptTerms);
router.get('/bookings/:bookingId/terms-status', authenticate, termsController.getBookingTermsStatus);

module.exports = router;
