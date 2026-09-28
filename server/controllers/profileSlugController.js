// server/controllers/profileSlugController.js
// Vanity profile slugs: availability checks + owner claim endpoints.
// Helpers claim via /api/helper-profile/slug (their own profile).
// Businesses claim via /api/businesses/:id/slug (requires business access).

'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const {
  validateSlug,
  suggestSlugs,
  SLUG_CHANGE_COOLDOWN_MS,
} = require('../utils/profileSlug');

const TABLES = {
  helper: 'helper_profiles',
  business: 'businesses',
};

function tableFor(type) {
  const table = TABLES[type];
  if (!table) {
    const err = new Error('type must be "helper" or "business"');
    err.status = 400;
    throw err;
  }
  return table;
}

async function slugTaken(type, slug, { excludeUserId = null, excludeBusinessId = null } = {}) {
  const table = tableFor(type);
  let sql;
  let params;
  if (type === 'helper') {
    sql = 'SELECT 1 FROM helper_profiles WHERE profile_slug = $1';
    params = [slug];
    if (excludeUserId) {
      sql += ' AND user_id <> $2';
      params.push(excludeUserId);
    }
  } else {
    sql = 'SELECT 1 FROM businesses WHERE profile_slug = $1';
    params = [slug];
    if (excludeBusinessId) {
      sql += ' AND id <> $2';
      params.push(excludeBusinessId);
    }
  }
  const { rows } = await pool.query(sql + ' LIMIT 1', params);
  return rows.length > 0;
}

// GET /api/profile-slugs/check?slug=mike-plumber&type=helper
// Public. Reports whether a slug is claimable and suggests alternatives.
async function checkSlugAvailability(req, res, next) {
  try {
    const type = String(req.query.type || 'helper').toLowerCase();
    tableFor(type);
    const { slug, ok, reason } = validateSlug(req.query.slug);

    if (!ok) {
      return res.json({ slug, type, available: false, reason, suggestions: [] });
    }

    const taken = await slugTaken(type, slug);
    const suggestions = taken
      ? await suggestSlugs(slug, {
          count: 3,
          isTaken: (candidate) => slugTaken(type, candidate),
        })
      : [];

    return res.json({
      slug,
      type,
      available: !taken,
      reason: taken ? 'taken' : undefined,
      suggestions,
    });
  } catch (err) {
    return next(err);
  }
}

async function claimSlug({ type, slug, userId, businessId }) {
  const table = tableFor(type);
  const idColumn = type === 'helper' ? 'user_id' : 'id';
  const idValue = type === 'helper' ? userId : businessId;

  const { rows } = await pool.query(
    `SELECT profile_slug, profile_slug_updated_at FROM ${table} WHERE ${idColumn} = $1`,
    [idValue]
  );
  const current = rows[0] || {};

  if (current.profile_slug === slug) {
    return { slug, unchanged: true, changeAvailableAt: null };
  }

  if (current.profile_slug_updated_at) {
    const nextChangeAt = new Date(current.profile_slug_updated_at).getTime() + SLUG_CHANGE_COOLDOWN_MS;
    if (Date.now() < nextChangeAt) {
      const err = new Error('Slug was changed recently');
      err.status = 429;
      err.code = 'slug_cooldown';
      err.changeAvailableAt = new Date(nextChangeAt).toISOString();
      throw err;
    }
  }

  try {
    if (type === 'helper') {
      await pool.query(
        `INSERT INTO helper_profiles (user_id, profile_slug, profile_slug_updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET profile_slug = EXCLUDED.profile_slug,
                       profile_slug_updated_at = NOW()`,
        [userId, slug]
      );
    } else {
      const updated = await pool.query(
        `UPDATE businesses
         SET profile_slug = $2, profile_slug_updated_at = NOW()
         WHERE id = $1`,
        [businessId, slug]
      );
      if (updated.rowCount === 0) {
        const err = new Error('Business not found');
        err.status = 404;
        throw err;
      }
    }
  } catch (err) {
    // Race: someone claimed the slug between check and claim.
    if (err.code === '23505') {
      const taken = new Error('Slug is already taken');
      taken.status = 409;
      taken.code = 'slug_taken';
      throw taken;
    }
    throw err;
  }

  return { slug, unchanged: false, changeAvailableAt: null };
}

function handleClaimError(err, res, next) {
  if (err.status === 409 || err.status === 429 || err.status === 404) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      changeAvailableAt: err.changeAvailableAt || undefined,
    });
  }
  return next(err);
}

// PUT /api/helper-profile/slug  { slug }  — helperOnly
async function setHelperSlug(req, res, next) {
  try {
    const { slug, ok, reason } = validateSlug(req.body && req.body.slug);
    if (!ok) {
      return res.status(400).json({ error: `Invalid slug: ${reason}`, code: `slug_${reason}` });
    }
    if (await slugTaken('helper', slug, { excludeUserId: req.user.id })) {
      const suggestions = await suggestSlugs(slug, {
        count: 3,
        isTaken: (candidate) => slugTaken('helper', candidate, { excludeUserId: req.user.id }),
      });
      return res.status(409).json({ error: 'Slug is already taken', code: 'slug_taken', suggestions });
    }
    const result = await claimSlug({ type: 'helper', slug, userId: req.user.id });
    return res.json({ ok: true, ...result, profileUrl: `/h/${slug}` });
  } catch (err) {
    if (err.status) return handleClaimError(err, res, next);
    logger.error({ err }, 'setHelperSlug failed');
    return next(err);
  }
}

// PUT /api/businesses/:id/slug  { slug }  — bizIdAccess()
async function setBusinessSlug(req, res, next) {
  try {
    const businessId = Number(req.params.id);
    if (!Number.isInteger(businessId)) {
      return res.status(400).json({ error: 'Invalid business id' });
    }
    const { slug, ok, reason } = validateSlug(req.body && req.body.slug);
    if (!ok) {
      return res.status(400).json({ error: `Invalid slug: ${reason}`, code: `slug_${reason}` });
    }
    if (await slugTaken('business', slug, { excludeBusinessId: businessId })) {
      const suggestions = await suggestSlugs(slug, {
        count: 3,
        isTaken: (candidate) => slugTaken('business', candidate, { excludeBusinessId: businessId }),
      });
      return res.status(409).json({ error: 'Slug is already taken', code: 'slug_taken', suggestions });
    }
    const result = await claimSlug({ type: 'business', slug, businessId });
    return res.json({ ok: true, ...result, profileUrl: `/b/${slug}` });
  } catch (err) {
    if (err.status) return handleClaimError(err, res, next);
    logger.error({ err }, 'setBusinessSlug failed');
    return next(err);
  }
}

module.exports = {
  checkSlugAvailability,
  setHelperSlug,
  setBusinessSlug,
};
