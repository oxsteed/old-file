-- Migration 665: device uploads for restaurant Media (photos + quarantined videos).
--
-- Extends restaurant_media (migration 664) with upload support:
--   media_type: 'video_link' (existing YouTube/Vimeo rows), 'photo_upload',
--     'video_upload'.
--   storage_key / thumbnail_key: object-store keys for uploaded bytes; served
--     only via re-signed URLs (same pattern as message attachments), never as
--     raw public URLs.
--   processing_status: 'ready' | 'quarantine' | 'processing' | 'failed'.
--     Uploaded videos ALWAYS start in 'quarantine' and are NEVER publicly
--     visible until every gate passes (CSAM check + transcode). Photos are
--     processed synchronously and land in 'ready'.
--   csam_status: 'not_required' (links/photos) | 'pending' | 'pass' | 'flagged'.
--   renditions: JSONB list of transcoded outputs for videos
--     [{storage_key, width, height, size_bytes}].
-- restaurant_media_processing_jobs: DB-backed queue for the video worker
--   (transcode + csam_check jobs). One active job per (media_id, job_type).

ALTER TABLE restaurant_media
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'video_link'
    CHECK (media_type IN ('video_link', 'photo_upload', 'video_upload')),
  ADD COLUMN IF NOT EXISTS storage_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'ready'
    CHECK (processing_status IN ('ready', 'quarantine', 'processing', 'failed')),
  ADD COLUMN IF NOT EXISTS processing_error TEXT NULL,
  ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS csam_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (csam_status IN ('not_required', 'pending', 'pass', 'flagged')),
  ADD COLUMN IF NOT EXISTS renditions JSONB NULL;

-- Uploaded rows have no external URL and no third-party provider.
ALTER TABLE restaurant_media ALTER COLUMN video_url DROP NOT NULL;
ALTER TABLE restaurant_media DROP CONSTRAINT IF EXISTS restaurant_media_provider_check;
ALTER TABLE restaurant_media
  ADD CONSTRAINT restaurant_media_provider_check
  CHECK (provider IN ('youtube', 'vimeo', 'upload'));

-- Uploaded rows must carry a storage key; link rows must carry a URL.
ALTER TABLE restaurant_media DROP CONSTRAINT IF EXISTS restaurant_media_upload_link_check;
ALTER TABLE restaurant_media
  ADD CONSTRAINT restaurant_media_upload_link_check CHECK (
    (media_type = 'video_link' AND video_url IS NOT NULL AND storage_key IS NULL)
    OR (media_type IN ('photo_upload', 'video_upload') AND storage_key IS NOT NULL)
  );

-- Quarantined/processing/failed uploads must never be publicly listed.
CREATE INDEX IF NOT EXISTS idx_restaurant_media_processing
  ON restaurant_media(restaurant_id, processing_status, created_at DESC)
  WHERE status = 'visible';

CREATE TABLE IF NOT EXISTS restaurant_media_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES restaurant_media(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('transcode', 'csam_check')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active job per (media, job type); history rows accumulate as done/failed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_media_jobs_active
  ON restaurant_media_processing_jobs (media_id, job_type)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_restaurant_media_jobs_queue
  ON restaurant_media_processing_jobs(status, created_at)
  WHERE status = 'queued';
