'use strict';

// OxSteed Media: X-shaped local content branch.
// MVP: verified helpers/businesses/restaurants post; photo uploads public,
// video uploads require Didit + block public until CSAM vendor certified.

const pool = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');
const { getSignedDownloadUrl } = require('../utils/storage');

const MAX_LINKS_PER_POST = 5;
const POSTS_PER_DAY = 10;
const MVP_LINK_TYPES = new Set(['restaurant', 'food_item', 'helper', 'business', 'job']);
const VALID_LINK_COUNT_SQL = `COUNT(l.id) FILTER (WHERE
    (l.link_type = 'restaurant' AND EXISTS (
      SELECT 1 FROM food_restaurants r
       WHERE r.id::text = l.target_id AND r.status = 'active'
    )) OR
    (l.link_type = 'food_item' AND EXISTS (
      SELECT 1 FROM food_menu_items i
      JOIN food_restaurants r ON r.id = i.restaurant_id
       WHERE i.id::text = split_part(l.target_id, ':', 2)
         AND r.id::text = split_part(l.target_id, ':', 1)
         AND r.status = 'active'
    )) OR
    (l.link_type = 'helper' AND EXISTS (
      SELECT 1 FROM helper_profiles hp JOIN users u ON u.id = hp.user_id
       WHERE (hp.id::text = l.target_id OR hp.user_id::text = l.target_id OR hp.profile_slug::text = l.target_id)
         AND u.deleted_at IS NULL
    )) OR
    (l.link_type = 'business' AND EXISTS (
      SELECT 1 FROM businesses b
       WHERE b.id::text = l.target_id AND b.deleted_at IS NULL AND b.is_active = TRUE
    )) OR
    (l.link_type = 'job' AND EXISTS (
      SELECT 1 FROM jobs j
       WHERE j.id::text = l.target_id AND j.deleted_at IS NULL AND j.status IN ('open', 'published')
    ))
  )`;

// Blocks apply to direct links as well as the feed. Keep the same two-way
// relationship everywhere so a blocked author cannot be reached through a
// post, quote, reply, actor, or search result URL.
function addViewerBlockFilter(where, params, viewerUserId, actorAlias = 'a') {
  const activeAuthor = `EXISTS (SELECT 1 FROM users media_author
    WHERE media_author.id = ${actorAlias}.owner_user_id
      AND media_author.deleted_at IS NULL AND media_author.is_active = TRUE
      AND media_author.is_banned = FALSE)`;
  if (!viewerUserId) return `(${where}) AND ${activeAuthor}`;
  params.push(viewerUserId);
  const viewerParam = params.length;
  return `(${where}) AND ${activeAuthor} AND NOT EXISTS (
    SELECT 1 FROM user_blocks ub
     WHERE (ub.blocker_id = $${viewerParam} AND ub.blocked_id = ${actorAlias}.owner_user_id)
        OR (ub.blocker_id = ${actorAlias}.owner_user_id AND ub.blocked_id = $${viewerParam})
  )`;
}

async function notifyMediaUser({ userId, type, title, body, postId }) {
  if (!userId) return;
  try {
    await sendNotification({
      userId,
      type,
      title,
      body,
      data: { post_id: postId },
      action_url: `/media/post/${postId}`,
      // A stable key prevents duplicate notifications when a client retries an
      // action or the request is replayed after a transient response failure.
      idempotencyKey: `${type}:${postId}:${userId}`,
    });
  } catch (err) {
    logger.warn('media notification failed', { type, postId, message: err.message });
  }
}

async function visiblePost(postId, viewerUserId) {
  const params = [postId];
  const where = addViewerBlockFilter(
    `p.id = $1 AND p.deleted_at IS NULL AND p.visibility = 'public'
      AND p.processing_status = 'ready' AND p.csam_status = 'passed'`,
    params, viewerUserId
  );
  const { rows } = await pool.query(
    `SELECT p.id FROM media_posts p JOIN media_actors a ON a.id = p.actor_id WHERE ${where}`, params
  );
  return !!rows[0];
}

// Who can post at MVP: verified helpers, businesses, restaurants only.
async function getOrCreateActor(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM media_actors WHERE owner_user_id = $1 LIMIT 1`,
    [userId]
  );
  if (rows[0]) {
    const existing = rows[0];
    // Verification can be revoked after an actor row is created. Recheck the
    // source of truth before allowing a new post or repost.
    if (existing.actor_type === 'helper') {
      const { rows: verified } = await pool.query(
        `SELECT 1 FROM helper_profiles hp JOIN users u ON u.id = hp.user_id
          WHERE hp.user_id = $1 AND u.identity_verified = TRUE AND u.is_active = TRUE
            AND u.is_banned = FALSE LIMIT 1`, [userId]
      );
      if (!verified[0]) return null;
    } else if (existing.actor_type === 'business') {
      const { rows: verified } = await pool.query(
        `SELECT 1 FROM businesses WHERE user_id = $1 AND deleted_at IS NULL
          AND is_active = TRUE AND is_business_verified = TRUE LIMIT 1`, [userId]
      );
      if (!verified[0]) return null;
    } else if (existing.actor_type === 'restaurant') {
      const { rows: verified } = await pool.query(
        `SELECT 1 FROM food_restaurants WHERE owner_user_id = $1
          AND status != 'suspended' AND is_verified = TRUE LIMIT 1`, [userId]
      );
      if (!verified[0]) return null;
    }
    return existing;
  }

  // Determine actor type from verified profiles.
  const { rows: helper } = await pool.query(
    `SELECT hp.id, hp.profile_slug, u.first_name, u.last_name, u.profile_photo_url,
            u.identity_verified
       FROM helper_profiles hp JOIN users u ON u.id = hp.user_id
      WHERE hp.user_id = $1 LIMIT 1`,
    [userId]
  );
  const { rows: biz } = await pool.query(
    `SELECT b.id, b.profile_slug, b.business_name, b.logo_url, b.is_business_verified
       FROM businesses b WHERE b.user_id = $1 AND b.deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  const { rows: rest } = await pool.query(
    `SELECT r.id, r.display_name, r.logo_url, r.is_verified
       FROM food_restaurants r
      WHERE r.owner_user_id = $1 AND r.status != 'suspended' LIMIT 1`,
    [userId]
  );

  let actor = null;
  if (helper[0]?.identity_verified) {
    actor = {
      type: 'helper', handle: helper[0].profile_slug || `helper-${helper[0].id}`,
      name: `${helper[0].first_name || ''} ${helper[0].last_name || ''}`.trim(),
      avatar: helper[0].profile_photo_url, verified: 'identity',
    };
  } else if (biz[0]?.is_business_verified) {
    actor = {
      type: 'business', handle: biz[0].profile_slug || `business-${biz[0].id}`,
      name: biz[0].business_name, avatar: biz[0].logo_url, verified: 'business',
    };
  } else if (rest[0]?.is_verified) {
    actor = {
      type: 'restaurant', handle: `restaurant-${rest[0].id}`,
      name: rest[0].display_name, avatar: rest[0].logo_url, verified: 'restaurant',
    };
  }
  if (!actor) return null;

  const { rows: created } = await pool.query(
    `INSERT INTO media_actors
       (actor_type, owner_user_id, handle, display_name, avatar_url, verified_kind)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (handle) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url,
       verified_kind = EXCLUDED.verified_kind,
       updated_at = NOW()
     RETURNING *`,
    [actor.type, userId, actor.handle, actor.name, actor.avatar, actor.verified]
  );
  return created[0];
}

