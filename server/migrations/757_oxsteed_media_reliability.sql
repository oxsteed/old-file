-- OxSteed Media reliability and safety contracts.

ALTER TABLE media_posts
  ADD COLUMN IF NOT EXISTS moderation_state TEXT NOT NULL DEFAULT 'clear',
  ADD COLUMN IF NOT EXISTS moderation_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS moderation_updated_by UUID NULL,
  ADD COLUMN IF NOT EXISTS moderation_updated_at TIMESTAMPTZ NULL;

ALTER TABLE media_posts
  DROP CONSTRAINT IF EXISTS media_posts_moderation_state_check;
ALTER TABLE media_posts
  ADD CONSTRAINT media_posts_moderation_state_check
  CHECK (moderation_state IN ('clear','report_hold','admin_removed','dmca_removed','safety_blocked'));

UPDATE media_posts
   SET moderation_state = CASE
     WHEN csam_status = 'flagged' OR processing_status = 'blocked' THEN 'safety_blocked'
     WHEN visibility = 'removed' THEN 'admin_removed'
     ELSE 'clear'
   END,
       moderation_updated_at = COALESCE(moderation_updated_at, NOW())
 WHERE moderation_state = 'clear'
   AND (visibility = 'removed' OR csam_status = 'flagged' OR processing_status = 'blocked');

ALTER TABLE media_post_assets
  ADD COLUMN IF NOT EXISTS delivery_revoked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS delivery_revoke_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_media_posts_moderation_state
  ON media_posts (moderation_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_post_assets_delivery
  ON media_post_assets (delivery_revoked_at, post_id);

CREATE TABLE IF NOT EXISTS media_post_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  appellant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 2000),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','under_review','accepted','rejected')),
  reviewer_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_post_appeals_open
  ON media_post_appeals(post_id, appellant_user_id)
  WHERE status IN ('open','under_review');
CREATE INDEX IF NOT EXISTS idx_media_post_appeals_review
  ON media_post_appeals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS media_asset_cleanup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES media_post_assets(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  storage_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_asset_cleanup_unique
  ON media_asset_cleanup_jobs(asset_id, reason);
CREATE INDEX IF NOT EXISTS idx_media_asset_cleanup_queue
  ON media_asset_cleanup_jobs(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_media_reposts_actor_created
  ON media_reposts(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_reposts_post_created
  ON media_reposts(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_post_flags_post_status
  ON media_post_flags(post_id, status, created_at DESC);
