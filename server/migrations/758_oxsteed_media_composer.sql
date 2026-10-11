-- OxSteed Media composer reliability, accessibility, and locality metadata.

ALTER TABLE media_posts
  ADD COLUMN IF NOT EXISTS client_request_id UUID NULL,
  ADD COLUMN IF NOT EXISTS creation_request_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS location_city VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS location_region VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS destination VARCHAR(20) NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS content_warning VARCHAR(240) NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE media_posts SET updated_at = COALESCE(edited_at, created_at, NOW());

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_posts_destination') THEN
    ALTER TABLE media_posts ADD CONSTRAINT chk_media_posts_destination
      CHECK (destination IN ('main', 'nearby', 'space'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_posts_actor_client_request
  ON media_posts(actor_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_posts_draft_updated
  ON media_posts(actor_id, updated_at DESC, id DESC)
  WHERE visibility = 'unlisted' AND deleted_at IS NULL;

ALTER TABLE media_post_assets
  ADD COLUMN IF NOT EXISTS alt_text VARCHAR(1000) NULL,
  ADD COLUMN IF NOT EXISTS caption_storage_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS caption_language VARCHAR(35) NULL;

