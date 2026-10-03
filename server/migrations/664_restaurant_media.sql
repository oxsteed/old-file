-- Migration 664: restaurant Media tab (TikTok-style video feed) — server tables.
--
-- restaurant_media: community YouTube/Vimeo links attached to a restaurant.
--   Link-only (no file uploads), mirroring the Learn guide-video precedent.
--   Only 'visible' rows are served publicly; deletes are soft (status='hidden')
--   and rows are kept for audit.
-- restaurant_media_items: dishes tagged on a video, with name/price snapshots
--   taken at post time so the feed degrades gracefully when a dish is
--   unpublished, repriced, or removed (link-rot: snapshot + available=false).
-- restaurant_media_likes: one like per user per video (PK pair).
-- restaurant_media_flags: community flags with one OPEN flag per user per
--   video (partial unique index, same rule as learn_guide_video_flags).
--   decided_by/decided_at record the admin review outcome, mirroring the
--   Learn flag review audit trail.

CREATE TABLE IF NOT EXISTS restaurant_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('youtube', 'vimeo')),
  external_video_id TEXT NOT NULL,
  caption TEXT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_media_restaurant
  ON restaurant_media(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_media_user
  ON restaurant_media(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_media_items (
  media_id UUID NOT NULL REFERENCES restaurant_media(id) ON DELETE CASCADE,
  menu_item_id BIGINT NOT NULL REFERENCES food_menu_items(id) ON DELETE CASCADE,
  item_name_snapshot TEXT NOT NULL,
  item_price_snapshot_cents INTEGER NULL
    CHECK (item_price_snapshot_cents IS NULL OR item_price_snapshot_cents >= 0),
  currency_code CHAR(3) NULL,
  PRIMARY KEY (media_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_media_items_menu_item
  ON restaurant_media_items(menu_item_id);

CREATE TABLE IF NOT EXISTS restaurant_media_likes (
  media_id UUID NOT NULL REFERENCES restaurant_media(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (media_id, user_id)
);

CREATE TABLE IF NOT EXISTS restaurant_media_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES restaurant_media(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL
    CHECK (reason IN ('unrelated', 'spam', 'broken', 'inappropriate')),
  note TEXT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  decided_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open flag per user per video.
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_media_flags_open
  ON restaurant_media_flags (media_id, user_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_restaurant_media_flags_status
  ON restaurant_media_flags(status, created_at DESC);
