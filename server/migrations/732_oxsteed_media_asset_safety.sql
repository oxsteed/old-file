-- 732: Track Media asset safety and processing state.
-- Uploaded videos stay quarantined until both safety and conversion gates pass.

ALTER TABLE media_post_assets
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'ready'
    CHECK (processing_status IN ('ready', 'quarantine', 'failed', 'blocked'));

ALTER TABLE media_post_assets
  ADD COLUMN IF NOT EXISTS csam_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (csam_status IN ('not_required', 'pending', 'passed', 'flagged', 'unavailable'));

CREATE INDEX IF NOT EXISTS idx_media_post_assets_safety
  ON media_post_assets(processing_status, csam_status);

CREATE INDEX IF NOT EXISTS idx_media_post_flags_reporter_day
  ON media_post_flags(user_id, created_at DESC);
