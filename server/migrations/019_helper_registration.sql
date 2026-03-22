-- ================================================================
-- Migration 019: Helper Registration Flow
-- Adds: role to pending_registrations, profile_headline + intro_video
--       to helper_profiles, seeds 16 service categories,
--       updates plans for new tier pricing
-- OxSteed v2
-- ================================================================

BEGIN;

-- --- Add role to pending_registrations ---
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'customer';

-- --- Add helper profile fields ---
ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS profile_headline VARCHAR(80);
ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS intro_video_url TEXT;
ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS rate_preference VARCHAR(30) NOT NULL DEFAULT 'per_job';

-- --- Seed the 16 service categories ---
INSERT INTO categories (name, slug, icon, sort_order) VALUES
  ('Handyman',        'handyman',        'wrench',       1),
  ('Moving Help',     'moving-help',     'truck',        2),
  ('Yard Work',       'yard-work',       'leaf',         3),
  ('Cleaning',        'cleaning',        'sparkles',     4),
  ('Furniture Assembly', 'furniture-assembly', 'sofa',    5),
  ('Painting',        'painting',        'paintbrush',   6),
  ('Plumbing',        'plumbing',        'droplet',      7),
  ('Electrical',      'electrical',      'zap',          8),
  ('Appliance Repair','appliance-repair','settings',     9),
  ('Pressure Washing','pressure-washing','spray-can',   10),
  ('Junk Removal',    'junk-removal',    'trash-2',     11),
  ('Delivery',        'delivery',        'package',     12),
  ('Pet Care',        'pet-care',        'heart',       13),
  ('Tech Support',    'tech-support',    'monitor',     14),
  ('Auto Detailing',  'auto-detailing',  'car',         15),
  ('Other',           'other',           'more-horizontal', 16)
ON CONFLICT (slug) DO NOTHING;

-- --- Update plans for new helper tier pricing ---
UPDATE plans SET amount_cents = 1999, name = 'Basic Verified',
  description = 'Identity verified + background check, Verified badge, priority placement',
  features = '["Identity verified + background check","Verified badge on profile","Priority placement in search","Appears in Verified-Only filters"]'
  WHERE slug = 'pro';

UPDATE plans SET amount_cents = 3999, name = 'Pro Verified',
  description = 'Everything in Basic + featured placement, free payouts, analytics',
  features = '["Everything in Basic Verified","Featured profile placement","Free instant payouts","Monthly profile analytics","Priority dispute resolution"]'
  WHERE slug = 'broker';

-- --- Add helper-specific columns to pending_registrations ---
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS selected_tier VARCHAR(20) DEFAULT 'free';
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS profile_headline VARCHAR(80);
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS service_categories TEXT[];
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS availability_json JSONB DEFAULT '{}';
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS service_radius INTEGER DEFAULT 10;
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS rate_preference VARCHAR(30) DEFAULT 'per_job';
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(8,2);

COMMIT;

-- ================================================================
-- END OF MIGRATION 019
-- Run: psql $DATABASE_URL -f server/migrations/019_helper_registration.sql
-- ================================================================
