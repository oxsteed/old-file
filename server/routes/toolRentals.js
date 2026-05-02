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
const { invoiceLimiter, reportLimiter, termsLimiter } = require('../middleware/rateLimiter');
const pool    = require('../db');
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

// Extended fields added in migration 078b — resolved lazily on first browse request
let _toolFieldsResolved = null;
async function getToolFields() {
  if (_toolFieldsResolved) return _toolFieldsResolved;
  try {
    const { rows } = await pool.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_name = 'tool_rentals'
         AND column_name IN ('avg_rating','review_count','image_gallery')
    `);
    const cols = rows.map(r => r.column_name);
    const extras = [
      cols.includes('avg_rating')    ? 'COALESCE(t.avg_rating, 0) AS avg_rating'    : '0 AS avg_rating',
      cols.includes('review_count')  ? 'COALESCE(t.review_count, 0) AS review_count' : '0 AS review_count',
      cols.includes('image_gallery')
        ? `CASE WHEN t.image_gallery IS NOT NULL AND array_length(t.image_gallery, 1) > 0 THEN t.image_gallery[1] ELSE NULL END AS image_url`
        : 'NULL AS image_url',
    ].join(',\n  ');
    _toolFieldsResolved = `${TOOL_FIELDS_BASE},\n  ${extras}`;
  } catch {
    _toolFieldsResolved = `${TOOL_FIELDS_BASE},\n  0 AS avg_rating, 0 AS review_count, NULL AS image_url`;
  }
  return _toolFieldsResolved;
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

    const TOOL_FIELDS = await getToolFields();
    const result = await pool.query(
      `SELECT ${TOOL_FIELDS},
              u.first_name, u.last_name, u.avatar_url,
              COALESCE(u.avg_response_time_hours, 24) AS avg_response_time_hours,
              t.user_id AS owner_id,
              COALESCE(t.avg_rating, 0) AS owner_rating
         FROM tool_rentals t
         JOIN users u ON u.id = t.user_id
        ${where}
        ORDER BY ${orderBy}
        LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );
    res.json({ tools: result.rows });
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
    const TOOL_FIELDS = await getToolFields();
    const result = await pool.query(
      `SELECT ${TOOL_FIELDS},
              u.first_name, u.last_name, u.avatar_url,
              COALESCE(u.avg_response_time_hours, 24) AS avg_response_time_hours,
              t.user_id AS owner_id,
              COALESCE(t.avg_rating, 0) AS owner_rating
         FROM tool_rentals t
         JOIN users u ON u.id = t.user_id
        WHERE t.id = $1 AND t.is_available = TRUE AND u.is_active = TRUE`,
      [id],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tool not found' });
    return res.json({ tool: result.rows[0] });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] public get error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch tool' });
  }
});

// GET /api/tool-rentals/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const TOOL_FIELDS = await getToolFields();
    const result = await pool.query(
      `SELECT ${TOOL_FIELDS}
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
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      name, category, description,
      daily_rate, hourly_rate, deposit_amount,
      condition, brand, model,
      is_available = true, requires_deposit = false,
      delivery_available = false, pickup_only = true,
      location_city, location_state,
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Tool name is required' });
    }

    const VALID_CONDITIONS = ['excellent', 'good', 'fair', 'poor'];
    if (condition && !VALID_CONDITIONS.includes(condition)) {
      return res.status(400).json({ error: 'Invalid condition value' });
    }

    const result = await pool.query(
      `INSERT INTO tool_rentals
         (user_id, name, category, description,
          daily_rate, hourly_rate, deposit_amount,
          condition, brand, model,
          is_available, requires_deposit, delivery_available, pickup_only,
          location_city, location_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, user_id, name, category, description,
                 daily_rate, hourly_rate, deposit_amount,
                 condition, brand, model, is_available,
                 requires_deposit, delivery_available, pickup_only,
                 location_city, location_state, created_at, updated_at`,
      [
        req.user.id,
        name.trim(),
        category?.trim() || null,
        description?.trim() || null,
        daily_rate  ? parseFloat(daily_rate)  : null,
        hourly_rate ? parseFloat(hourly_rate) : null,
        deposit_amount ? parseFloat(deposit_amount) : null,
        condition || null,
        brand?.trim() || null,
        model?.trim() || null,
        is_available,
        requires_deposit,
        delivery_available,
        pickup_only,
        location_city?.trim() || null,
        location_state?.trim() || null,
      ]
    );

    res.status(201).json({ tool: result.rows[0] });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] create error:', err.message);
    res.status(500).json({ error: 'Failed to create tool listing' });
  }
});

// PUT /api/tool-rentals/:id
router.put('/:id', authenticate, async (req, res) => {
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

    const {
      name, category, description,
      daily_rate, hourly_rate, deposit_amount,
      condition, brand, model,
      is_available, requires_deposit,
      delivery_available, pickup_only,
      location_city, location_state,
    } = req.body;

    const VALID_CONDITIONS = ['excellent', 'good', 'fair', 'poor'];
    if (condition && !VALID_CONDITIONS.includes(condition)) {
      return res.status(400).json({ error: 'Invalid condition value' });
    }

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
         updated_at         = NOW()
       WHERE id = $16 AND user_id = $17
       RETURNING id, user_id, name, category, description,
                 daily_rate, hourly_rate, deposit_amount,
                 condition, brand, model, is_available,
                 requires_deposit, delivery_available, pickup_only,
                 location_city, location_state, created_at, updated_at`,
      [
        name?.trim() || null,
        category?.trim() || null,
        description?.trim() || null,
        daily_rate  !== undefined ? (daily_rate  ? parseFloat(daily_rate)  : null) : undefined,
        hourly_rate !== undefined ? (hourly_rate ? parseFloat(hourly_rate) : null) : undefined,
        deposit_amount !== undefined ? (deposit_amount ? parseFloat(deposit_amount) : null) : undefined,
        condition || null,
        brand?.trim() || null,
        model?.trim() || null,
        is_available       !== undefined ? is_available       : null,
        requires_deposit   !== undefined ? requires_deposit   : null,
        delivery_available !== undefined ? delivery_available : null,
        pickup_only        !== undefined ? pickup_only        : null,
        location_city?.trim()  || null,
        location_state?.trim() || null,
        id,
        req.user.id,
      ]
    );

    res.json({ tool: result.rows[0] });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] update error:', err.message);
    res.status(500).json({ error: 'Failed to update tool listing' });
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
