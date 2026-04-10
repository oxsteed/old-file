// server/routes/helperProfile.js
// Authenticated helper self-service profile editing.
// All routes require the caller to be the owner of the profile.

const router     = require('express').Router();
const pool       = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/requireRole');
const { generalLimiter } = require('../middleware/rateLimiter');
const logger     = require('../utils/logger');

const helperOnly = [authenticate, requireRole('helper')];

// ── GET /api/helper-profile/me ────────────────────────────────────────────────
// Returns the helper's own full profile (for the dashboard editor).
router.get('/me', helperOnly, async (req, res) => {
  try {
    const uid = req.user.id;
    const { rows: [hp] } = await pool.query(
      `SELECT profile_headline, bio_short, bio_long, profile_photo_url, cover_photo_url,
              service_city, service_state, service_zip, service_radius_miles,
              hourly_rate_min, hourly_rate_max, rate_preference,
              flat_rate_available, contact_for_pricing,
              availability_json, is_available_now, response_rate
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
    } = req.body;

    const VALID_RATE_PREFS = ['per_job', 'hourly', 'flat', 'negotiable'];
    const safePref = VALID_RATE_PREFS.includes(rate_preference) ? rate_preference : undefined;

    await pool.query(
      `INSERT INTO helper_profiles (user_id, profile_headline, bio_long, bio_short,
          hourly_rate_min, hourly_rate_max, rate_preference, flat_rate_available, contact_for_pricing,
          service_city, service_state, service_zip, service_radius_miles,
          availability_json, is_available_now)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
         availability_json   = COALESCE($14, helper_profiles.availability_json),
         is_available_now    = COALESCE($15, helper_profiles.is_available_now),
         updated_at          = NOW()`,
      [
        uid,
        profile_headline  ?? null,
        bio_long          ?? null,
        bio_short         ?? null,
        hourly_rate_min   != null ? parseFloat(hourly_rate_min)   : null,
        hourly_rate_max   != null ? parseFloat(hourly_rate_max)   : null,
        safePref          ?? null,
        flat_rate_available != null ? !!flat_rate_available : null,
        contact_for_pricing != null ? !!contact_for_pricing : null,
        service_city      ?? null,
        service_state     ?? null,
        service_zip       ?? null,
        service_radius_miles != null ? parseInt(service_radius_miles) : null,
        availability_json ? JSON.stringify(availability_json) : null,
        is_available_now  != null ? !!is_available_now : null,
      ],
    );

    res.json({ ok: true });
  } catch (err) {
    logger.error('[helperProfile] PUT /core error', { err: err.message });
    res.status(500).json({ error: 'Failed to update profile' });
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

    await pool.query(
      `INSERT INTO helper_profiles (user_id, profile_photo_url, cover_photo_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         profile_photo_url = COALESCE($2, helper_profiles.profile_photo_url),
         cover_photo_url   = COALESCE($3, helper_profiles.cover_photo_url),
         updated_at        = NOW()`,
      [uid, profile_photo_url ?? null, cover_photo_url ?? null],
    );

    // Keep users table in sync for avatar
    if (profile_photo_url) {
      await pool.query(
        'UPDATE users SET profile_photo_url = $1, avatar_url = $1 WHERE id = $2',
        [profile_photo_url, uid],
      );
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('[helperProfile] PUT /photo error', { err: err.message });
    res.status(500).json({ error: 'Failed to update photo' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SERVICES
// ─────────────────────────────────────────────────────────────────────────────

router.get('/services', helperOnly, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM helper_services WHERE user_id=$1 ORDER BY sort_order,id', [req.user.id]
  );
  res.json(rows);
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
    res.json(svc);
  } catch (err) {
    logger.error('[helperProfile] PUT /services/:id', { err: err.message });
    res.status(500).json({ error: 'Failed to update service' });
  }
});

router.delete('/services/:id', helperOnly, async (req, res) => {
  const { rows: [r] } = await pool.query(
    'DELETE FROM helper_services WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]
  );
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAQs
// ─────────────────────────────────────────────────────────────────────────────

router.get('/faqs', helperOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM helper_faqs WHERE user_id=$1 ORDER BY sort_order,id', [req.user.id]);
  res.json(rows);
});

router.post('/faqs', helperOnly, generalLimiter, async (req, res) => {
  try {
    const { question, answer, sort_order } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
    const { rows: [faq] } = await pool.query(
      'INSERT INTO helper_faqs (user_id, question, answer, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.id, question, answer, sort_order||0],
    );
    res.status(201).json(faq);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add FAQ' });
  }
});

router.put('/faqs/:id', helperOnly, generalLimiter, async (req, res) => {
  try {
    const { question, answer, sort_order } = req.body;
    const { rows: [f] } = await pool.query(
      `UPDATE helper_faqs SET
         question   = COALESCE($1, question),
         answer     = COALESCE($2, answer),
         sort_order = COALESCE($3, sort_order),
         updated_at = NOW()
       WHERE id=$4 AND user_id=$5 RETURNING *`,
      [question||null, answer||null, sort_order!=null?parseInt(sort_order):null, req.params.id, req.user.id],
    );
    if (!f) return res.status(404).json({ error: 'Not found' });
    res.json(f);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update FAQ' });
  }
});

router.delete('/faqs/:id', helperOnly, async (req, res) => {
  const { rows: [r] } = await pool.query('DELETE FROM helper_faqs WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POLICIES
// ─────────────────────────────────────────────────────────────────────────────

router.get('/policies', helperOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM helper_policies WHERE user_id=$1 ORDER BY sort_order,id', [req.user.id]);
  res.json(rows);
});

router.post('/policies', helperOnly, generalLimiter, async (req, res) => {
  try {
    const { title, content, icon, sort_order } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content required' });
    const { rows: [pol] } = await pool.query(
      'INSERT INTO helper_policies (user_id, title, content, icon, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.id, title, content, icon||'file-text', sort_order||0],
    );
    res.status(201).json(pol);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add policy' });
  }
});

router.put('/policies/:id', helperOnly, generalLimiter, async (req, res) => {
  try {
    const { title, content, icon, sort_order } = req.body;
    const { rows: [p] } = await pool.query(
      `UPDATE helper_policies SET
         title      = COALESCE($1, title),
         content    = COALESCE($2, content),
         icon       = COALESCE($3, icon),
         sort_order = COALESCE($4, sort_order),
         updated_at = NOW()
       WHERE id=$5 AND user_id=$6 RETURNING *`,
      [title||null, content||null, icon||null, sort_order!=null?parseInt(sort_order):null, req.params.id, req.user.id],
    );
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update policy' });
  }
});

router.delete('/policies/:id', helperOnly, async (req, res) => {
  const { rows: [r] } = await pool.query('DELETE FROM helper_policies WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GALLERY
// ─────────────────────────────────────────────────────────────────────────────

router.get('/gallery', helperOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM helper_gallery WHERE user_id=$1 ORDER BY sort_order,id', [req.user.id]);
  res.json(rows);
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
    res.status(500).json({ error: 'Failed to add image' });
  }
});

router.delete('/gallery/:id', helperOnly, async (req, res) => {
  const { rows: [r] } = await pool.query('DELETE FROM helper_gallery WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
