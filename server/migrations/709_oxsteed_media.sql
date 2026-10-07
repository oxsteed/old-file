-- 709: OxSteed Media MVP schema
-- X-shaped local content branch: posts, replies, quotes, reposts, likes,
-- bookmarks, views, follows, communities, flags, and entity deep-links.

CREATE TABLE IF NOT EXISTS media_actors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','helper','business','restaurant')),
  owner_user_id UUID NOT NULL,
  business_id BIGINT NULL,
  restaurant_id BIGINT NULL,
  handle CITEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT NULL,
  verified_kind TEXT NOT NULL DEFAULT 'none'
    CHECK (verified_kind IN ('none','identity','business','restaurant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_actors_owner ON media_actors(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_media_actors_handle ON media_actors(handle);

CREATE TABLE IF NOT EXISTS media_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES media_actors(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) <= 2000),
  parent_id UUID NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  quoted_post_id UUID NULL REFERENCES media_posts(id) ON DELETE SET NULL,
  root_id UUID NULL,
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public','followers','unlisted','removed')),
  processing_status TEXT NOT NULL DEFAULT 'ready',
  csam_status TEXT NOT NULL DEFAULT 'passed',
  reply_count INT NOT NULL DEFAULT 0,
  repost_count INT NOT NULL DEFAULT 0,
  like_count INT NOT NULL DEFAULT 0,
  bookmark_count INT NOT NULL DEFAULT 0,
  view_count INT NOT NULL DEFAULT 0,
  quote_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_media_reply_not_repost CHECK (
    parent_id IS NULL OR quoted_post_id IS NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_media_posts_actor ON media_posts(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_posts_parent ON media_posts(parent_id, created_at DESC) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_posts_quoted ON media_posts(quoted_post_id) WHERE quoted_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_posts_feed ON media_posts(created_at DESC) WHERE visibility = 'public' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS media_post_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('image','video','video_link')),
  provider TEXT NOT NULL DEFAULT 'upload' CHECK (provider IN ('upload','youtube','vimeo')),
  storage_key TEXT NULL,
  thumbnail_key TEXT NULL,
  renditions JSONB NOT NULL DEFAULT '{}',
  external_url TEXT NULL,
  external_video_id TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  width INT NULL,
  height INT NULL,
  duration_ms INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_post_assets_post ON media_post_assets(post_id, sort_order);

CREATE TABLE IF NOT EXISTS media_post_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN (
    'restaurant','food_item','helper','business','job',
    'tool_rental','direct_catalog','logistics_campaign'
  )),
  target_id TEXT NOT NULL,
  label TEXT NULL,
  name_snapshot TEXT NOT NULL,
  price_snapshot_cents INT NULL CHECK (price_snapshot_cents IS NULL OR price_snapshot_cents >= 0),
  currency_code CHAR(3) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, link_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_media_post_links_post ON media_post_links(post_id, sort_order);

CREATE TABLE IF NOT EXISTS media_reposts (
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES media_actors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, actor_id)
);

CREATE TABLE IF NOT EXISTS media_likes (
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS media_bookmarks (
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS media_post_views (
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  viewer_user_id UUID NULL,
  viewer_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, viewer_hash)
);
CREATE INDEX IF NOT EXISTS idx_media_post_views_post ON media_post_views(post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media_follows (
  follower_user_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES media_actors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_user_id, actor_id)
);

CREATE TABLE IF NOT EXISTS media_communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug CITEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  geo_scope TEXT NULL,
  category TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_community_members (
  community_id UUID NOT NULL REFERENCES media_communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE IF NOT EXISTS media_post_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','removed','dmca')),
  decided_by UUID NULL,
  decided_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_post_flags_status ON media_post_flags(status, created_at DESC);

CREATE TABLE IF NOT EXISTS media_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  asset_id UUID NULL REFERENCES media_post_assets(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('transcode','csam_check')),
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