// Everyone may reply at launch, even when they are not an approved poster.
// Keep those replies attached to the same identity surface without granting
// the account a verified posting actor.
async function getOrCreateReplyActor(userId) {
  const { rows: existing } = await pool.query(
    `SELECT * FROM media_actors WHERE owner_user_id = $1 AND actor_type = 'user' LIMIT 1`,
    [userId]
  );
  if (existing[0]) return existing[0];

  const { rows: users } = await pool.query(
    `SELECT id, first_name, last_name, email, profile_photo_url
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  if (!users[0]) return null;
  const user = users[0];
  const displayName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || 'OxSteed member';
  const { rows: created } = await pool.query(
    `INSERT INTO media_actors
       (actor_type, owner_user_id, handle, display_name, avatar_url, verified_kind)
     VALUES ('user', $1, $2, $3, $4, 'none')
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url, updated_at = NOW()
     RETURNING *`,
    [userId, `user-${userId}`, displayName, user.profile_photo_url || null]
  );
  return created[0];
}

const LINK_URL_BUILDERS = {
  restaurant: (id) => `/restaurants/r/${id}`,
  food_item: (id) => {
    // food_item target_id format: "restaurantId:menuItemId"
    const [restId, itemId] = String(id).split(':');
    return `/restaurants/r/${restId}?dish=${itemId}`;
  },
  helper: (id) => `/helpers/${encodeURIComponent(String(id))}`,
  business: (id) => /^\d+$/.test(String(id)) ? `/businesses/public/${id}` : `/b/${encodeURIComponent(String(id))}`,
  job: (id) => `/jobs/public/${id}`,
  tool_rental: (id) => `/tool-rentals/${id}`,
  direct_catalog: (id) => `/direct/skills?item=${id}`,
  logistics_campaign: (id) => `/logistics/campaigns/${id}`,
};

const LINK_CTAS = {
  restaurant: 'View',
  food_item: 'Order',
  helper: 'Book',
  business: 'View',
  job: 'Apply',
  tool_rental: 'Rent',
  direct_catalog: 'Book',
  logistics_campaign: 'View',
};

async function hydrateLinks(postId) {
  const { rows } = await pool.query(
    `SELECT * FROM media_post_links WHERE post_id = $1 ORDER BY sort_order`,
    [postId]
  );
  const targetInfo = await Promise.all(rows.map(async (l) => {
    const targetId = String(l.target_id || '');
    try {
      if (l.link_type === 'restaurant') {
        const { rows: targets } = await pool.query(
          `SELECT display_name AS name FROM food_restaurants WHERE id = $1 AND status = 'active'`, [targetId]
        );
        return targets[0] || null;
      }
      if (l.link_type === 'food_item') {
        const [restaurantId, itemId] = targetId.split(':');
        const { rows: targets } = await pool.query(
          `SELECT i.name, i.price_cents
             FROM food_menu_items i
             JOIN food_restaurants r ON r.id = i.restaurant_id
            WHERE i.id = $1 AND r.id = $2 AND r.status = 'active'`,
          [itemId, restaurantId]
        );
        return targets[0] || null;
      }
      if (l.link_type === 'helper') {
        const { rows: targets } = await pool.query(
          `SELECT TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS name
             FROM helper_profiles hp
             JOIN users u ON u.id = hp.user_id
            WHERE (hp.id::text = $1 OR hp.user_id::text = $1 OR hp.profile_slug::text = $1)
              AND u.deleted_at IS NULL`, [targetId]
        );
        return targets[0] || null;
      }
      if (l.link_type === 'business') {
        const { rows: targets } = await pool.query(
          `SELECT business_name AS name FROM businesses WHERE (id::text = $1 OR profile_slug::text = $1)
             AND deleted_at IS NULL AND is_active = TRUE`, [targetId]
        );
        return targets[0] || null;
      }
      if (l.link_type === 'job') {
        const { rows: targets } = await pool.query(
          `SELECT title AS name FROM jobs WHERE id = $1 AND deleted_at IS NULL AND status IN ('open', 'published')`, [targetId]
        );
        return targets[0] || null;
      }
      return null;
    } catch (err) {
      logger.warn('media.hydrateLinks target lookup failed', { linkType: l.link_type, message: err.message });
      return null;
    }
  }));
  return rows.map((l, index) => {
    const builder = LINK_URL_BUILDERS[l.link_type];
    const target = targetInfo[index];
    const canonical_url = target && builder ? builder(l.target_id) : null;
    return {
      ...l,
      name: target?.name || l.name_snapshot,
      price_cents: target?.price_cents ?? l.price_snapshot_cents ?? null,
      available: !!target,
      canonical_url,
      cta: LINK_CTAS[l.link_type] || 'View',
    };
  });
}

async function hydratePost(post, viewerUserId) {
  const links = await hydrateLinks(post.id);
  const { rows: assetRows } = await pool.query(
    `SELECT * FROM media_post_assets WHERE post_id = $1 ORDER BY sort_order`,
    [post.id]
  );
  const assets = await Promise.all(assetRows.map(async (asset) => {
    if (!asset.storage_key) return { ...asset, url: asset.external_url || null };
    try {
      return {
        ...asset,
        url: await getSignedDownloadUrl(asset.storage_key),
        thumbnail_url: asset.thumbnail_key ? await getSignedDownloadUrl(asset.thumbnail_key) : null,
      };
    } catch (err) {
      logger.warn('media asset URL signing failed', { assetId: asset.id, message: err.message });
      return { ...asset, url: null, thumbnail_url: null };
    }
  }));
  let liked = false, bookmarked = false, reposted = false;
  if (viewerUserId) {
    const { rows: l } = await pool.query(
      `SELECT 1 FROM media_likes WHERE post_id = $1 AND user_id = $2`,
      [post.id, viewerUserId]
    );
    liked = !!l[0];
    const { rows: b } = await pool.query(
      `SELECT 1 FROM media_bookmarks WHERE post_id = $1 AND user_id = $2`,
      [post.id, viewerUserId]
    );
    bookmarked = !!b[0];
    const { rows: r } = await pool.query(
      `SELECT 1 FROM media_reposts mr
         JOIN media_actors ma ON ma.id = mr.actor_id
        WHERE mr.post_id = $1 AND ma.owner_user_id = $2`,
      [post.id, viewerUserId]
    );
    reposted = !!r[0];
  }
  return { ...post, links, assets, liked, bookmarked, reposted };
}

async function getFeed(req, res) {
  try {
    const tab = req.query.tab || 'home';
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const before = req.query.before || null;
    const viewerUserId = req.user?.id || null;
    let localityBoost = '0';

    const orderBy = 'p.created_at DESC, p.id DESC';
    const params = [limit];
    let where = `p.visibility = 'public' AND p.deleted_at IS NULL AND p.parent_id IS NULL
      AND p.processing_status = 'ready' AND p.csam_status = 'passed'
      AND EXISTS (SELECT 1 FROM users au WHERE au.id = a.owner_user_id
        AND au.deleted_at IS NULL AND au.is_active = TRUE AND au.is_banned = FALSE)`;

    let rankedCursor = null;
    if (before) {
      try {
        rankedCursor = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
      } catch { rankedCursor = null; }
    }
    if (viewerUserId) {
      params.push(viewerUserId);
      const viewerParam = params.length;
      where += ` AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
         WHERE (ub.blocker_id = $${viewerParam} AND ub.blocked_id = a.owner_user_id)
            OR (ub.blocker_id = a.owner_user_id AND ub.blocked_id = $${viewerParam})
      )`;
      localityBoost = `CASE
        WHEN p.community_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM media_community_members cm
           WHERE cm.community_id = p.community_id AND cm.user_id = $${viewerParam}
        ) THEN 2
        WHEN p.community_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM media_communities nearby
          JOIN users viewer_location ON viewer_location.id = $${viewerParam}
           WHERE nearby.id = p.community_id
             AND nearby.geo_scope IS NOT NULL
             AND LOWER(split_part(nearby.geo_scope, ',', 1)) = LOWER(viewer_location.city)
        ) THEN 1
        ELSE 0 END`;
    }

    let rankedAfter = '';
    if (rankedCursor?.created_at && rankedCursor?.id) {
      params.push(Number(rankedCursor.link_count) || 0, Number(rankedCursor.locality_boost) || 0,
        rankedCursor.created_at, rankedCursor.id);
      const linkParam = params.length - 3;
      const localityParam = params.length - 2;
      const createdParam = params.length - 1;
      const idParam = params.length;
      rankedAfter = ` HAVING (link_count < $${linkParam}
        OR (link_count = $${linkParam} AND locality_boost < $${localityParam})
        OR (link_count = $${linkParam} AND locality_boost = $${localityParam} AND p.created_at < $${createdParam})
        OR (link_count = $${linkParam} AND locality_boost = $${localityParam} AND p.created_at = $${createdParam} AND p.id < $${idParam}))`;
    } else if (before) {
      params.push(before);
      rankedAfter = ` HAVING p.created_at < $${params.length}`;
    }

    // Deep-link boost: posts with valid local entity links rank higher.
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type,
              ${VALID_LINK_COUNT_SQL} AS link_count,
              ${localityBoost} AS locality_boost
         FROM media_posts p
         JOIN media_actors a ON a.id = p.actor_id
         LEFT JOIN media_post_links l ON l.post_id = p.id
        WHERE ${where}
        GROUP BY p.id, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
        ${rankedAfter}
        ORDER BY link_count DESC, locality_boost DESC, ${orderBy}
        LIMIT $1`,
      params
    );

    const posts = [];
    for (const row of rows) {
      posts.push(await hydratePost(row, viewerUserId));
    }
    const last = rows[rows.length - 1];
    const nextBefore = last ? Buffer.from(JSON.stringify({
      link_count: Number(last.link_count) || 0,
      locality_boost: Number(last.locality_boost) || 0,
      created_at: last.created_at,
      id: last.id,
    })).toString('base64url') : null;
    res.json({ posts, next_before: nextBefore, has_more: rows.length === limit });
  } catch (err) {
    logger.error('media.getFeed error', { message: err.message });
    res.status(500).json({ error: 'Failed to load feed' });
  }
}

