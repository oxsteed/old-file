-- Migration 178: Add cover image support to business profiles
-- Allows businesses to upload a background/cover image for their profile

ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(2048);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_businesses_cover_image_url
  ON businesses(cover_image_url)
  WHERE cover_image_url IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN businesses.cover_image_url IS 'S3 URL to the business profile cover/background image. Displayed at top of public profile. Max 1 per business.';
