'use strict';

// OxSteed Media: X-shaped local content branch.
// MVP: verified helpers/businesses/restaurants post; photo uploads public,
// video uploads require Didit + block public until CSAM vendor certified.

const pool = require('../db');
const logger = require('../utils/logger');

const MAX_LINKS_PER_POST = 5;
const POSTS_PER_DAY = 10;

// Who can post at MVP: verified helpers, businesses, restaurants only.
async function getOrCreateActor(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM media_actors WHERE owner_user_id = $1 LIMIT 1`,
    [userId]
  );
  if (rows[0]) return rows[0];

  // Determine actor type from verified profiles.
  const { rows: helper } = await pool.query(
    `SELECT hp.id, hp.profile_slug, u.first_name, u.last_name, u.profile_photo_url,
            u.identity_verified
       FROM helper_profiles hp JOIN users u ON u.id = hp.user_id
      WHERE hp.user_id = $1 LIMIT 1`,
    [userId]
  );
  const { rows: biz } = await pool.query(
    `SELECT b.id, b.profile_slug, b.name, b.logo_url, b.is_business_verified
       FROM businesses b WHERE b.user_id = $1 AND b.deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  const { rows: rest } = await pool.query(
    `SELECT r.id, r.name, r.logo_url, r.is_verified
       FROM restaurants r WHERE r.owner_user_id = $1 LIMIT 1`,
    [userId]
  );

  let actor = null;
  if (helper[0]?.identity_verified) {
    actor = {
      type: 'helper', handle: helper[0].profile_slug,
      name: `${helper[0].first_name || ''} ${helper[0].last_name || ''}`.trim(),
      avatar: helper[0].profile_photo_url, verified: 'identity',
    };
  } else if (biz[0]?.is_business_verified) {
    actor = {
      type: 'business', handle: biz[0].profile_slug,
      name: biz[0].name, avatar: biz[0].logo_url, verified: 'business',
    };
  } else if (rest[0]?.is_verified) {
    actor = {
      type: 'restaurant', handle: `restaurant-${rest[0].id}`,
      name: rest[0].name, avatar: rest[0].logo_url, verified: 'restaurant',
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

const LINK_URL_BUILDERS = {
  restaurant: (id) => `/restaurants/r/${id}`,
  food_item: (id) => {
    // food_item target_id format: "restaurantId:menuItemId"
    const [restId, itemId] = String(id).split(':');
    return `/restaurants/r/${restId}?dish=${itemId}`;
  },
  helper: (id) => `/helpers/${id}`,
  business: (id) => `/b/${id}`,
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
  return rows.map(l => {
    const builder = LINK_URL_BUILDERS[l.link_type];
    const canonical_url = builder ? builder(l.target_id) : null;
    return {
      ...l,
      available: !!canonical_url,
      canonical_url,
      cta: LINK_CTAS[l.link_type] || 'View',
    };
  });
}

async function hydratePost(post, viewerUserId) {
  const links = await hydrateLinks(post.id);
  const { rows: assets } = await pool.query(
    `SELECT * FROM media_post_assets WHERE post_id = $1 ORDER BY sort_order`,
    [post.id]
  );
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
  }
  return { ...post, links, assets, liked, bookmarked, reposted };
}

async function getFeed(req, res) {
  try {
    const tab = req.query.tab || 'home';
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const before = req.query.before || null;
    const viewerUserId = req.user?.id || null;

    let orderBy = 'p.created_at DESC';
    const params = [limit];
    let where = `p.visibility = 'public' AND p.deleted_at IS NULL AND p.parent_id IS NULL`;

    if (before) {
      where += ` AND p.created_at < $2`;
      params.push(before);
    }

    // Deep-link boost: posts with valid local entity links rank higher.
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type,
              COUNT(l.id) AS link_count
         FROM media_posts p
         JOIN media_actors a ON a.id = p.actor_id
         LEFT JOIN media_post_links l ON l.post_id = p.id
        WHERE ${where}
        GROUP BY p.id, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
        ORDER BY COUNT(l.id) DESC, ${orderBy}
        LIMIT $1`,
      params
    );

    const posts = [];
    for (const row of rows) {
      posts.push(await hydratePost(row, viewerUserId));
    }
    res.json({ posts, next_before: rows.length ? rows[rows.length - 1].created_at : null });
  } catch (err) {
    logger.error('media.getFeed error', { message: err.message });
    res.status(500).json({ error: 'Failed to load feed' });
  }
}

async function getPost(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Post not found' });
    const post = await hydratePost(rows[0], req.user?.id || null);

    // Quote embed
    if (post.quoted_post_id) {
      const { rows: q } = await pool.query(
        `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind
           FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
          WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [post.quoted_post_id]
      );
      if (q[0]) post.quoted = await hydratePost(q[0], req.user?.id || null);
    }
    res.json({ post });
  } catch (err) {
    logger.error('media.getPost error', { message: err.message });
    res.status(500).json({ error: 'Failed to load post' });
  }
}

