'use strict';

/**
 * controllers/restaurantMediaController.js
 *
 * Restaurant Media tab — a TikTok-style community video feed per restaurant.
 *
 * Mirrors the Learn guide-video precedent: link-only YouTube/Vimeo videos
 * (no file uploads), user flags with one open flag per user per video, and
 * admin review behind the moderate_content grant. Machine error codes
 * throughout; no locale strings (the client maps codes to copy).
 *
 * Routes (server/routes/restaurants.js, mounted at /api/restaurants):
 *   GET    /:restaurantId/media                  public, paginated
 *   POST   /:restaurantId/media                  auth, 10/day per user
 *   POST   /:restaurantId/media/:mediaId/like    auth, toggles
 *   DELETE /:restaurantId/media/:mediaId         poster | owner | admin
 *   POST   /:restaurantId/media/:mediaId/flags   auth, rate-limited
 *
 * Admin routes (server/routes/adminRestaurantMedia.js, /api/admin/restaurant-media):
 *   GET  /flags                   ?status=open|resolved|dismissed
 *   POST /flags/:flagId/review    { action: 'dismiss' | 'remove' }
 */

const rateLimit = require('express-rate-limit');
const pool = require('../db');
const AppError = require('../utils/appError');

// ── Rate limiters ────────────────────────────────────────────────────────────
// Route-local Redis store option, mirroring server/routes/learn.js. Falls back
// to in-memory when Redis is unavailable. Exported so routes/*.js can use them
// and so tests can exercise the real bucket configuration.

// eslint-disable-next-line import/no-extraneous-dependencies
const redisClient = require('../utils/redis');
let RedisStore = null;
if (redisClient) {
  try {
    RedisStore = require('rate-limit-redis').default;
  } catch { /* in-memory fallback */ }
}
function createMediaStoreOption(prefix) {
  if (redisClient && RedisStore) {
    return { store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args), prefix }) };
  }
  return {};
}

// POST /:restaurantId/media — 10 posts per 24h per account.
const mediaSubmitLimiter = rateLimit({
  ...createMediaStoreOption('rl:restaurant_media_submit:'),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 10,
  keyGenerator: (req) => (req.user ? `u:${req.user.id}` : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many media posts. Please try again tomorrow.', code: 'media_rate_limited' },
});

// POST /:restaurantId/media/:mediaId/flags — mirrors Learn's videoFlagLimiter.
const mediaFlagLimiter = rateLimit({
  ...createMediaStoreOption('rl:restaurant_media_flag:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  keyGenerator: (req) => (req.user ? `u:${req.user.id}` : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many flags. Please try again later.', code: 'media_flag_rate_limited' },
});

// ── URL validation ───────────────────────────────────────────────────────────
// Accept exactly the shapes the client renders via toEmbedUrl
// (client/src/pages/LearnModePage.jsx): YouTube watch/shorts/embed/live +
// youtu.be, and Vimeo numeric ids. Anything else → media_invalid_url.

const MEDIA_URL_MAX_LEN = 500;
const MEDIA_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
  'vimeo.com', 'www.vimeo.com', 'player.vimeo.com',
]);

