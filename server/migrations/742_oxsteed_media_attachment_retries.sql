-- Server-computed content identity makes attachment retries durable. Historical
-- attachments remain nullable until replaced; no existing verdicts are changed.
ALTER TABLE media_post_assets ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_assets_content_identity
  ON media_post_assets (post_id, content_sha256)
  WHERE content_sha256 IS NOT NULL;