async function getReplies(req, res) {
  try {
    const sort = req.query.sort === 'relevant' ? 'relevant' : 'latest';
    let orderClause = 'p.created_at DESC';
    if (sort === 'relevant') {
      // Relevant: engagement-weighted (likes x3 + reposts x5 + replies x2),
      // with recency decay (newer posts get a boost).
      orderClause = `(p.like_count * 3 + p.repost_count * 5 + p.reply_count * 2 +
        GREATEST(0, 100 - EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600)) DESC`;
    }
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE p.parent_id = $1 AND p.deleted_at IS NULL AND p.visibility != 'removed'
        ORDER BY ${orderClause} LIMIT 50`,
      [req.params.id]
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
    const { rows } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE p.quoted_post_id = $1 AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC LIMIT 50`,
      [req.params.id]
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
    
    let actor;
    if (businessId) {
      // Verify user owns/manages this business.
      const { rows: biz } = await pool.query(
        `SELECT id, name, profile_slug, logo_url, is_business_verified
           FROM businesses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
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
          [userId, businessId, biz[0].profile_slug || `business-${businessId}`, biz[0].name, biz[0].logo_url]
        );
        actor = created[0];
      }
    } else {
      actor = await getOrCreateActor(userId);
    }
    if (!actor) {
      return res.status(403).json({
        error: 'Only verified helpers, businesses, and restaurants can post.',
        code: 'media_not_verified_poster',
      });
    }

    const { body, parent_id, quoted_post_id, links } = req.body;
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

    const { rows } = await pool.query(
      `INSERT INTO media_posts (actor_id, body, parent_id, quoted_post_id, root_id)
       VALUES ($1, $2, $3, $4,
         CASE WHEN $3 IS NOT NULL THEN (SELECT COALESCE(root_id, id) FROM media_posts WHERE id = $3) END)
       RETURNING *`,
      [actor.id, body.trim(), parent_id || null, quoted_post_id || null]
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
    }
    if (quoted_post_id) {
      await pool.query(
        `UPDATE media_posts SET quote_count = quote_count + 1 WHERE id = $1`,
        [quoted_post_id]
      );
    }

    res.status(201).json({ post: await hydratePost(post, userId) });
  } catch (err) {
    logger.error('media.createPost error', { message: err.message });
    res.status(500).json({ error: 'Failed to create post' });
  }
}

async function toggleLike(req, res) {
  try {
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
    res.json({ liked: true });
  } catch (err) {
    logger.error('media.toggleLike error', { message: err.message });
    res.status(500).json({ error: 'Failed to toggle like' });
  }
}

async function toggleBookmark(req, res) {
  try {
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
    const userId = req.user.id;
    const actor = await getOrCreateActor(userId);
    if (!actor) return res.status(403).json({ error: 'Only verified posters can repost' });
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
    const postId = req.params.id;
    const viewerUserId = req.user?.id || null;
    const hash = viewerUserId || req.ip + (req.headers['user-agent'] || '');
    const crypto = require('crypto');
    const viewerHash = crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 32);
    await pool.query(
      `INSERT INTO media_post_views (post_id, viewer_user_id, viewer_hash)
       VALUES ($1, $2, $3) ON CONFLICT (post_id, viewer_hash) DO NOTHING`,
      [postId, viewerUserId, viewerHash]
    );
    // Only increment if this was a new view (check via rowcount would need RETURNING).
    await pool.query(
      `UPDATE media_posts SET view_count = view_count + 1 WHERE id = $1
       AND NOT EXISTS (
         SELECT 1 FROM media_post_views
         WHERE post_id = $1 AND viewer_hash = $2 AND created_at < NOW() - INTERVAL '1 second'
       )`,
      [postId, viewerHash]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error('media.recordView error', { message: err.message });
    res.status(500).json({ error: 'Failed to record view' });
  }
}

async function flagPost(req, res) {
  try {
    const { reason, note } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason is required' });
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
    const { rows } = await pool.query(
      `SELECT * FROM media_communities ORDER BY title`
    );
    res.json({ communities: rows });
  } catch (err) {
    logger.error('media.getCommunities error', { message: err.message });
    res.status(500).json({ error: 'Failed to load communities' });
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
    const { rows: posts } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE p.actor_id = $1 AND p.deleted_at IS NULL AND p.parent_id IS NULL
        ORDER BY p.created_at DESC LIMIT 20`,
      [actors[0].id]
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
    const { rows } = await pool.query(
      `SELECT * FROM media_actors WHERE handle = $1`,
      [req.params.handle]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Actor not found' });
    const { rows: posts } = await pool.query(
      `SELECT p.*, a.handle, a.display_name, a.avatar_url, a.verified_kind, a.actor_type
         FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
        WHERE p.actor_id = $1 AND p.deleted_at IS NULL AND p.parent_id IS NULL
        ORDER BY p.created_at DESC LIMIT 20`,
      [rows[0].id]
    );
    const hydrated = [];
    for (const p of posts) hydrated.push(await hydratePost(p, req.user?.id || null));
    res.json({ actor: rows[0], posts: hydrated });
  } catch (err) {
    logger.error('media.getActor error', { message: err.message });
    res.status(500).json({ error: 'Failed to load actor' });
  }
}

module.exports = {
  getFeed, getPost, getReplies, getQuotes, createPost,
  toggleLike, toggleBookmark, toggleRepost, recordView, flagPost,
  getCommunities, getActor, getOrCreateActor, getBusinessPosts,
};