async function getPost(req, res) {
  try {
    const params = [req.params.id];
    const viewerUserId = req.user?.id || null;
    const where = addViewerBlockFilter(
      `p.id = $1 AND p.deleted_at IS NULL AND p.visibility = 'public'
          AND p.processing_status = 'ready' AND p.csam_status = 'passed'`,
      params,
      viewerUserId
    );
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type, a.owner_user_id
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE ${where}`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Post not found' });
    const post = await hydratePost(rows[0], viewerUserId);

    // Quote embed
    if (post.quoted_post_id) {
      const quoteParams = [post.quoted_post_id];
      const quoteWhere = addViewerBlockFilter(
        `p.id = $1 AND p.deleted_at IS NULL AND p.visibility = 'public'
            AND p.processing_status = 'ready' AND p.csam_status = 'passed'`,
        quoteParams,
        viewerUserId
      );
      const { rows: q } = await pool.query(
        `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind
           FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
          WHERE ${quoteWhere}`,
        quoteParams
      );
      if (q[0]) post.quoted = await hydratePost(q[0], viewerUserId);
    }
    res.json({ post });
  } catch (err) {
    logger.error('media.getPost error', { message: err.message });
    res.status(500).json({ error: 'Failed to load post' });
  }
}

async function getDrafts(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type, a.owner_user_id
         FROM media_posts p
         JOIN media_actors a ON a.id = p.actor_id
        WHERE p.deleted_at IS NULL AND p.visibility = 'unlisted'
          AND p.processing_status IN ('draft', 'quarantine', 'failed', 'blocked', 'ready')
          AND a.owner_user_id = $1
        ORDER BY p.created_at DESC
        LIMIT 20`,
      [req.user.id]
    );
    const drafts = [];
    for (const row of rows) drafts.push(await hydratePost(row, req.user.id));
    res.json({ drafts });
  } catch (err) {
    logger.error('media.getDrafts error', { message: err.message });
    res.status(500).json({ error: 'Failed to load drafts' });
  }
}

