-- Migration 753: allow public video without CSAM vendor via dedicated override switch.
--
-- Emile's directive: unblock public video now with MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM=true,
-- a switch he controls and can turn off once a CSAM vendor is certified.
--
-- Everything else stays in place:
-- - Didit is still required to upload video.
-- - Uploads still get the virus scan and stay in quarantine until processing is done.
-- - Rate limits, flags, auto-hide at 5 flags, takedowns, and the Cloudflare
--   match path all keep working.
--
-- Videos published under the override are marked:
-- - media_post_assets.csam_status = 'public_without_csam'
-- - media_post_assets.published_without_csam = TRUE
-- - An audit log entry records the override publication.

-- Add the new status to the check constraint.
ALTER TABLE media_post_assets
  DROP CONSTRAINT IF EXISTS media_post_assets_csam_status_check;

ALTER TABLE media_post_assets
  ADD CONSTRAINT media_post_assets_csam_status_check
  CHECK (csam_status IN (
    'not_required', 'pending', 'passed', 'flagged', 'unavailable',
    'cloudflare_deferred', 'public_without_csam'
  ));

-- Flag to mark videos published under the MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM override.
ALTER TABLE media_post_assets
  ADD COLUMN IF NOT EXISTS published_without_csam BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_media_post_assets_published_without_csam
  ON media_post_assets(published_without_csam)
  WHERE published_without_csam = TRUE;
