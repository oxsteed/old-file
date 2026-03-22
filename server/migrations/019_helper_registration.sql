-- ==================================================================
-- Migration 019: Helper Registration Flow (with table creation)
-- Creates: helper_profiles, helper_skills, categories, plans
-- Adds: role to pending_registrations, profile fields, seeds categories
-- OxSteed v2
-- ==================================================================

BEGIN;

-- --- Add role to pending_registrations ---
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'customer';

-- --- Create helper_profiles if not exists ---
CREATE TABLE IF NOT EXISTS helper_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
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
  background_check_date TIMESTAMPTZ,
  is_id_verified BOOLEAN NOT NULL DEFAULT false,
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
  tier VARCHAR(20) NOT NULL DEFAULT 'free',
  profile_headline VARCHAR(80),
  intro_video_url TEXT,
  rate_preference VARCHAR(30) NOT NULL DEFAULT 'per_job',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add columns if table already existed without them
ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS profile_headline VARCHAR(80);
ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS intro_video_url TEXT;
ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS rate_preference VARCHAR(30) NOT NULL DEFAULT 'per_job';
ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'free';

-- --- Create helper_skills if not exists ---
CREATE TABLE IF NOT EXISTS helper_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_profile_id UUID NOT NULL REFERENCES helper_profiles(id) ON DELETE CASCADE,
  category_slug VARCHAR(100) NOT NULL,
  years_experience INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Create categories if not exists ---
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  icon VARCHAR(50),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Seed the 16 service categories ---
INSERT INTO categories (name, slug, icon, sort_order) VALUES
  ('Handyman',           'handyman',           'wrench',       1),
  ('Moving Help',        'moving-help',        'truck',        2),
  ('Yard Work',          'yard-work',          'leaf',         3),
  ('Cleaning',           'cleaning',           'sparkles',     4),
  ('Furniture Assembly', 'furniture-assembly',  'sofa',         5),
  ('Painting',           'painting',           'paint-roller', 6),
  ('Plumbing',           'plumbing',           'droplet',      7),
  ('Electrical',         'electrical',         'zap',          8),
  ('Appliance Repair',   'appliance-repair',   'settings',     9),
  ('Junk Removal',       'junk-removal',       'trash',       10),
  ('Pressure Washing',   'pressure-washing',   'droplets',    11),
  ('Landscaping',        'landscaping',        'tree',        12),
  ('Pet Care',           'pet-care',           'heart',       13),
  ('Personal Shopping',  'personal-shopping',  'shopping-bag',14),
  ('Tech Support',       'tech-support',       'monitor',     15),
  ('Other',              'other',              'more-horizontal',16)
ON CONFLICT (slug) DO NOTHING;

-- --- Create plans if not exists ---
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) NOT NULL UNIQUE,
  monthly_price DECIMAL(8,2) NOT NULL DEFAULT 0,
  annual_price DECIMAL(8,2),
  features JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed/update plans for helper tiers
INSERT INTO plans (name, slug, monthly_price, features) VALUES
  ('Free', 'free', 0, '["Create profile","Accept jobs","Basic support"]'),
  ('Basic Verified', 'basic', 19.99, '["Verified badge","Priority in search","Background check included","Email support"]'),
  ('Pro Verified', 'pro', 39.99, '["Pro badge","Top of search results","Background check included","Featured profile","Priority support","Analytics dashboard"]')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  monthly_price = EXCLUDED.monthly_price,
  features = EXCLUDED.features;

-- --- Add helper-specific columns to pending_registrations ---
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS selected_tier VARCHAR(20);
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS profile_headline VARCHAR(80);
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS service_categories TEXT[];
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS availability_json JSONB DEFAULT '{}';
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS service_radius INTEGER DEFAULT 10;
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS rate_preference VARCHAR(30) DEFAULT 'per_job';
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(8,2);

-- --- Create indexes ---
CREATE INDEX IF NOT EXISTS idx_helper_profiles_user ON helper_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_helper_profiles_tier ON helper_profiles(tier);
CREATE INDEX IF NOT EXISTS idx_helper_skills_profile ON helper_skills(helper_profile_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

COMMIT;