async function getDraft(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type, a.owner_user_id
         FROM media_posts p
         JOIN media_actors a ON a.id = p.actor_id
        WHERE p.id = $1 AND p.deleted_at IS NULL AND p.visibility = 'unlisted'
          AND p.processing_status IN ('draft', 'quarantine', 'failed', 'blocked', 'ready')
          AND a.owner_user_id = $2
        LIMIT 1`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Draft not found', code: 'media_draft_not_found' });
    res.json({ draft: await hydratePost(rows[0], req.user.id) });
  } catch (err) {
    logger.error('media.getDraft error', { message: err.message });
    res.status(500).json({ error: 'Failed to load draft' });
  }
}

async function getBookmarks(req, res) {
  try {
    const params = [req.user.id];
    const where = addViewerBlockFilter(
      `p.deleted_at IS NULL AND p.visibility = 'public'
        AND p.processing_status = 'ready' AND p.csam_status = 'passed'
        AND b.user_id = $1`,
      params,
      req.user.id
    );
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type, a.owner_user_id
         FROM media_bookmarks b
         JOIN media_posts p ON p.id = b.post_id
         JOIN media_actors a ON a.id = p.actor_id
        WHERE ${where}
        ORDER BY b.created_at DESC
        LIMIT 100`,
      params
    );
    const posts = [];
    for (const row of rows) posts.push(await hydratePost(row, req.user.id));
    res.json({ posts });
  } catch (err) {
    logger.error('media.getBookmarks error', { message: err.message });
    res.status(500).json({ error: 'Failed to load saved posts' });
  }
}

async function getReplies(req, res) {
  try {
    if (!await visiblePost(req.params.id, req.user?.id)) return res.status(404).json({ error: 'Post not found' });
    const sort = req.query.sort === 'relevant' ? 'relevant' : 'latest';
    let orderClause = 'p.created_at DESC';
    if (sort === 'relevant') {
      // Relevant: engagement-weighted (likes x3 + reposts x5 + replies x2),
      // with recency decay (newer posts get a boost).
      orderClause = `(p.like_count * 3 + p.repost_count * 5 + p.reply_count * 2 +
        GREATEST(0, 100 - EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600)) DESC`;
    }
    const params = [req.params.id];
    const where = addViewerBlockFilter(
      `p.parent_id = $1 AND p.deleted_at IS NULL AND p.visibility = 'public'
          AND p.processing_status = 'ready' AND p.csam_status = 'passed'`,
      params,
      req.user?.id || null
    );
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE ${where}
        ORDER BY ${orderClause} LIMIT 50`,
      params
    );
    const replies = [];
    for (const row of rows) {
      replies.push(await hydratePost(row, req.user?.id || null));
    }
    res.json({ replies, sort });
  } catch (err) {
    logger.error('media.getReplies error', { message: err.message });
    res.status(500).json({ error: 'Failed to load replies' });
  }
}

async function getQuotes(req, res) {
  try {
    if (!await visiblePost(req.params.id, req.user?.id)) return res.status(404).json({ error: 'Post not found' });
    const params = [req.params.id];
    const where = addViewerBlockFilter(
      `p.quoted_post_id = $1 AND p.deleted_at IS NULL AND p.visibility = 'public'
          AND p.processing_status = 'ready' AND p.csam_status = 'passed'`,
      params,
      req.user?.id || null
    );
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE ${where}
        ORDER BY p.created_at DESC LIMIT 50`,
      params
    );
    const quotes = [];
    for (const row of rows) {
      quotes.push(await hydratePost(row, req.user?.id || null));
    }
    res.json({ quotes });
  } catch (err) {
    logger.error('media.getQuotes error', { message: err.message });
    res.status(500).json({ error: 'Failed to load quotes' });
  }
}

