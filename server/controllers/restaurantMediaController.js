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
const multer = require('multer');
const sharp = require('sharp');
const { fileTypeFromBuffer } = require('file-type');
const fileScanService = require('../services/fileScanService');
const { uploadFile, getSignedDownloadUrl, deleteFile } = require('../utils/storage');
const { stripExif } = require('../utils/stripExif');

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
    `SELECT fr.id, fr.business_id, fr.owner_user_id, b.business_name
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
        `SELECT m.id, m.media_type, m.video_url, m.provider, m.external_video_id, m.caption,
                m.created_at, m.storage_key, m.thumbnail_key, m.processing_status, m.renditions,
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
            AND m.processing_status = 'ready'
          ORDER BY m.created_at DESC
          LIMIT $3 OFFSET $4`,
        [restaurantId, viewerId, pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM restaurant_media
          WHERE restaurant_id = $1 AND status = 'visible' AND processing_status = 'ready'`,
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

    const items = await Promise.all(mediaRows.map(async (m) => {
      const item = {
        id: m.id,
        media_type: m.media_type,
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
      };
      // Upload rows are served only via re-signed URLs; the raw storage keys
      // never leave the server.
      if (m.media_type !== 'video_link') {
        item.processing_status = m.processing_status;
        item.url = m.storage_key ? await getSignedDownloadUrl(m.storage_key) : null;
        item.thumbnail_url = m.thumbnail_key ? await getSignedDownloadUrl(m.thumbnail_key) : null;
        const renditions = Array.isArray(m.renditions) ? m.renditions : [];
        item.renditions = await Promise.all(renditions.map(async (r) => ({
          url: await getSignedDownloadUrl(r.storage_key),
          width: r.width,
          height: r.height,
        })));
      }
      return item;
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

// ── GET /api/restaurants/:restaurantId/media/mine ────────────────────────────
// The signed-in user's own uploads at this restaurant, INCLUDING non-ready
// ones (quarantine / processing / failed), so the poster can see where their
// video stands. Mounted after router.use(authenticate); never public.
exports.listMyRestaurantMedia = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }
    const restaurant = await getPublicRestaurant(restaurantId);
    if (!restaurant) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Sign in required', 401, 'auth_required'));
    }

    const { rows } = await pool.query(
      `SELECT id, media_type, caption, created_at, storage_key, thumbnail_key,
              processing_status, processing_error, csam_status, renditions
         FROM restaurant_media
        WHERE restaurant_id = $1 AND user_id = $2 AND status = 'visible'
          AND media_type IN ('photo_upload', 'video_upload')
        ORDER BY created_at DESC
        LIMIT 50`,
      [restaurantId, userId]
    );

    const items = await Promise.all(rows.map(async (m) => {
      const item = {
        id: m.id,
        media_type: m.media_type,
        caption: m.caption,
        created_at: m.created_at,
        processing_status: m.processing_status,
        csam_status: m.csam_status,
        // processing_error is sanitized at write time (no paths); surfaced so
        // the poster gets an honest failure reason with a retry affordance.
        processing_error: m.processing_error,
        url: m.storage_key ? await getSignedDownloadUrl(m.storage_key) : null,
        thumbnail_url: m.thumbnail_key ? await getSignedDownloadUrl(m.thumbnail_key) : null,
      };
      const renditions = Array.isArray(m.renditions) ? m.renditions : [];
      item.renditions = await Promise.all(renditions.map(async (r) => ({
        url: await getSignedDownloadUrl(r.storage_key),
        width: r.width,
        height: r.height,
      })));
      return item;
    }));

    res.json({ success: true, items });
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

    let caption;
    let dishIds;
    try {
      caption = parseMediaCaption(req.body);
      dishIds = parseMediaDishIds(req.body?.dish_ids);
    } catch (err) {
      return next(err);
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
    const dishRows = await resolveMediaDishRows(restaurantId, dishIds);

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
      await insertMediaDishSnapshots(client, media.id, dishRows);
      // Dual-write into OxSteed Media (v2). The source id makes retries
      // idempotent and keeps the restaurant safety state linked to its Media
      // post.
      await dualWriteToMedia(client, {
        restaurantId, userId: req.user.id, caption,
        dishRows, restaurantName: restaurant.business_name,
        sourceRestaurantMediaId: media.id,
        asset: {
          assetType: 'video_link', provider: parsed.provider,
          externalUrl: parsed.url, externalVideoId: parsed.externalVideoId,
        },
      });
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

// ── Shared caption / dish validation (link posts + photo uploads) ────────────

function parseMediaCaption(body) {
  if (body?.caption === undefined || body?.caption === null) return null;
  if (typeof body.caption !== 'string') {
    throw new AppError('Caption must be a string.', 400, 'media_invalid_caption');
  }
  const caption = body.caption.trim();
  if (caption.length > 280) {
    throw new AppError(
      'Caption is too long (max 280 characters).', 400, 'media_caption_too_long'
    );
  }
  return caption || null;
}

// Multipart photo posts carry dish_ids as a JSON string; JSON link posts carry
// a real array. allowJsonString gates the string form so the link endpoint
// keeps its exact historic behavior.
function parseMediaDishIds(raw, { allowJsonString = false } = {}) {
  let dishIds = raw ?? [];
  if (typeof dishIds === 'string') {
    if (!allowJsonString) {
      throw new AppError('dish_ids must be an array.', 400, 'media_invalid_dish_ids');
    }
    if (!dishIds.trim()) return [];
    try {
      dishIds = JSON.parse(dishIds);
    } catch {
      throw new AppError('dish_ids must be an array.', 400, 'media_invalid_dish_ids');
    }
  }
  if (!Array.isArray(dishIds)) {
    throw new AppError('dish_ids must be an array.', 400, 'media_invalid_dish_ids');
  }
  dishIds = [...new Set(dishIds.map(parsePositiveInt).filter(Boolean))];
  if (dishIds.length > 10) {
    throw new AppError(
      'Too many tagged dishes (max 10).', 400, 'media_too_many_dishes'
    );
  }
  return dishIds;
}

// Every tagged dish must belong to this restaurant. Returns the rows with the
// name/price snapshot columns; throws media_dish_not_found otherwise.
async function resolveMediaDishRows(restaurantId, dishIds) {
  if (!dishIds.length) return [];
  const { rows } = await pool.query(
    `SELECT id, name, price_cents, currency_code
       FROM food_menu_items
      WHERE restaurant_id = $1 AND id = ANY($2)`,
    [restaurantId, dishIds]
  );
  if (rows.length !== dishIds.length) {
    throw new AppError(
      'One or more dishes do not belong to this restaurant.', 400, 'media_dish_not_found'
    );
  }
  return rows;
}

async function insertMediaDishSnapshots(client, mediaId, dishRows) {
  for (const d of dishRows) {
    await client.query(
      `INSERT INTO restaurant_media_items
         (media_id, menu_item_id, item_name_snapshot, item_price_snapshot_cents, currency_code)
       VALUES ($1, $2, $3, $4, $5)`,
      [mediaId, d.id, d.name, d.price_cents, d.currency_code]
    );
  }
}

// Dual-write restaurant media into OxSteed Media (Emile locked #17).
// Creates a media_post with actor_type=restaurant and mirrors dish items
// into media_post_links. Fail-open: if Media tables don't exist yet, skip.
async function dualWriteToMedia(client, {
  restaurantId, userId, caption, dishRows, restaurantName,
  sourceRestaurantMediaId, asset,
}) {
  try {
    if (sourceRestaurantMediaId) {
      const { rows: existingPost } = await client.query(
        `SELECT id FROM media_posts WHERE source_restaurant_media_id = $1`,
        [sourceRestaurantMediaId]
      );
      if (existingPost[0]) return existingPost[0].id;
    }
    // Get or create the restaurant actor.
    const { rows: existing } = await client.query(
      `SELECT id FROM media_actors WHERE actor_type = 'restaurant' AND restaurant_id = $1`,
      [restaurantId]
    );
    let actorId = existing[0]?.id;
    if (!actorId) {
      const { rows: created } = await client.query(
        `INSERT INTO media_actors
           (actor_type, owner_user_id, restaurant_id, handle, display_name, verified_kind)
         VALUES ('restaurant', $1, $2, $3, $4, 'restaurant')
         ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`,
        [userId, restaurantId, `restaurant-${restaurantId}`, restaurantName || `Restaurant ${restaurantId}`]
      );
      actorId = created[0].id;
    }

    const isVideoUpload = asset?.assetType === 'video';
    const { rows: post } = await client.query(
      `INSERT INTO media_posts
         (actor_id, body, visibility, processing_status, csam_status, source_restaurant_media_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        actorId,
        caption || '',
        isVideoUpload ? 'unlisted' : 'public',
        isVideoUpload ? 'quarantine' : 'ready',
        isVideoUpload ? 'pending' : 'passed',
        sourceRestaurantMediaId || null,
      ]
    );
    if (!post[0] && sourceRestaurantMediaId) {
      const { rows: existingPost } = await client.query(
        `SELECT id FROM media_posts WHERE source_restaurant_media_id = $1`,
        [sourceRestaurantMediaId]
      );
      return existingPost[0]?.id || null;
    }
    if (asset) {
      await client.query(
        `INSERT INTO media_post_assets
           (post_id, asset_type, provider, storage_key, thumbnail_key, renditions,
            external_url, external_video_id, processing_status, csam_status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
        [
          post[0].id,
          asset.assetType,
          asset.provider || 'upload',
          asset.storageKey || null,
          asset.thumbnailKey || null,
          JSON.stringify(asset.renditions || {}),
          asset.externalUrl || null,
          asset.externalVideoId || null,
          isVideoUpload ? 'quarantine' : 'ready',
          isVideoUpload ? 'pending' : 'not_required',
        ]
      );
    }
    if (isVideoUpload) {
      const { rows: [assetRow] } = await client.query(
        `SELECT id FROM media_post_assets WHERE post_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [post[0].id]
      );
      await client.query(
        `INSERT INTO media_processing_jobs (post_id, asset_id, job_type)
         VALUES ($1, $2, 'csam_check'), ($1, $2, 'transcode')`,
        [post[0].id, assetRow.id]
      );
    }
    // Keep the restaurant card actionable while preserving its snapshot if the
    // target is removed later.
    await client.query(
      `INSERT INTO media_post_links
         (post_id, link_type, target_id, name_snapshot, sort_order)
       VALUES ($1, 'restaurant', $2, $3, 0)
       ON CONFLICT (post_id, link_type, target_id) DO NOTHING`,
      [post[0].id, String(restaurantId), restaurantName || `Restaurant ${restaurantId}`]
    );

    for (let i = 0; i < dishRows.length; i++) {
      const d = dishRows[i];
      await client.query(
        `INSERT INTO media_post_links
           (post_id, link_type, target_id, name_snapshot, price_snapshot_cents, currency_code, sort_order)
         VALUES ($1, 'food_item', $2, $3, $4, $5, $6)
         ON CONFLICT (post_id, link_type, target_id) DO NOTHING`,
        [post[0].id, `${restaurantId}:${d.id}`, d.name, d.price_cents, d.currency_code, i + 1]
      );
    }
    return post[0].id;
  } catch (err) {
    // Fail-open: restaurant media must not break if Media tables are missing.
    return null;
  }
}

// ── POST /api/restaurants/:restaurantId/media/photo-uploads ──────────────────
// Device photo upload. Shares the 10/day mediaSubmitLimiter budget with link
// posts. Fail-closed pipeline: multer (10MB memory) -> magic bytes
// (jpeg/png/webp only) -> malware scan (must be clean AND from a real
// scanner; skipped/unavailable/EICAR results all reject) -> EXIF strip ->
// 480px thumbnail -> object storage -> one DB transaction. Nothing is stored
// unless every gate passes.

const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PHOTO_STORAGE_FOLDER = 'restaurant-media/photos';
const PHOTO_THUMBNAIL_WIDTH = 480;
const PHOTO_THUMBNAIL_QUALITY = 82;

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
}).single('file');

function thumbnailPipeline(cleanBuffer, mime) {
  const pipeline = sharp(cleanBuffer)
    .resize({ width: PHOTO_THUMBNAIL_WIDTH, withoutEnlargement: true });
  if (mime === 'image/png') return pipeline.png();
  if (mime === 'image/webp') return pipeline.webp({ quality: PHOTO_THUMBNAIL_QUALITY });
  return pipeline.jpeg({ quality: PHOTO_THUMBNAIL_QUALITY });
}

exports.postRestaurantMediaPhoto = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      return next(new AppError('A photo file is required.', 400, 'media_photo_required'));
    }

    let caption;
    let dishIds;
    try {
      caption = parseMediaCaption(req.body);
      dishIds = parseMediaDishIds(req.body?.dish_ids, { allowJsonString: true });
    } catch (err) {
      return next(err);
    }

    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }
    const restaurant = await getPublicRestaurant(restaurantId);
    if (!restaurant) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }
    const dishRows = await resolveMediaDishRows(restaurantId, dishIds);

    // Magic-bytes gate: the client-declared Content-Type is untrusted.
    const detected = await fileTypeFromBuffer(file.buffer);
    const mime = detected && PHOTO_ALLOWED_MIMES.has(detected.mime) ? detected.mime : null;
    if (!mime) {
      return next(new AppError(
        'Only JPEG, PNG, or WebP photos are accepted.', 400, 'media_photo_invalid_type'
      ));
    }
    if (file.mimetype && file.mimetype !== detected.mime) {
      return next(new AppError(
        'The photo content does not match its reported type.', 400, 'media_photo_mime_mismatch'
      ));
    }

    // Malware gate, fail closed: a clean verdict from a REAL scanner is
    // required. A skipped/static result or an unreachable scanner rejects the
    // upload, and nothing is stored.
    let scan;
    try {
      scan = await fileScanService.scanBuffer(file.buffer);
    } catch {
      return next(new AppError(
        'Photo security scanning is temporarily unavailable. Please try again later.',
        503,
        'media_scan_unavailable'
      ));
    }
    if (!scan || scan.clean !== true) {
      return next(new AppError(
        'The photo was rejected by the security scan.', 400, 'media_scan_rejected'
      ));
    }
    if (scan.skipped || scan.provider === 'static') {
      return next(new AppError(
        'Photo security scanning is temporarily unavailable. Please try again later.',
        503,
        'media_scan_unavailable'
      ));
    }

    // Strip metadata (GPS especially), then build the thumbnail.
    const cleanBuffer = await stripExif(file.buffer);
    const { data: thumbBuffer, info: thumbInfo } = await thumbnailPipeline(cleanBuffer, mime)
      .toBuffer({ resolveWithObject: true });

    // Store original + thumbnail, then insert the row in one transaction. On
    // any failure after the first write, best-effort delete the orphans.
    const ext = PHOTO_MIME_TO_EXT[mime];
    const storedKeys = [];
    let media;
    try {
      const storageKey = await uploadFile(cleanBuffer, PHOTO_STORAGE_FOLDER, `photo.${ext}`, mime);
      storedKeys.push(storageKey);
      const thumbnailKey = await uploadFile(thumbBuffer, PHOTO_STORAGE_FOLDER, `thumb.${ext}`, mime);
      storedKeys.push(thumbnailKey);

      const renditions = JSON.stringify([{
        storage_key: thumbnailKey,
        width: thumbInfo.width,
        height: thumbInfo.height,
        size_bytes: thumbInfo.size,
      }]);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // external_video_id has no meaning for uploads but is NOT NULL from
        // migration 664; store the empty string (never rendered for uploads).
        const { rows: [row] } = await client.query(
          `INSERT INTO restaurant_media
             (restaurant_id, user_id, media_type, provider, video_url, external_video_id,
              caption, storage_key, thumbnail_key, processing_status, csam_status, renditions)
           VALUES ($1, $2, 'photo_upload', 'upload', NULL, '', $3, $4, $5, 'ready', 'not_required', $6)
           RETURNING id, media_type, provider, caption, storage_key, thumbnail_key,
                     processing_status, created_at`,
          [restaurantId, req.user.id, caption, storageKey, thumbnailKey, renditions]
        );
        await insertMediaDishSnapshots(client, row.id, dishRows);
        await dualWriteToMedia(client, {
          restaurantId, userId: req.user.id, caption,
          dishRows, restaurantName: restaurant.business_name,
          sourceRestaurantMediaId: row.id,
          asset: {
            assetType: 'image', provider: 'upload',
            storageKey, thumbnailKey, renditions: JSON.parse(renditions),
          },
        });
        await client.query('COMMIT');
        media = row;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      await Promise.allSettled(storedKeys.map((k) => deleteFile(k)));
      throw err;
    }

    const [url, thumbnailUrl] = await Promise.all([
      getSignedDownloadUrl(media.storage_key),
      getSignedDownloadUrl(media.thumbnail_key),
    ]);
    return res.status(201).json({
      success: true,
      media: {
        id: media.id,
        media_type: media.media_type,
        provider: media.provider,
        caption: media.caption,
        url,
        thumbnail_url: thumbnailUrl,
        processing_status: media.processing_status,
        created_at: media.created_at,
      },
    });
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
    await pool.query(
      `UPDATE media_posts SET visibility = 'removed', deleted_at = COALESCE(deleted_at, NOW())
        WHERE source_restaurant_media_id = $1`, [media.id]
    );
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
          `UPDATE media_posts SET visibility = 'removed', deleted_at = COALESCE(deleted_at, NOW())
            WHERE source_restaurant_media_id = $1`, [flag.media_id]
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
  photoUpload,
  listRestaurantMedia: exports.listRestaurantMedia,
  listMyRestaurantMedia: exports.listMyRestaurantMedia,
  postRestaurantMedia: exports.postRestaurantMedia,
  postRestaurantMediaPhoto: exports.postRestaurantMediaPhoto,
  toggleMediaLike: exports.toggleMediaLike,
  deleteRestaurantMedia: exports.deleteRestaurantMedia,
  flagMedia: exports.flagMedia,
  adminListMediaFlags: exports.adminListMediaFlags,
  adminReviewMediaFlag: exports.adminReviewMediaFlag,
  dualWriteToMedia,
};
