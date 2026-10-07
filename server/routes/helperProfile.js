// server/routes/helperProfile.js
// Authenticated helper self-service profile editing.
// All routes require the caller to be the owner of the profile.

const router     = require('express').Router();
const multer     = require('multer');
const pool       = require('../db');
const { authenticate } = require('../middleware/auth');
const requireRole      = require('../middleware/requireRole');
const { generalLimiter } = require('../middleware/rateLimiter');
const validateFileUpload = require('../middleware/validateFileUpload');
const logger     = require('../utils/logger');
const { invalidateHelperContext } = require('../services/helperContext');
const availabilityService = require('../services/helperAvailabilityService');
const helperProfileImageController = require('../controllers/helperProfileImageController');
const { validateMediaUrl } = require('../utils/mediaUrlValidation');

const helperOnly = [authenticate, requireRole('helper', 'helper_pro', 'broker')];
const BUFFER_MINUTES_MIN = 0;
const BUFFER_MINUTES_MAX = 240;

function parseBufferMinutes(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < BUFFER_MINUTES_MIN || parsed > BUFFER_MINUTES_MAX) {
    return null;
  }
  return parsed;
}

const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    fieldNameSize: 100,
    fieldSize: 64 * 1024,
    fields: 10,
    files: 1,
    parts: 12,
    headerPairs: 200,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
  },
});