async function createPost(req, res) {
  try {
    const userId = req.user.id;
    const businessId = req.body?.business_id ? parseInt(req.body.business_id, 10) : null;
    const { body, parent_id, quoted_post_id, links, community_id } = req.body;
    const isDraft = req.body?.draft === true;

    if (isDraft && (parent_id || quoted_post_id)) {
      return res.status(400).json({ error: 'Replies and quote posts cannot be saved as drafts', code: 'media_draft_target_invalid' });
    }
    
    let actor;
    if (businessId) {
      // Verify user owns/manages this business.
      const { rows: biz } = await pool.query(
        `SELECT id, business_name, profile_slug, logo_url, is_business_verified
           FROM businesses
          WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
            AND is_business_verified = TRUE`,
        [businessId, userId]
      );
      if (!biz[0]) return res.status(403).json({ error: 'Not authorized for this business' });
      // Get or create business actor.
      const { rows: actors } = await pool.query(
        `SELECT * FROM media_actors WHERE business_id = $1 AND actor_type = 'business'`,
        [businessId]
      );
      if (actors[0]) {
        actor = actors[0];
      } else {
        const { rows: created } = await pool.query(
          `INSERT INTO media_actors (actor_type, owner_user_id, business_id, handle, display_name, avatar_url, verified_kind)
           VALUES ('business', $1, $2, $3, $4, $5, 'business') RETURNING *`,
          [userId, businessId, biz[0].profile_slug || `business-${businessId}`, biz[0].business_name, biz[0].logo_url]
        );
        actor = created[0];
      }
    } else {
      actor = await getOrCreateActor(userId);
      if (!actor && parent_id) actor = await getOrCreateReplyActor(userId);
    }
    if (!actor || (!parent_id && actor.verified_kind === 'none')) {
      return res.status(403).json({
        error: 'Only verified helpers, businesses, and restaurants can post.',
        code: 'media_not_verified_poster',
      });
    }

    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Post body is required' });
    }
    if (body.length > 2000) {
      return res.status(400).json({ error: 'Post body too long (max 2000)' });
    }

    // Rate limit: 10 posts/day.
    const { rows: count } = await pool.query(
      `SELECT COUNT(*) AS c FROM media_posts
        WHERE actor_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
      [actor.id]
    );
    if (parseInt(count[0].c, 10) >= POSTS_PER_DAY) {
      return res.status(429).json({ error: 'Daily post limit reached' });
    }

    if (links && links.length > MAX_LINKS_PER_POST) {
      return res.status(400).json({ error: `Max ${MAX_LINKS_PER_POST} links per post` });
    }
    if (links && links.some((link) => !link || !MVP_LINK_TYPES.has(link.link_type) || !String(link.target_id || '').trim())) {
      return res.status(400).json({
        error: 'Only restaurant, dish, helper, business, and job links are available at launch.',
        code: 'media_link_type_unavailable',
      });
    }
    if (community_id) {
      const { rows: communities } = await pool.query(
        `SELECT id FROM media_communities WHERE id = $1`, [community_id]
      );
      if (!communities[0]) return res.status(400).json({ error: 'Space not found', code: 'media_space_not_found' });
    }
    if (parent_id || quoted_post_id) {
      const targetIds = [parent_id, quoted_post_id].filter(Boolean);
      const accessible = await Promise.all(targetIds.map((id) => visiblePost(id, userId)));
      if (accessible.some((allowed) => !allowed)) {
        return res.status(404).json({ error: 'The post you are replying to or quoting is unavailable', code: 'media_target_unavailable' });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO media_posts
         (actor_id, body, parent_id, quoted_post_id, community_id, root_id, visibility, processing_status)
       VALUES ($1, $2, $3, $4, $5,
         CASE WHEN $3 IS NOT NULL THEN (SELECT COALESCE(root_id, id) FROM media_posts WHERE id = $3) END,
         CASE WHEN $6 THEN 'unlisted' ELSE 'public' END,
         CASE WHEN $6 THEN 'draft' ELSE 'ready' END)
       RETURNING *`,
      [actor.id, body.trim(), parent_id || null, quoted_post_id || null, community_id || null, isDraft]
    );
    const post = rows[0];

    // Attach links with snapshots.
    if (links && links.length) {
      for (let i = 0; i < links.length; i++) {
        const l = links[i];
        await pool.query(
          `INSERT INTO media_post_links
             (post_id, link_type, target_id, label, name_snapshot, price_snapshot_cents, currency_code, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [post.id, l.link_type, l.target_id, l.label || null,
           l.name_snapshot || l.label || l.target_id,
           l.price_snapshot_cents || null, l.currency_code || null, i]
        );
      }
    }

    // Update parent reply count.
    if (parent_id) {
      await pool.query(
        `UPDATE media_posts SET reply_count = reply_count + 1 WHERE id = $1`,
        [parent_id]
      );
      const { rows: parentActors } = await pool.query(
        `SELECT a.owner_user_id FROM media_posts p JOIN media_actors a ON a.id = p.actor_id WHERE p.id = $1`,
        [parent_id]
      );
      if (parentActors[0]?.owner_user_id && parentActors[0].owner_user_id !== userId) {
        await notifyMediaUser({
          userId: parentActors[0].owner_user_id,
          type: 'media_reply',
          title: 'New reply on your OxSteed Media post',
          body: 'Someone replied to your post.',
          postId: parent_id,
        });
      }
    }
    if (quoted_post_id) {
      await pool.query(
        `UPDATE media_posts SET quote_count = quote_count + 1 WHERE id = $1`,
        [quoted_post_id]
      );
    }

    res.status(201).json({ post: await hydratePost(post, userId), draft: isDraft });
  } catch (err) {
    logger.error('media.createPost error', { message: err.message });
    res.status(500).json({ error: 'Failed to create post' });
  }
}

async function publishPost(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: owned } = await client.query(
      `SELECT p.*, a.owner_user_id, a.actor_type,
              CASE
                WHEN a.actor_type = 'helper' THEN EXISTS (
                  SELECT 1 FROM helper_profiles hp
                  JOIN users hu ON hu.id = hp.user_id
                  WHERE hp.user_id = a.owner_user_id
                    AND hu.identity_verified = TRUE
                    AND hu.is_active = TRUE AND hu.is_banned = FALSE
                    AND hu.deleted_at IS NULL
                )
                WHEN a.actor_type = 'business' THEN EXISTS (
                  SELECT 1 FROM businesses b
                  WHERE b.user_id = a.owner_user_id
                    AND b.deleted_at IS NULL AND b.is_active = TRUE
                    AND b.is_business_verified = TRUE
                )
                WHEN a.actor_type = 'restaurant' THEN EXISTS (
                  SELECT 1 FROM food_restaurants r
                  WHERE r.owner_user_id = a.owner_user_id
                    AND r.status <> 'suspended' AND r.is_verified = TRUE
                )
                ELSE FALSE
              END AS current_actor_verified
         FROM media_posts p
         JOIN media_actors a ON a.id = p.actor_id
         JOIN users u ON u.id = a.owner_user_id
        WHERE p.id = $1 AND a.owner_user_id = $2 AND p.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.is_active = TRUE AND u.is_banned = FALSE
        FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    if (!owned[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Draft not found', code: 'media_draft_not_found' });
    }
    // Verification is checked again at publication time. A draft created
    // while verified must not become a public post after that verification is
    // revoked.
    if (owned[0].current_actor_verified === false) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'A current verified helper, business, or restaurant profile is required to publish.',
        code: 'media_not_verified_poster',
      });
    }
    if (owned[0].visibility === 'public' && owned[0].processing_status === 'ready') {
      await client.query('COMMIT');
      return res.json({ post: await hydratePost(owned[0], req.user.id), published: true });
    }
    if (!['draft', 'quarantine', 'failed', 'ready'].includes(owned[0].processing_status) || owned[0].visibility !== 'unlisted') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This post is not a publishable draft', code: 'media_draft_state_invalid' });
    }

    const { rows: assets } = await client.query(
      `SELECT id, asset_type, processing_status, csam_status, renditions
         FROM media_post_assets WHERE post_id = $1 ORDER BY sort_order, created_at`,
      [req.params.id]
    );
    const unsafe = assets.find((asset) =>
      !['ready'].includes(asset.processing_status || 'ready') ||
      !['not_required', 'passed'].includes(asset.csam_status || 'not_required') ||
      (asset.asset_type === 'video' && process.env.MEDIA_CSAM_CERTIFIED !== 'true') ||
      (asset.asset_type === 'video' && (!asset.renditions || Object.keys(asset.renditions).length === 0))
    );
    if (unsafe || owned[0].csam_status !== 'passed') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Media is still processing or awaiting safety approval.',
        code: 'media_safety_pending',
        retryable: true,
        processing_status: owned[0].processing_status,
        csam_status: owned[0].csam_status,
        assets: assets.map((asset) => ({
          id: asset.id,
          asset_type: asset.asset_type,
          processing_status: asset.processing_status || 'ready',
          csam_status: asset.csam_status || 'not_required',
          ready: asset.processing_status === 'ready'
            && ['not_required', 'passed'].includes(asset.csam_status || 'not_required')
            && (asset.asset_type !== 'video' || (process.env.MEDIA_CSAM_CERTIFIED === 'true' && asset.renditions && Object.keys(asset.renditions).length > 0)),
        })),
      });
    }

    const { rows: published } = await client.query(
      `UPDATE media_posts
          SET visibility = 'public', processing_status = 'ready', edited_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [req.params.id]
    );
    await client.query('COMMIT');
    res.json({ post: await hydratePost(published[0], req.user.id), published: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('media.publishPost error', { message: err.message });
    res.status(500).json({ error: 'Failed to publish draft' });
  } finally {
    client.release();
  }
}

async function updatePost(req, res) {
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'Post body is required', code: 'media_body_required' });
  if (body.length > 2000) return res.status(400).json({ error: 'Post body too long (max 2000)', code: 'media_body_too_long' });
  try {
    const { rows } = await pool.query(
      `UPDATE media_posts p
          SET body = $1, edited_at = NOW()
        FROM media_actors a
       WHERE p.id = $2 AND p.actor_id = a.id AND a.owner_user_id = $3
         AND p.deleted_at IS NULL AND p.visibility = 'public'
       RETURNING p.*`,
      [body, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Post not found', code: 'media_post_not_found' });
    const { rows: hydrated } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type, a.owner_user_id
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id WHERE p.id = $1`,
      [req.params.id]
    );
    res.json({ post: await hydratePost(hydrated[0], req.user.id) });
  } catch (err) {
    logger.error('media.updatePost error', { message: err.message });
    res.status(500).json({ error: 'Failed to update post' });
  }
}

