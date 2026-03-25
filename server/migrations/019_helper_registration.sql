-- =====================================================================
-- Migration 019: Helper Registration Flow (Legacy DB Compatible)
-- Creates: helper_profiles, categories, helper_skills
-- Adds: role to pending_registrations, profile fields
-- Compatible with legacy VARCHAR users.id
-- OxSteed v2
-- =====================================================================

BEGIN;

-- --- Add role to pending_registrations ----
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'customer';

-- --- Add profile fields to pending_registrations ----
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS profile_headline VARCHAR(280),
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS service_categories TEXT[],
  ADD COLUMN IF NOT EXISTS availability_json JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS service_radius INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS rate_preference VARCHAR(20) DEFAULT 'per_job',
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS selected_tier VARCHAR(20) DEFAULT 'free';

-- --- Create categories if not exists ---
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES categories(id),
  icon VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default categories
INSERT INTO categories (name, slug, icon, sort_order) VALUES
  ('Home Cleaning', 'home-cleaning', 'spray-can', 1),
  ('Lawn & Garden', 'lawn-garden', 'leaf', 2),
  ('Moving & Hauling', 'moving-hauling', 'truck', 3),
  ('Handyman', 'handyman', 'wrench', 4),
  ('Painting', 'painting', 'paintbrush', 5),
  ('Plumbing', 'plumbing', 'droplet', 6),
  ('Electrical', 'electrical', 'zap', 7),
  ('Auto Repair', 'auto-repair', 'car', 8),
  ('Pet Care', 'pet-care', 'heart', 9),
  ('Tutoring', 'tutoring', 'book-open', 10),
  ('Personal Training', 'personal-training', 'dumbbell', 11),
  ('Tech Support', 'tech-support', 'monitor', 12),
  ('Photography', 'photography', 'camera', 13),
  ('Event Planning', 'event-planning', 'calendar', 14),
  ('Delivery & Errands', 'delivery-errands', 'package', 15),
  ('General Labor', 'general-labor', 'hard-hat', 16)
ON CONFLICT (slug) DO NOTHING;

-- --- Create helper_profiles (VARCHAR FK to users.id) ---
CREATE TABLE IF NOT EXISTS helper_profiles (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tier VARCHAR(20) NOT NULL DEFAULT 'free',
  profile_headline VARCHAR(280),
  bio_short VARCHAR(280),
  bio_long TEXT,
  profile_photo_url TEXT,
  service_city VARCHAR(100),
  service_state CHAR(2),
  service_zip VARCHAR(10),
  service_radius_miles INTEGER NOT NULL DEFAULT 10,
  service_lat DECIMAL(10,7),
  service_lng DECIMAL(10,7),
  hourly_rate_min DECIMAL(8,2),
  hourly_rate_max DECIMAL(8,2),
  flat_rate_available BOOLEAN NOT NULL DEFAULT false,
  contact_for_pricing BOOLEAN NOT NULL DEFAULT false,
  avg_rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  completed_jobs_count INTEGER NOT NULL DEFAULT 0,
  response_time_hours DECIMAL(5,2),
  is_background_checked BOOLEAN NOT NULL DEFAULT false,
  is_identity_verified BOOLEAN NOT NULL DEFAULT false,
  is_insured BOOLEAN NOT NULL DEFAULT false,
  is_licensed BOOLEAN NOT NULL DEFAULT false,
  insurance_details TEXT,
  license_details TEXT,
  availability_json JSONB NOT NULL DEFAULT '{}',
  is_available_now BOOLEAN NOT NULL DEFAULT false,
  stripe_account_id VARCHAR(255) UNIQUE,
  stripe_charges_enabled BOOLEAN NOT NULL DEFAULT false,
  stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  stripe_onboarded_at TIMESTAMPTZ,
  market_id INTEGER REFERENCES markets(id),
  profile_views INTEGER NOT NULL DEFAULT 0,
  search_rank_boost DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  rate_preference VARCHAR(20) DEFAULT 'per_job',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_helper_profiles_user ON helper_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_helper_profiles_tier ON helper_profiles(tier);
CREATE INDEX IF NOT EXISTS idx_helper_profiles_rating ON helper_profiles(avg_rating DESC);
CREATE INDEX IF NOT EXISTS idx_helper_profiles_market ON helper_profiles(market_id);

-- --- Create helper_skills (VARCHAR FK to users.id) ---
CREATE TABLE IF NOT EXISTS helper_skills (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  skill_name VARCHAR(100) NOT NULL,
  years_exp INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_helper_skills_user ON helper_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_helper_skills_category ON helper_skills(category_id);

COMMIT;
