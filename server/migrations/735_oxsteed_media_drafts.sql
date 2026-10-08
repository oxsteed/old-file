-- 735: Keep Media composition durable until its assets pass publication gates.

ALTER TABLE media_posts
  DROP CONSTRAINT IF EXISTS media_posts_processing_status_check;

ALTER TABLE media_posts
  ADD CONSTRAINT media_posts_processing_status_check
  CHECK (processing_status IN ('draft', 'ready', 'quarantine', 'failed', 'blocked'));

CREATE INDEX IF NOT EXISTS idx_media_posts_drafts
  ON media_posts(actor_id, created_at DESC)
  WHERE processing_status = 'draft' AND deleted_at IS NULL;