async function deletePost(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE media_posts p
          SET deleted_at = NOW(), visibility = 'removed'
        FROM media_actors a
       WHERE p.id = $1 AND p.actor_id = a.id AND a.owner_user_id = $2
         AND p.deleted_at IS NULL
       RETURNING p.id, p.parent_id, p.quoted_post_id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Post not found', code: 'media_post_not_found' });
    if (rows[0].parent_id) {
      await pool.query(`UPDATE media_posts SET reply_count = GREATEST(0, reply_count - 1) WHERE id = $1`, [rows[0].parent_id]);
    }
    if (rows[0].quoted_post_id) {
      await pool.query(`UPDATE media_posts SET quote_count = GREATEST(0, quote_count - 1) WHERE id = $1`, [rows[0].quoted_post_id]);
    }
    res.json({ deleted: true, id: rows[0].id });
  } catch (err) {
    logger.error('media.deletePost error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete post' });
  }
}

async function replacePostLinks(req, res) {
  const postId = req.params.id;
  const links = Array.isArray(req.body?.links) ? req.body.links : [];
  if (links.length > MAX_LINKS_PER_POST) {
    return res.status(400).json({ error: `Max ${MAX_LINKS_PER_POST} links per post` });
  }
  if (links.some((link) => !link || !MVP_LINK_TYPES.has(link.link_type) || !String(link.target_id || '').trim())) {
    return res.status(400).json({ error: 'Only restaurant, dish, helper, business, and job links are available at launch.', code: 'media_link_type_unavailable' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: owned } = await client.query(
      `SELECT p.id FROM media_posts p
        JOIN media_actors a ON a.id = p.actor_id
       WHERE p.id = $1 AND a.owner_user_id = $2 AND p.deleted_at IS NULL
       FOR UPDATE`, [postId, req.user.id]
    );
    if (!owned[0]) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can only edit links on your own post', code: 'media_post_forbidden' });
    }
    await client.query(`DELETE FROM media_post_links WHERE post_id = $1`, [postId]);
    for (let index = 0; index < links.length; index += 1) {
      const link = links[index];
      await client.query(
        `INSERT INTO media_post_links
           (post_id, link_type, target_id, label, name_snapshot, price_snapshot_cents, currency_code, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [postId, link.link_type, String(link.target_id).trim(), link.label || null,
          link.name_snapshot || link.label || link.target_id,
          link.price_snapshot_cents || null, link.currency_code || null, index]
      );
    }
    await client.query('COMMIT');
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id WHERE p.id = $1`, [postId]
    );
    return res.json({ post: await hydratePost(rows[0], req.user.id) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('media.replacePostLinks error', { message: err.message });
    return res.status(500).json({ error: 'Failed to update post links' });
  } finally {
    client.release();
  }
}

async function toggleLike(req, res) {
  try {
    if (!await visiblePost(req.params.id, req.user.id)) return res.status(404).json({ error: 'Post not found' });
    const userId = req.user.id;
    const postId = req.params.id;
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM media_likes WHERE post_id = $1 AND user_id = $2`,
      [postId, userId]
    );
    if (existing[0]) {
      await pool.query(`DELETE FROM media_likes WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
      await pool.query(`UPDATE media_posts SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`, [postId]);
      return res.json({ liked: false });
    }
    await pool.query(`INSERT INTO media_likes (post_id, user_id) VALUES ($1, $2)`, [postId, userId]);
    await pool.query(`UPDATE media_posts SET like_count = like_count + 1 WHERE id = $1`, [postId]);
    const { rows: owners } = await pool.query(
      `SELECT a.owner_user_id FROM media_posts p JOIN media_actors a ON a.id = p.actor_id WHERE p.id = $1`,
      [postId]
    );
    if (owners[0]?.owner_user_id && owners[0].owner_user_id !== userId) {
      await notifyMediaUser({
        userId: owners[0].owner_user_id,
        type: 'media_like',
        title: 'Someone liked your OxSteed Media post',
        body: 'Your post received a like.',
        postId,
      });
    }
    res.json({ liked: true });
  } catch (err) {
    logger.error('media.toggleLike error', { message: err.message });
    res.status(500).json({ error: 'Failed to toggle like' });
  }
}

async function toggleBookmark(req, res) {
  try {
    if (!await visiblePost(req.params.id, req.user.id)) return res.status(404).json({ error: 'Post not found' });
    const userId = req.user.id;
    const postId = req.params.id;
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM media_bookmarks WHERE post_id = $1 AND user_id = $2`,
      [postId, userId]
    );
    if (existing[0]) {
      await pool.query(`DELETE FROM media_bookmarks WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
      await pool.query(`UPDATE media_posts SET bookmark_count = GREATEST(0, bookmark_count - 1) WHERE id = $1`, [postId]);
      return res.json({ bookmarked: false });
    }
    await pool.query(`INSERT INTO media_bookmarks (post_id, user_id) VALUES ($1, $2)`, [postId, userId]);
    await pool.query(`UPDATE media_posts SET bookmark_count = bookmark_count + 1 WHERE id = $1`, [postId]);
    res.json({ bookmarked: true });
  } catch (err) {
    logger.error('media.toggleBookmark error', { message: err.message });
    res.status(500).json({ error: 'Failed to toggle bookmark' });
  }
}

async function toggleRepost(req, res) {
  try {
    if (!await visiblePost(req.params.id, req.user.id)) return res.status(404).json({ error: 'Post not found' });
    const userId = req.user.id;
    const actor = await getOrCreateActor(userId);
    if (!actor || actor.verified_kind === 'none') return res.status(403).json({ error: 'Only verified posters can repost' });
    const postId = req.params.id;
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM media_reposts WHERE post_id = $1 AND actor_id = $2`,
      [postId, actor.id]
    );
    if (existing[0]) {
      await pool.query(`DELETE FROM media_reposts WHERE post_id = $1 AND actor_id = $2`, [postId, actor.id]);
      await pool.query(`UPDATE media_posts SET repost_count = GREATEST(0, repost_count - 1) WHERE id = $1`, [postId]);
      return res.json({ reposted: false });
    }
    await pool.query(`INSERT INTO media_reposts (post_id, actor_id) VALUES ($1, $2)`, [postId, actor.id]);
    await pool.query(`UPDATE media_posts SET repost_count = repost_count + 1 WHERE id = $1`, [postId]);
    res.json({ reposted: true });
  } catch (err) {
    logger.error('media.toggleRepost error', { message: err.message });
    res.status(500).json({ error: 'Failed to toggle repost' });
  }
}

async function recordView(req, res) {
  try {
    if (!await visiblePost(req.params.id, req.user?.id)) return res.status(404).json({ error: 'Post not found' });
    const postId = req.params.id;
    const viewerUserId = req.user?.id || null;
    const hash = viewerUserId || req.ip + (req.headers['user-agent'] || '');
    const crypto = require('crypto');
    const viewerHash = crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 32);
    const { rowCount } = await pool.query(
      `INSERT INTO media_post_views (post_id, viewer_user_id, viewer_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (post_id, viewer_hash) DO NOTHING
       RETURNING post_id`,
      [postId, viewerUserId, viewerHash]
    );
    if (rowCount > 0) {
      await pool.query(
        `UPDATE media_posts SET view_count = view_count + 1
          WHERE id = $1 AND visibility = 'public'
            AND processing_status = 'ready' AND csam_status = 'passed'`,
        [postId]
      );
    }
    res.json({ ok: true, recorded: rowCount > 0 });
  } catch (err) {
    logger.error('media.recordView error', { message: err.message });
    res.status(500).json({ error: 'Failed to record view' });
  }
}

async function flagPost(req, res) {
  try {
    if (!await visiblePost(req.params.id, req.user.id)) return res.status(404).json({ error: 'Post not found' });
    const { reason, note } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason is required' });
    const { rows: recent } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM media_post_flags
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`, [req.user.id]
    );
    if (recent[0]?.count >= 30) {
      return res.status(429).json({ error: 'Hourly report limit reached', code: 'media_report_limit_reached' });
    }
    const { rows: duplicate } = await pool.query(
      `SELECT 1 FROM media_post_flags
        WHERE post_id = $1 AND user_id = $2 AND status = 'open' LIMIT 1`,
      [req.params.id, req.user.id]
    );
    if (duplicate[0]) return res.status(409).json({ error: 'You already reported this post', code: 'media_report_exists' });
    await pool.query(
      `INSERT INTO media_post_flags (post_id, user_id, reason, note)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, req.user.id, reason, note || null]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error('media.flagPost error', { message: err.message });
    res.status(500).json({ error: 'Failed to flag post' });
  }
}

async function getCommunities(req, res) {
  try {
    const params = [req.user?.id || null];
    const authorWhere = addViewerBlockFilter('a.id = p.actor_id', params, req.user?.id);
    const { rows } = await pool.query(
      `SELECT c.*,
              COUNT(DISTINCT p.id)::int AS post_count,
              EXISTS (
                SELECT 1 FROM media_community_members cm
                 WHERE cm.community_id = c.id AND cm.user_id = $1
              ) AS joined
         FROM media_communities c
        LEFT JOIN media_posts p ON p.community_id = c.id
          AND p.visibility = 'public' AND p.deleted_at IS NULL
          AND p.processing_status = 'ready' AND p.csam_status = 'passed'
          AND p.parent_id IS NULL
          AND EXISTS (SELECT 1 FROM media_actors a WHERE ${authorWhere})
        GROUP BY c.id
        ORDER BY c.geo_scope NULLS LAST, c.category NULLS LAST, c.title`,
      params
    );
    res.json({ communities: rows });
  } catch (err) {
    logger.error('media.getCommunities error', { message: err.message });
    res.status(500).json({ error: 'Failed to load communities' });
  }
}

async function getCommunity(req, res) {
  try {
    const params = [req.params.slug, req.user?.id || null];
    const authorWhere = addViewerBlockFilter('a.id = p.actor_id', params, req.user?.id);
    const { rows: communities } = await pool.query(
      `SELECT c.*,
              COUNT(DISTINCT p.id)::int AS post_count,
              EXISTS (
                SELECT 1 FROM media_community_members cm
                 WHERE cm.community_id = c.id AND cm.user_id = $2
              ) AS joined
         FROM media_communities c
         LEFT JOIN media_posts p ON p.community_id = c.id
          AND p.visibility = 'public' AND p.deleted_at IS NULL
          AND p.processing_status = 'ready' AND p.csam_status = 'passed'
          AND p.parent_id IS NULL
          AND EXISTS (SELECT 1 FROM media_actors a WHERE ${authorWhere})
        WHERE c.slug = $1
        GROUP BY c.id`,
      params
    );
    if (!communities[0]) return res.status(404).json({ error: 'Space not found' });
    const postParams = [communities[0].id];
    const postWhere = addViewerBlockFilter(
      `p.community_id = $1 AND p.visibility = 'public' AND p.deleted_at IS NULL
          AND p.processing_status = 'ready' AND p.csam_status = 'passed'
          AND p.parent_id IS NULL`, postParams, req.user?.id
    );
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE ${postWhere}
        ORDER BY p.created_at DESC LIMIT 50`,
      postParams
    );
    const posts = [];
    for (const post of rows) posts.push(await hydratePost(post, req.user?.id || null));
    res.json({ community: communities[0], posts });
  } catch (err) {
    logger.error('media.getCommunity error', { message: err.message });
    res.status(500).json({ error: 'Failed to load Space' });
  }
}

async function joinCommunity(req, res) {
  try {
    const { rows } = await pool.query(`SELECT id FROM media_communities WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Space not found' });
    await pool.query(
      `INSERT INTO media_community_members (community_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.id]
    );
    res.json({ joined: true });
  } catch (err) {
    logger.error('media.joinCommunity error', { message: err.message });
    res.status(500).json({ error: 'Failed to join Space' });
  }
}

async function leaveCommunity(req, res) {
  try {
    await pool.query(
      `DELETE FROM media_community_members WHERE community_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ joined: false });
  } catch (err) {
    logger.error('media.leaveCommunity error', { message: err.message });
    res.status(500).json({ error: 'Failed to leave Space' });
  }
}

async function searchMedia(req, res) {
  try {
    const query = String(req.query.q || '').trim().slice(0, 100);
    if (!query) return res.json({ posts: [], actors: [] });
    const pattern = `%${query}%`;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const postParams = [pattern, limit];
    const postWhere = addViewerBlockFilter(
      `p.visibility = 'public' AND p.deleted_at IS NULL AND p.parent_id IS NULL
          AND p.processing_status = 'ready' AND p.csam_status = 'passed'
          AND (p.body ILIKE $1 OR a.handle ILIKE $1 OR a.display_name ILIKE $1)`,
      postParams,
      req.user?.id || null
    );
    const { rows: posts } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE ${postWhere}
        ORDER BY p.created_at DESC LIMIT $2`,
      postParams
    );
    const hydrated = [];
    for (const post of posts) hydrated.push(await hydratePost(post, req.user?.id || null));
    const actorParams = [pattern, limit];
    const actorWhere = addViewerBlockFilter(
      `handle ILIKE $1 OR display_name ILIKE $1`,
      actorParams,
      req.user?.id || null,
      'media_actors'
    );
    const { rows: actors } = await pool.query(
      `SELECT id, actor_type, handle, display_name, avatar_url, verified_kind
         FROM media_actors
        WHERE ${actorWhere}
        ORDER BY display_name ASC LIMIT $2`,
      actorParams
    );
    res.json({ posts: hydrated, actors });
  } catch (err) {
    logger.error('media.searchMedia error', { message: err.message });
    res.status(500).json({ error: 'Failed to search Media' });
  }
}

async function getBusinessPosts(req, res) {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    if (!businessId) return res.status(400).json({ error: 'Invalid business ID' });
    const { rows: actors } = await pool.query(
      `SELECT id FROM media_actors WHERE business_id = $1 AND actor_type = 'business'`,
      [businessId]
    );
    if (!actors[0]) return res.json({ posts: [] });
    const params = [actors[0].id];
    const where = addViewerBlockFilter(
      `p.actor_id = $1 AND p.deleted_at IS NULL AND p.parent_id IS NULL
          AND p.visibility = 'public' AND p.processing_status = 'ready' AND p.csam_status = 'passed'`,
      params,
      req.user?.id || null
    );
    const { rows: posts } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE ${where}
        ORDER BY p.created_at DESC LIMIT 20`,
      params
    );
    const hydrated = [];
    for (const p of posts) hydrated.push(await hydratePost(p, req.user?.id || null));
    res.json({ posts: hydrated });
  } catch (err) {
    logger.error('media.getBusinessPosts error', { message: err.message });
    res.status(500).json({ error: 'Failed to load business posts' });
  }
}

async function getActor(req, res) {
  try {
    const actorParams = [req.params.handle];
    const actorWhere = addViewerBlockFilter('handle = $1', actorParams, req.user?.id, 'media_actors');
    const { rows } = await pool.query(
      `SELECT * FROM media_actors WHERE ${actorWhere}`,
      actorParams
    );
    if (!rows[0]) return res.status(404).json({ error: 'Actor not found' });
    const postParams = [rows[0].id];
    const postWhere = addViewerBlockFilter(
      `p.actor_id = $1 AND p.deleted_at IS NULL AND p.parent_id IS NULL
          AND p.visibility = 'public' AND p.processing_status = 'ready' AND p.csam_status = 'passed'`,
      postParams,
      req.user?.id
    );
    const { rows: posts } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE ${postWhere}
        ORDER BY p.created_at DESC LIMIT 20`,
      postParams
    );
    const hydrated = [];
    for (const p of posts) hydrated.push(await hydratePost(p, req.user?.id || null));
    res.json({ actor: rows[0], posts: hydrated });
  } catch (err) {
    logger.error('media.getActor error', { message: err.message });
    res.status(500).json({ error: 'Failed to load actor' });
  }
}

