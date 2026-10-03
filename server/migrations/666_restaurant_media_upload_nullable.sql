-- Migration 666: restaurant_media.external_video_id becomes nullable.
--
-- Upload rows (photo_upload / video_upload, added in migration 665) have no
-- third-party provider or external video id; they were inserting '' as a
-- placeholder. Make the column nullable and normalize existing placeholders
-- to NULL so uploads are represented honestly.
ALTER TABLE restaurant_media ALTER COLUMN external_video_id DROP NOT NULL;
UPDATE restaurant_media
   SET external_video_id = NULL
 WHERE media_type IN ('photo_upload', 'video_upload')
   AND (external_video_id IS NULL OR external_video_id = '');