// ── GET /api/helper-profile/me ────────────────────────────────────────────────
// Returns the helper's own full profile (for the dashboard editor).
router.get('/me', helperOnly, async (req, res) => {
  try {
    const uid = req.user.id;
    const { rows: [hp] } = await pool.query(
      `SELECT profile_headline, bio_short, bio_long, profile_photo_url,
              COALESCE(cover_image_url, cover_photo_url) AS cover_photo_url,
              cover_image_url,
              service_city, service_state, service_zip, service_radius_miles,
              hourly_rate_min, hourly_rate_max, rate_preference,
              booking_buffer_minutes, is_listed,
              flat_rate_available, contact_for_pricing,
              is_available_now, response_rate,
              show_services, show_faqs, show_policies, show_gallery, show_hours,
              ai_knowledge,
              profile_slug, profile_slug_updated_at,
              EXISTS (SELECT 1 FROM helper_availability ha
                       WHERE ha.helper_id = helper_profiles.user_id AND ha.is_active = TRUE)
                AS has_availability_template
       FROM helper_profiles WHERE user_id = $1`,
      [uid],
    );
    if (!hp) return res.status(404).json({ error: 'Helper profile not found' });

    const [svcRes, faqRes, polRes, galRes] = await Promise.all([
      pool.query('SELECT * FROM helper_services WHERE user_id=$1 AND is_active=true ORDER BY sort_order,id', [uid]),
      pool.query('SELECT * FROM helper_faqs WHERE user_id=$1 ORDER BY sort_order,id', [uid]),
      pool.query('SELECT * FROM helper_policies WHERE user_id=$1 ORDER BY sort_order,id', [uid]),
      pool.query('SELECT * FROM helper_gallery WHERE user_id=$1 ORDER BY sort_order,id', [uid]),
    ]);

    res.json({
      ...hp,
      services: svcRes.rows,
      faqs:     faqRes.rows,
      policies: polRes.rows,
      gallery:  galRes.rows,
    });
  } catch (err) {
    logger.error('[helperProfile] GET /me error', { err: err.message });
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ── PUT /api/helper-profile/slug ──────────────────────────────────────────────
// Claim or change the helper's vanity profile slug (e.g. /h/mike-plumber).
router.put('/slug', helperOnly, generalLimiter, require('../controllers/profileSlugController').setHelperSlug);

// ── PUT /api/helper-profile/core ──────────────────────────────────────────────
// Update core profile fields: bio, headline, hourly rate, location, availability.
router.put('/core', helperOnly, generalLimiter, async (req, res) => {
  try {
    const uid = req.user.id;
    const {
      profile_headline,
      bio_long,
      bio_short,
      hourly_rate_min,
      hourly_rate_max,
      rate_preference,
      flat_rate_available,
      contact_for_pricing,
      service_city,
      service_state,
      service_zip,
      service_radius_miles,
      availability_json,
      is_available_now,
      ai_knowledge,
      booking_buffer_minutes,
    } = req.body;

    let safeAiKnowledge = undefined;
    if (ai_knowledge !== undefined) {
      const s = ai_knowledge == null ? '' : String(ai_knowledge);
      if (s.length > 8000) {
        return res.status(400).json({ error: 'ai_knowledge must be 8000 characters or less' });
      }
      safeAiKnowledge = s.trim() || null;
    }

    const VALID_RATE_PREFS = ['per_job', 'hourly', 'flat', 'negotiable'];
    const safePref = VALID_RATE_PREFS.includes(rate_preference) ? rate_preference : undefined;
    const safeBufferMinutes = parseBufferMinutes(booking_buffer_minutes);
    if (safeBufferMinutes === null) {
      return res.status(400).json({ error: 'booking_buffer_minutes must be an integer between 0 and 240' });
    }

    await pool.query(
      `INSERT INTO helper_profiles (user_id, profile_headline, bio_long, bio_short,
          hourly_rate_min, hourly_rate_max, rate_preference, flat_rate_available, contact_for_pricing,
          service_city, service_state, service_zip, service_radius_miles,
          is_available_now, ai_knowledge, booking_buffer_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,FALSE),COALESCE($9,FALSE),$10,$11,$12,COALESCE($13,10),COALESCE($14,FALSE),$15,COALESCE($17::integer,0))
       ON CONFLICT (user_id) DO UPDATE SET
         profile_headline    = COALESCE($2,  helper_profiles.profile_headline),
         bio_long            = COALESCE($3,  helper_profiles.bio_long),
         bio_short           = COALESCE($4,  helper_profiles.bio_short),
         hourly_rate_min     = COALESCE($5,  helper_profiles.hourly_rate_min),
         hourly_rate_max     = COALESCE($6,  helper_profiles.hourly_rate_max),
         rate_preference     = COALESCE($7,  helper_profiles.rate_preference),
         flat_rate_available = COALESCE($8,  helper_profiles.flat_rate_available),
         contact_for_pricing = COALESCE($9,  helper_profiles.contact_for_pricing),
         service_city        = COALESCE($10, helper_profiles.service_city),
         service_state       = COALESCE($11, helper_profiles.service_state),
         service_zip         = COALESCE($12, helper_profiles.service_zip),
         service_radius_miles= COALESCE($13, helper_profiles.service_radius_miles),
         is_available_now    = COALESCE($14, helper_profiles.is_available_now),
         is_available_now_updated_at = CASE
           WHEN $14::boolean IS NOT DISTINCT FROM helper_profiles.is_available_now
           THEN helper_profiles.is_available_now_updated_at
           ELSE NOW()
         END,
         ai_knowledge        = CASE WHEN $16::boolean THEN $15 ELSE helper_profiles.ai_knowledge END,
         booking_buffer_minutes = COALESCE($17, helper_profiles.booking_buffer_minutes),
         updated_at          = NOW()`,
      [
        uid,
        profile_headline  ?? null,
        bio_long          ?? null,
        bio_short         ?? null,
        hourly_rate_min   != null && hourly_rate_min !== '' ? parseFloat(hourly_rate_min)   : null,
        hourly_rate_max   != null && hourly_rate_max !== '' ? parseFloat(hourly_rate_max)   : null,
        safePref          ?? null,
        // Audit fix: booleans must be null (not false) when not provided,
        // so COALESCE preserves the existing value instead of wiping it.
        flat_rate_available != null ? !!flat_rate_available : null,
        contact_for_pricing != null ? !!contact_for_pricing : null,
        service_city      ?? null,
        service_state     ?? null,
        service_zip       ?? null,
        service_radius_miles != null && service_radius_miles !== '' ? parseInt(service_radius_miles) : null,
        is_available_now  != null ? !!is_available_now : null,
        safeAiKnowledge !== undefined ? safeAiKnowledge : null,
        safeAiKnowledge !== undefined,
        safeBufferMinutes === undefined ? null : safeBufferMinutes,
      ],
    );

    // Bust the per-helper AI context cache (helper + their primary business) so the
    // next profile-chat uses fresh data.  Look up the business ID without blocking.
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    // Back-compat bridge: an older client may still submit the legacy
    // availability_json shape. Mirror any valid windows into the ONE weekly
    // template so the single system stays the source of truth.
    if (availability_json) {
      try {
        const windows = availabilityService.templateWindowsFromJson(availability_json);
        if (windows.length > 0) {
          await availabilityService.replaceTemplate(uid, windows);
        }
      } catch (e) {
        logger.warn('[helperProfile] availability_json bridge sync failed', { err: e.message });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('[helperProfile] PUT /core error', { err: err.message });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── PUT /api/helper-profile/visibility ────────────────────────────────────────
// Update section visibility toggles: show_services, show_faqs, show_policies, show_gallery, show_hours.
router.put('/visibility', helperOnly, generalLimiter, async (req, res) => {
  try {
    const uid = req.user.id;
    const { show_services, show_faqs, show_policies, show_gallery, show_hours } = req.body;

    await pool.query(
      // Audit fix: show_* columns are BOOLEAN NOT NULL DEFAULT true (migration 077).
      // Omitted toggles pass null so COALESCE preserves the existing value on
      // UPDATE, while the VALUES clause falls back to TRUE on INSERT (same bug
      // class as the /core boolean fix).
      `INSERT INTO helper_profiles (user_id, show_services, show_faqs, show_policies, show_gallery, show_hours)
       VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE), COALESCE($5, TRUE), COALESCE($6, TRUE))
       ON CONFLICT (user_id) DO UPDATE SET
         show_services = COALESCE($2, helper_profiles.show_services),
         show_faqs     = COALESCE($3, helper_profiles.show_faqs),
         show_policies = COALESCE($4, helper_profiles.show_policies),
         show_gallery  = COALESCE($5, helper_profiles.show_gallery),
         show_hours    = COALESCE($6, helper_profiles.show_hours),
         updated_at    = NOW()`,
      [
        uid,
        show_services != null ? !!show_services : null,
        show_faqs != null ? !!show_faqs : null,
        show_policies != null ? !!show_policies : null,
        show_gallery != null ? !!show_gallery : null,
        show_hours != null ? !!show_hours : null,
      ],
    );

    // Invalidate cache on visibility change
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.json({ ok: true });
  } catch (err) {
    logger.error('[helperProfile] PUT /visibility error', { err: err.message });
    res.status(500).json({ error: 'Failed to update visibility settings' });
  }
});

// ── PATCH /api/helper-profile/listing ─────────────────────────────────────────
// Toggle the caller's own directory listing (draft/publish). Body: { is_listed: boolean }.
router.patch('/listing', helperOnly, generalLimiter, async (req, res) => {
  try {
    const uid = req.user.id;
    const { is_listed } = req.body;

    if (typeof is_listed !== 'boolean') {
      return res.status(400).json({ error: 'is_listed must be a boolean' });
    }

    const { rows: [row] } = await pool.query(
      `UPDATE helper_profiles
       SET is_listed = $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING is_listed`,
      [is_listed, uid],
    );
    if (!row) return res.status(404).json({ error: 'Helper profile not found' });

    res.json({ ok: true, is_listed: row.is_listed });
  } catch (err) {
    logger.error('[helperProfile] PATCH /listing error', { err: err.message });
    res.status(500).json({ error: 'Failed to update listing status' });
  }
});

// ── PUT /api/helper-profile/photo ─────────────────────────────────────────────
// Update avatar or cover photo URL (storage handled client-side via existing upload flow).
router.put('/photo', helperOnly, generalLimiter, async (req, res) => {
  try {
    const uid = req.user.id;
    const { profile_photo_url, cover_photo_url } = req.body;

    if (!profile_photo_url && !cover_photo_url) {
      return res.status(400).json({ error: 'profile_photo_url or cover_photo_url required' });
    }

    // PS-5: https + storage/CDN host allowlist (utils/mediaUrlValidation),
    // shared with the business logo/cover/gallery endpoints.
    const validProfileUrl = validateMediaUrl(profile_photo_url, 'profile_photo_url');
    const validCoverUrl = validateMediaUrl(cover_photo_url, 'cover_photo_url');

    await pool.query(
      `INSERT INTO helper_profiles (user_id, profile_photo_url, cover_photo_url, cover_image_url)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         profile_photo_url = COALESCE($2, helper_profiles.profile_photo_url),
         cover_photo_url   = COALESCE($3, helper_profiles.cover_photo_url),
         cover_image_url   = COALESCE($3, helper_profiles.cover_image_url),
         updated_at        = NOW()`,
      [uid, validProfileUrl, validCoverUrl],
    );

    // Keep users table in sync for avatar
    if (validProfileUrl) {
      await pool.query(
        'UPDATE users SET profile_photo_url = $1, avatar_url = $1 WHERE id = $2',
        [validProfileUrl, uid],
      );
    }

    // Invalidate cache on photo change
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.json({ ok: true });
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[helperProfile] PUT /photo error', { err: err.message });
    res.status(500).json({ error: 'Failed to update photo' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SERVICES
// ─────────────────────────────────────────────────────────────────────────────

router.get('/services', helperOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM helper_services WHERE user_id=$1 ORDER BY sort_order,id', [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    logger.error('[helperProfile] GET /services', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

router.post('/services', helperOnly, generalLimiter, async (req, res) => {
  try {
    const uid = req.user.id;
    const { name, description, price, price_unit, duration, popular, category, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const VALID_UNITS = ['flat','hour','starting_at','quote'];
    const unit = VALID_UNITS.includes(price_unit) ? price_unit : 'flat';

    const { rows: [svc] } = await pool.query(
      `INSERT INTO helper_services (user_id, name, description, price, price_unit, duration, popular, category, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [uid, name, description||null, parseFloat(price)||0, unit, duration||null, !!popular, category||'General', sort_order||0],
    );

    // Invalidate cache on service creation
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.status(201).json(svc);
  } catch (err) {
    logger.error('[helperProfile] POST /services', { err: err.message });
    res.status(500).json({ error: 'Failed to add service' });
  }
});

router.put('/services/:id', helperOnly, generalLimiter, async (req, res) => {
  try {
    const uid = req.user.id;
    const { id } = req.params;
    const { name, description, price, price_unit, duration, popular, category, sort_order, is_active } = req.body;

    const { rows: [existing] } = await pool.query('SELECT id FROM helper_services WHERE id=$1 AND user_id=$2', [id, uid]);
    if (!existing) return res.status(404).json({ error: 'Service not found' });

    const VALID_UNITS = ['flat','hour','starting_at','quote'];
    const unit = VALID_UNITS.includes(price_unit) ? price_unit : undefined;

    const { rows: [svc] } = await pool.query(
      `UPDATE helper_services SET
         name        = COALESCE($1, name),
         description = COALESCE($2, description),
         price       = COALESCE($3, price),
         price_unit  = COALESCE($4, price_unit),
         duration    = COALESCE($5, duration),
         popular     = COALESCE($6, popular),
         category    = COALESCE($7, category),
         sort_order  = COALESCE($8, sort_order),
         is_active   = COALESCE($9, is_active),
         updated_at  = NOW()
       WHERE id=$10 AND user_id=$11 RETURNING *`,
      [name||null, description||null, price!=null?parseFloat(price):null, unit||null,
       duration||null, popular!=null?!!popular:null, category||null,
       sort_order!=null?parseInt(sort_order):null, is_active!=null?!!is_active:null, id, uid],
    );

    // Invalidate cache on service update
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.json(svc);
  } catch (err) {
    logger.error('[helperProfile] PUT /services/:id', { err: err.message });
    res.status(500).json({ error: 'Failed to update service' });
  }
});

router.delete('/services/:id', helperOnly, async (req, res) => {
  try {
    const uid = req.user.id;
    const { rows: [r] } = await pool.query(
      'DELETE FROM helper_services WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, uid]
    );
    if (!r) return res.status(404).json({ error: 'Not found' });

    // Invalidate cache on service deletion
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(res => invalidateHelperContext(uid, res.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.json({ ok: true });
  } catch (err) {
    logger.error('[helperProfile] DELETE /services/:id', { err: err.message });
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FAQs
// ─────────────────────────────────────────────────────────────────────────────

router.get('/faqs', helperOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM helper_faqs WHERE user_id=$1 ORDER BY sort_order,id', [req.user.id]);
    res.json(rows);
  } catch (err) {
    logger.error('[helperProfile] GET /faqs', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

router.post('/faqs', helperOnly, generalLimiter, async (req, res) => {
  try {
    const uid = req.user.id;
    const { question, answer, sort_order } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
    const { rows: [faq] } = await pool.query(
      'INSERT INTO helper_faqs (user_id, question, answer, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
      [uid, question, answer, sort_order||0],
    );

    // Invalidate cache on FAQ creation
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.status(201).json(faq);
  } catch (err) {
    logger.error('[helperProfile] POST /faqs', { err: err.message });
    res.status(500).json({ error: 'Failed to add FAQ' });
  }
});

router.put('/faqs/:id', helperOnly, generalLimiter, async (req, res) => {
  try {
    const uid = req.user.id;
    const { question, answer, sort_order } = req.body;
    const { rows: [f] } = await pool.query(
      `UPDATE helper_faqs SET
         question   = COALESCE($1, question),
         answer     = COALESCE($2, answer),
         sort_order = COALESCE($3, sort_order),
         updated_at = NOW()
       WHERE id=$4 AND user_id=$5 RETURNING *`,
      [question||null, answer||null, sort_order!=null?parseInt(sort_order):null, req.params.id, uid],
    );
    if (!f) return res.status(404).json({ error: 'Not found' });

    // Invalidate cache on FAQ update
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.json(f);
  } catch (err) {
    logger.error('[helperProfile] PUT /faqs/:id', { err: err.message });
    res.status(500).json({ error: 'Failed to update FAQ' });
  }
});

router.delete('/faqs/:id', helperOnly, async (req, res) => {
  try {
    const uid = req.user.id;
    const { rows: [r] } = await pool.query('DELETE FROM helper_faqs WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, uid]);
    if (!r) return res.status(404).json({ error: 'Not found' });

    // Invalidate cache on FAQ deletion
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.json({ ok: true });
  } catch (err) {
    logger.error('[helperProfile] DELETE /faqs/:id', { err: err.message });
    res.status(500).json({ error: 'Failed to delete FAQ' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POLICIES
// ─────────────────────────────────────────────────────────────────────────────

router.get('/policies', helperOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM helper_policies WHERE user_id=$1 ORDER BY sort_order,id', [req.user.id]);
    res.json(rows);
  } catch (err) {
    logger.error('[helperProfile] GET /policies', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch policies' });
  }
});

router.post('/policies', helperOnly, generalLimiter, async (req, res) => {
  try {
    const uid = req.user.id;
    const { title, content, icon, sort_order } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content required' });
    const { rows: [pol] } = await pool.query(
      'INSERT INTO helper_policies (user_id, title, content, icon, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [uid, title, content, icon||'file-text', sort_order||0],
    );

    // Invalidate cache on policy creation
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.status(201).json(pol);
  } catch (err) {
    logger.error('[helperProfile] POST /policies', { err: err.message });
    res.status(500).json({ error: 'Failed to add policy' });
  }
});

router.put('/policies/:id', helperOnly, generalLimiter, async (req, res) => {
  try {
    const uid = req.user.id;
    const { title, content, icon, sort_order } = req.body;
    const { rows: [p] } = await pool.query(
      `UPDATE helper_policies SET
         title      = COALESCE($1, title),
         content    = COALESCE($2, content),
         icon       = COALESCE($3, icon),
         sort_order = COALESCE($4, sort_order),
         updated_at = NOW()
       WHERE id=$5 AND user_id=$6 RETURNING *`,
      [title||null, content||null, icon||null, sort_order!=null?parseInt(sort_order):null, req.params.id, uid],
    );
    if (!p) return res.status(404).json({ error: 'Not found' });

    // Invalidate cache on policy update
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.json(p);
  } catch (err) {
    logger.error('[helperProfile] PUT /policies/:id', { err: err.message });
    res.status(500).json({ error: 'Failed to update policy' });
  }
});

router.delete('/policies/:id', helperOnly, async (req, res) => {
  try {
    const uid = req.user.id;
    const { rows: [r] } = await pool.query('DELETE FROM helper_policies WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, uid]);
    if (!r) return res.status(404).json({ error: 'Not found' });

    // Invalidate cache on policy deletion
    pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_primary = TRUE AND is_active = TRUE LIMIT 1`,
      [uid]
    ).then(r => invalidateHelperContext(uid, r.rows[0]?.id))
     .catch(() => invalidateHelperContext(uid));

    res.json({ ok: true });
  } catch (err) {
    logger.error('[helperProfile] DELETE /policies/:id', { err: err.message });
    res.status(500).json({ error: 'Failed to delete policy' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GALLERY
// ─────────────────────────────────────────────────────────────────────────────

router.get('/gallery', helperOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM helper_gallery WHERE user_id=$1 ORDER BY sort_order,id', [req.user.id]);
    res.json(rows);
  } catch (err) {
    logger.error('[helperProfile] GET /gallery', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch gallery' });
  }
});

router.post('/gallery', helperOnly, generalLimiter, async (req, res) => {
  try {
    const { url, caption, sort_order } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const { rows: [img] } = await pool.query(
      'INSERT INTO helper_gallery (user_id, url, caption, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.id, url, caption||null, sort_order||0],
    );
    res.status(201).json(img);
  } catch (err) {
    logger.error('[helperProfile] POST /gallery', { err: err.message });
    res.status(500).json({ error: 'Failed to add image' });
  }
});

router.delete('/gallery/:id', helperOnly, async (req, res) => {
  try {
    const { rows: [r] } = await pool.query('DELETE FROM helper_gallery WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('[helperProfile] DELETE /gallery/:id', { err: err.message });
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// ── Cover image (multipart upload to storage; keeps cover_image_url + cover_photo_url in sync)
router.put('/cover-image', helperOnly, coverUpload.single('image'), validateFileUpload, helperProfileImageController.uploadCoverImage);
router.delete('/cover-image', helperOnly, helperProfileImageController.deleteCoverImage);

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY AVAILABILITY TEMPLATE (migration 168)
// ─────────────────────────────────────────────────────────────────────────────
const helperAvailabilityCtrl = require('../controllers/helperAvailabilityController');

router.get('/availability/template',
  helperOnly, helperAvailabilityCtrl.getTemplate);

router.put('/availability/template',
  helperOnly, generalLimiter, helperAvailabilityCtrl.setTemplate);

router.get('/availability/overrides',
  helperOnly, helperAvailabilityCtrl.getOverrides);

router.post('/availability/overrides',
  helperOnly, generalLimiter, helperAvailabilityCtrl.createOverride);

router.delete('/availability/overrides/:id',
  helperOnly, generalLimiter, helperAvailabilityCtrl.deleteOverride);

// ── QR Code (public — no auth required) ──────────────────────────────────────
// GET /api/helper-profile/:helperId/qr-code?size=small&format=dataurl
router.get('/:helperId/qr-code', helperProfileImageController.generateQRCode);
// GET /api/helper-profile/:helperId/qr-code/multi-size
router.get('/:helperId/qr-code/multi-size', helperProfileImageController.generateMultiSizeQRCode);

module.exports = router;