async function searchMediaEntities(req, res) {
  try {
    const type = String(req.query.type || 'restaurant').trim();
    const query = String(req.query.q || '').trim().slice(0, 120);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 8, 1), 20);
    const like = `%${query}%`;
    let rows;
    if (type === 'restaurant') {
      ({ rows } = await pool.query(
        `SELECT id::text AS target_id, display_name AS name, NULL::int AS price_snapshot_cents
           FROM food_restaurants
          WHERE status = 'active' AND display_name ILIKE $1
          ORDER BY display_name LIMIT $2`, [like, limit]
      ));
    } else if (type === 'food_item') {
      ({ rows } = await pool.query(
        `SELECT (r.id::text || ':' || i.id::text) AS target_id,
                i.name || ' · ' || r.display_name AS name,
                i.price_cents AS price_snapshot_cents
           FROM food_menu_items i
           JOIN food_restaurants r ON r.id = i.restaurant_id
          WHERE r.status = 'active' AND i.name ILIKE $1
          ORDER BY i.name LIMIT $2`, [like, limit]
      ));
    } else if (type === 'helper') {
      ({ rows } = await pool.query(
        `SELECT COALESCE(hp.profile_slug, hp.id::text) AS target_id,
                TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS name,
                NULL::int AS price_snapshot_cents
           FROM helper_profiles hp
           JOIN users u ON u.id = hp.user_id
          WHERE u.deleted_at IS NULL AND u.is_active = TRUE
            AND u.identity_verified = TRUE
            AND (hp.profile_slug ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1)
          ORDER BY name LIMIT $2`, [like, limit]
      ));
    } else if (type === 'business') {
      ({ rows } = await pool.query(
        `SELECT COALESCE(profile_slug, id::text) AS target_id, business_name AS name,
                NULL::int AS price_snapshot_cents
           FROM businesses
          WHERE deleted_at IS NULL AND is_active = TRUE AND is_business_verified = TRUE
            AND business_name ILIKE $1
          ORDER BY business_name LIMIT $2`, [like, limit]
      ));
    } else if (type === 'job') {
      ({ rows } = await pool.query(
        `SELECT id::text AS target_id, title AS name, NULL::int AS price_snapshot_cents
           FROM jobs
          WHERE deleted_at IS NULL AND status IN ('open', 'published') AND title ILIKE $1
          ORDER BY created_at DESC LIMIT $2`, [like, limit]
      ));
    } else {
      return res.status(400).json({ error: 'Unsupported Media entity type' });
    }
    res.json({ entities: rows.map((row) => ({ ...row, link_type: type, label: row.name })) });
  } catch (err) {
    logger.error('media.searchMediaEntities error', { message: err.message });
    res.status(500).json({ error: 'Failed to search Media entities' });
  }
}

module.exports = {
  getFeed, getPost, getDrafts, getDraft, getBookmarks, getReplies, getQuotes, createPost, publishPost, updatePost, deletePost,
  replacePostLinks,
  toggleLike, toggleBookmark, toggleRepost, recordView, flagPost,
  getCommunities, getCommunity, joinCommunity, leaveCommunity, searchMedia,
  getActor, getOrCreateActor, getBusinessPosts,
  searchMediaEntities,
};
