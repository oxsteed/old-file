-- Migration 097: Ensure helper_profiles has all required pricing and availability columns
-- Fixes schema divergence where production DB may be missing columns referenced by getHelperPricing/getHelperSlots

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS hourly_rate_min DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS hourly_rate_max DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS rate_preference VARCHAR(20) DEFAULT 'per_job',
  ADD COLUMN IF NOT EXISTS flat_rate_available BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_for_pricing BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS availability_json JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_available_now BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS response_rate INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cover_photo_url VARCHAR(500);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_helper_profiles_availability
  ON helper_profiles (is_available_now)
  WHERE is_available_now = true;

CREATE INDEX IF NOT EXISTS idx_helper_profiles_rating_availability
  ON helper_profiles (avg_rating DESC, is_available_now);
