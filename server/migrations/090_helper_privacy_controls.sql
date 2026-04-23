-- Add granular privacy controls to helper_profiles
-- Helpers can control: guest contact, booking, scheduling, and live chat

ALTER TABLE helper_profiles
ADD COLUMN IF NOT EXISTS allow_booking BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS allow_scheduling BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS allow_live_chat BOOLEAN NOT NULL DEFAULT TRUE;

-- Index on helper_profiles for faster filtering by privacy settings
CREATE INDEX IF NOT EXISTS idx_helper_profiles_privacy_settings
ON helper_profiles (user_id, allow_booking, allow_scheduling, allow_live_chat);