const YOUTUBE_ID_RE = /(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const VIMEO_ID_RE = /vimeo\.com\/(?:video\/)?(\d+)/;

function parseMediaVideoUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, MEDIA_URL_MAX_LEN);
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!MEDIA_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const yt = trimmed.match(YOUTUBE_ID_RE);
  if (yt) {
    parsed.protocol = 'https:';
    return { url: parsed.toString(), provider: 'youtube', externalVideoId: yt[1] };
  }
  const vi = trimmed.match(VIMEO_ID_RE);
  if (vi) {
    parsed.protocol = 'https:';
    return { url: parsed.toString(), provider: 'vimeo', externalVideoId: vi[1] };
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Whether the viewer may moderate this restaurant's media (remove videos).
// Mirrors the DELETE permission logic: restaurant owner, super-admin, or an
// admin holding the moderate_content grant.
async function viewerCanModerateRestaurant(userId, restaurantId, req) {
  if (!userId) return false;
  const { rows: ownerRows } = await pool.query(
    `SELECT 1
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1 AND (fr.owner_user_id = $2 OR b.user_id = $2)`,
    [restaurantId, userId]
  );
  if (ownerRows.length > 0) return true;
  if (req.isSuperAdmin) return true;
  if (req.isAdmin) return userCanModerateContent(userId);
  return false;
}

// Public visibility predicate, mirroring foodController.getRestaurant: the
// feed is only readable on restaurants the public page can render.
async function getPublicRestaurant(restaurantId) {
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id, fr.owner_user_id
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1
        AND fr.status IN ('active', 'paused')
        AND fr.discovery_status = 'visible'
        AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
        AND b.is_active = TRUE
        AND b.is_listed = TRUE
        AND COALESCE(b.setup_status, 'active') IN ('active', 'paused')
        AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
        AND b.deleted_at IS NULL`,
    [restaurantId]
  );
  return rows[0] || null;
}

// Inline moderate_content grant check for routes that run under the regular
// customer `authenticate` middleware (so requirePermission is not available).
// Super-admins always pass.
async function userCanModerateContent(userId) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM admin_permission_grants
      WHERE grantee_id = $1
        AND permissions ? 'moderate_content'
        AND expires_at > NOW()
        AND revoked_at IS NULL
        AND region_id IS NULL
      UNION
      SELECT 1
        FROM delegation_grants d
        JOIN users grantor ON grantor.id = d.grantor_admin_id
        LEFT JOIN admin_permission_grants grantor_grant
          ON grantor_grant.grantee_id = d.grantor_admin_id
         AND grantor_grant.permissions ? 'moderate_content'
         AND grantor_grant.expires_at > NOW()
         AND grantor_grant.revoked_at IS NULL
         AND grantor_grant.region_id IS NULL
       WHERE d.grantee_admin_id = $1
         AND d.scopes @> ARRAY['moderate_content']::text[]
         AND d.status = 'active'
         AND d.expires_at > NOW()
         AND (grantor.role = 'super_admin' OR grantor_grant.id IS NOT NULL)
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

// ── GET /api/restaurants/:restaurantId/media ──────────────────────────────────

exports.listRestaurantMedia = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }
    const restaurant = await getPublicRestaurant(restaurantId);
    if (!restaurant) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }

    const page = Math.max(1, parsePositiveInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parsePositiveInt(req.query.pageSize) || 10));
    const offset = (page - 1) * pageSize;
    const viewerId = req.user?.id || null;

    const [{ rows: mediaRows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT m.id, m.video_url, m.provider, m.external_video_id, m.caption, m.created_at,
                m.user_id, u.first_name, u.last_name,
                (SELECT COUNT(*)::int FROM restaurant_media_likes l WHERE l.media_id = m.id) AS like_count,
                EXISTS (SELECT 1 FROM restaurant_media_likes l2
                         WHERE l2.media_id = m.id AND l2.user_id = $2) AS liked_by_me,
                EXISTS (SELECT 1 FROM food_orders fo
                         WHERE fo.restaurant_id = m.restaurant_id
                           AND fo.customer_id = m.user_id
                           AND fo.status = 'completed') AS verified_order
           FROM restaurant_media m
           LEFT JOIN users u ON u.id = m.user_id
          WHERE m.restaurant_id = $1
            AND m.status = 'visible'
          ORDER BY m.created_at DESC
          LIMIT $3 OFFSET $4`,
        [restaurantId, viewerId, pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM restaurant_media
          WHERE restaurant_id = $1 AND status = 'visible'`,
        [restaurantId]
      ),
    ]);

    // Tagged dishes: resolve against the live menu. A live, available dish
    // returns live name/price; anything else (unpublished or removed) falls
    // back to the post-time snapshot with available=false. Never crashes.
    let dishesByMedia = new Map();
    const mediaIds = mediaRows.map((m) => m.id);
    if (mediaIds.length) {
      const { rows: dishRows } = await pool.query(
        `SELECT t.media_id, t.menu_item_id, t.item_name_snapshot,
                t.item_price_snapshot_cents, t.currency_code,
                fmi.name AS live_name, fmi.price_cents AS live_price_cents,
                fmi.currency_code AS live_currency_code, fmi.is_available AS live_is_available
           FROM restaurant_media_items t
           LEFT JOIN food_menu_items fmi
             ON fmi.id = t.menu_item_id AND fmi.restaurant_id = $2
          WHERE t.media_id = ANY($1)`,
        [mediaIds, restaurantId]
      );
      for (const d of dishRows) {
        const liveAvailable = d.live_name != null && d.live_is_available === true;
        const entry = {
          menu_item_id: d.menu_item_id,
          name: liveAvailable ? d.live_name : d.item_name_snapshot,
          price_cents: liveAvailable ? d.live_price_cents : d.item_price_snapshot_cents,
          currency_code: liveAvailable ? d.live_currency_code : d.currency_code,
          available: liveAvailable,
        };
        if (!dishesByMedia.has(d.media_id)) dishesByMedia.set(d.media_id, []);
        dishesByMedia.get(d.media_id).push(entry);
      }
    }

    const items = mediaRows.map((m) => ({
      id: m.id,
      video_url: m.video_url,
      provider: m.provider,
      external_video_id: m.external_video_id,
      caption: m.caption,
      poster: {
        id: m.user_id,
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || null,
      },
      verified_order: !!m.verified_order,
      like_count: m.like_count,
      liked_by_me: !!m.liked_by_me,
      created_at: m.created_at,
      dishes: dishesByMedia.get(m.id) || [],
    }));

    const viewer_can_moderate = await viewerCanModerateRestaurant(viewerId, restaurantId, req);

    res.json({
      success: true,
      items,
      page,
      pageSize,
      total: countRows[0]?.total ?? 0,
      viewer_can_moderate,
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/restaurants/:restaurantId/media ─────────────────────────────────

exports.postRestaurantMedia = async (req, res, next) => {
  try {
    // Validate the payload before touching the database (fail fast on
    // malformed input, mirroring the Learn video submission flow).
    const parsed = parseMediaVideoUrl(req.body?.video_url);
    if (!parsed) {
      return next(new AppError(
        'Please provide a valid YouTube or Vimeo link (https).', 400, 'media_invalid_url'
      ));
    }

    let caption = null;
    if (req.body?.caption !== undefined && req.body?.caption !== null) {
      if (typeof req.body.caption !== 'string') {
        return next(new AppError('Caption must be a string.', 400, 'media_invalid_caption'));
      }
      caption = req.body.caption.trim();
      if (caption.length > 280) {
        return next(new AppError(
          'Caption is too long (max 280 characters).', 400, 'media_caption_too_long'
        ));
      }
      if (!caption) caption = null;
    }

    let dishIds = req.body?.dish_ids ?? [];
    if (!Array.isArray(dishIds)) {
      return next(new AppError('dish_ids must be an array.', 400, 'media_invalid_dish_ids'));
    }
    dishIds = [...new Set(dishIds.map(parsePositiveInt).filter(Boolean))];
    if (dishIds.length > 10) {
      return next(new AppError(
        'Too many tagged dishes (max 10).', 400, 'media_too_many_dishes'
      ));
    }

    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }
    const restaurant = await getPublicRestaurant(restaurantId);
    if (!restaurant) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }

    // Every tagged dish must belong to this restaurant. Snapshot name/price.
    let dishRows = [];
    if (dishIds.length) {
      const { rows } = await pool.query(
        `SELECT id, name, price_cents, currency_code
           FROM food_menu_items
          WHERE restaurant_id = $1 AND id = ANY($2)`,
        [restaurantId, dishIds]
      );
      dishRows = rows;
      if (dishRows.length !== dishIds.length) {
        return next(new AppError(
          'One or more dishes do not belong to this restaurant.', 400, 'media_dish_not_found'
        ));
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [media] } = await client.query(
        `INSERT INTO restaurant_media
           (restaurant_id, user_id, video_url, provider, external_video_id, caption)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, video_url, provider, external_video_id, caption, created_at`,
        [restaurantId, req.user.id, parsed.url, parsed.provider, parsed.externalVideoId, caption]
      );
      for (const d of dishRows) {
        await client.query(
          `INSERT INTO restaurant_media_items
             (media_id, menu_item_id, item_name_snapshot, item_price_snapshot_cents, currency_code)
           VALUES ($1, $2, $3, $4, $5)`,
          [media.id, d.id, d.name, d.price_cents, d.currency_code]
        );
      }
      await client.query('COMMIT');
      return res.status(201).json({ success: true, media });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

// ── POST /api/restaurants/:restaurantId/media/:mediaId/like ────────────────────

exports.toggleMediaLike = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }
    const mediaId = String(req.params.mediaId || '');
    const { rows: [media] } = await pool.query(
      `SELECT id FROM restaurant_media
        WHERE id = $1 AND restaurant_id = $2 AND status = 'visible'`,
      [mediaId, restaurantId]
    );
    if (!media) {
      return next(new AppError('Media not found', 404, 'media_not_found'));
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existing } = await client.query(
        `SELECT 1 FROM restaurant_media_likes WHERE media_id = $1 AND user_id = $2`,
        [media.id, req.user.id]
      );
      let liked;
      if (existing.length) {
        await client.query(
          `DELETE FROM restaurant_media_likes WHERE media_id = $1 AND user_id = $2`,
          [media.id, req.user.id]
        );
        liked = false;
      } else {
        await client.query(
          `INSERT INTO restaurant_media_likes (media_id, user_id) VALUES ($1, $2)`,
          [media.id, req.user.id]
        );
        liked = true;
      }
      const { rows: [countRow] } = await client.query(
        `SELECT COUNT(*)::int AS like_count FROM restaurant_media_likes WHERE media_id = $1`,
        [media.id]
      );
      await client.query('COMMIT');
      return res.json({ liked, like_count: countRow.like_count });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/restaurants/:restaurantId/media/:mediaId ──────────────────────
// Allowed for: the poster, the restaurant owner, or an admin with the
// moderate_content grant. Soft-delete (status='hidden') — the row stays for audit.

exports.deleteRestaurantMedia = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }
    const mediaId = String(req.params.mediaId || '');
    const { rows: [media] } = await pool.query(
      `SELECT id, user_id FROM restaurant_media
        WHERE id = $1 AND restaurant_id = $2`,
      [mediaId, restaurantId]
    );
    if (!media) {
      return next(new AppError('Media not found', 404, 'media_not_found'));
    }

    const userId = req.user.id;
    let allowed = String(media.user_id) === String(userId);
    if (!allowed) {
      const { rows: ownerRows } = await pool.query(
        `SELECT 1
           FROM food_restaurants fr
           JOIN businesses b ON b.id = fr.business_id
          WHERE fr.id = $1 AND (fr.owner_user_id = $2 OR b.user_id = $2)`,
        [restaurantId, userId]
      );
      allowed = ownerRows.length > 0;
    }
    if (!allowed) {
      if (req.isSuperAdmin) {
        allowed = true;
      } else if (req.isAdmin) {
        allowed = await userCanModerateContent(userId);
      }
    }
    if (!allowed) {
      return next(new AppError(
        'You do not have permission to delete this media.', 403, 'media_forbidden'
      ));
    }

    await pool.query(`UPDATE restaurant_media SET status = 'hidden' WHERE id = $1`, [media.id]);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/restaurants/:restaurantId/media/:mediaId/flags ──────────────────

const MEDIA_FLAG_REASONS = new Set(['unrelated', 'spam', 'broken', 'inappropriate']);

exports.flagMedia = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }
    const mediaId = String(req.params.mediaId || '');
    const reason = String(req.body?.reason || '');
    if (!MEDIA_FLAG_REASONS.has(reason)) {
      return next(new AppError('Invalid flag reason.', 400, 'invalid_flag_reason'));
    }
    const note = typeof req.body?.note === 'string'
      ? req.body.note.trim().slice(0, 500) || null
      : null;
    const { rows: mrows } = await pool.query(
      `SELECT id FROM restaurant_media
        WHERE id = $1 AND restaurant_id = $2 AND status = 'visible'`,
      [mediaId, restaurantId]
    );
    if (!mrows.length) {
      return next(new AppError('Media not found', 404, 'media_not_found'));
    }
    try {
      await pool.query(
        `INSERT INTO restaurant_media_flags (media_id, user_id, reason, note)
         VALUES ($1, $2, $3, $4)`,
        [mediaId, req.user.id, reason, note]
      );
    } catch (err) {
      if (err.code === '23505') {
        return next(new AppError(
          'You have already flagged this media.', 409, 'media_flag_exists'
        ));
      }
      throw err;
    }
    return res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ── Admin flag review (/api/admin/restaurant-media) ───────────────────────────
// Grant gate (requireAdmin + requirePermission('moderate_content')) lives on
// the route, mirroring the Learn admin video-flag review.

/** GET /api/admin/restaurant-media/flags?status=open */
exports.adminListMediaFlags = async (req, res, next) => {
  try {
    const status = String(req.query.status || 'open');
    if (!['open', 'resolved', 'dismissed'].includes(status)) {
      return next(new AppError('Invalid status filter.', 400, 'bad_status'));
    }
    const { rows } = await pool.query(
      `SELECT f.id, f.media_id, f.reason, f.note, f.status, f.created_at,
              m.video_url, m.provider, m.caption, m.restaurant_id,
              fr.display_name AS restaurant_name,
              (SELECT COUNT(*)::int FROM restaurant_media_flags
                WHERE media_id = f.media_id AND status = 'open') AS open_flags,
              u.email AS flagged_by_email, d.email AS decided_by_email
         FROM restaurant_media_flags f
         JOIN restaurant_media m ON m.id = f.media_id
         LEFT JOIN food_restaurants fr ON fr.id = m.restaurant_id
         LEFT JOIN users u ON u.id = f.user_id
         LEFT JOIN users d ON d.id = f.decided_by
        WHERE f.status = $1
        ORDER BY f.created_at DESC
        LIMIT 200`,
      [status]
    );
    return res.json({ success: true, flags: rows });
  } catch (err) {
    next(err);
  }
};

/** POST /api/admin/restaurant-media/flags/:flagId/review { action: 'dismiss' | 'remove' } */
exports.adminReviewMediaFlag = async (req, res, next) => {
  try {
    const action = String(req.body?.action || '');
    if (!['dismiss', 'remove'].includes(action)) {
      return next(new AppError('Invalid review action.', 400, 'media_flag_invalid_action'));
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, media_id, status FROM restaurant_media_flags WHERE id = $1 FOR UPDATE`,
        [req.params.flagId]
      );
      const flag = rows[0];
      if (!flag) {
        await client.query('ROLLBACK');
        return next(new AppError('Flag not found.', 404, 'media_flag_not_found'));
      }
      if (flag.status !== 'open') {
        await client.query('ROLLBACK');
        return next(new AppError('Flag was already decided.', 409, 'media_flag_already_decided'));
      }
      if (action === 'dismiss') {
        await client.query(
          `UPDATE restaurant_media_flags
              SET status = 'dismissed', decided_at = NOW(), decided_by = $1
            WHERE id = $2`,
          [req.user.id, flag.id]
        );
      } else {
        // 'remove': hide the video and resolve every open flag on it.
        await client.query(
          `UPDATE restaurant_media SET status = 'hidden' WHERE id = $1`,
          [flag.media_id]
        );
        await client.query(
          `UPDATE restaurant_media_flags
              SET status = 'resolved', decided_at = NOW(), decided_by = $1
            WHERE media_id = $2 AND status = 'open'`,
          [req.user.id, flag.media_id]
        );
      }
      await client.query('COMMIT');
      return res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

module.exports = {
  parseMediaVideoUrl,
  mediaSubmitLimiter,
  mediaFlagLimiter,
  listRestaurantMedia: exports.listRestaurantMedia,
  postRestaurantMedia: exports.postRestaurantMedia,
  toggleMediaLike: exports.toggleMediaLike,
  deleteRestaurantMedia: exports.deleteRestaurantMedia,
  flagMedia: exports.flagMedia,
  adminListMediaFlags: exports.adminListMediaFlags,
  adminReviewMediaFlag: exports.adminReviewMediaFlag,
};
