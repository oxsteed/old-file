-- Migration 177: Add cover image support to helper profiles
-- Allows helpers to upload a background/cover image for their profile

ALTER TABLE helper_profiles
ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(2048);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_helper_profiles_cover_image_url
  ON helper_profiles(cover_image_url)
  WHERE cover_image_url IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN helper_profiles.cover_image_url IS 'S3 URL to the helper profile cover/background image. Displayed at top of public profile. Max 1 per helper.';
