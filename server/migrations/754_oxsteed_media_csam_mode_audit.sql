-- Record which CSAM policy applied when an asset was processed or published.

ALTER TABLE media_post_assets
  ADD COLUMN IF NOT EXISTS csam_mode TEXT;

ALTER TABLE media_post_assets
  ADD COLUMN IF NOT EXISTS published_without_csam BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_media_post_assets_csam_mode
  ON media_post_assets (csam_mode)
  WHERE csam_mode IS NOT NULL;
