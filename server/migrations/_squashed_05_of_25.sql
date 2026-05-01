
-- >>> BEGIN: 034_trial_identity_businesses.sql <<<
-- Migration 034: 90-day Pro trial, identity deduplication, businesses
-- ================================================================

-- ─── A. Trial columns ───────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMPTZ;

ALTER TABLE users
  ALTER COLUMN trial_started_at SET DEFAULT NOW(),
  ALTER COLUMN trial_ends_at    SET DEFAULT (NOW() + INTERVAL '90 days');

CREATE INDEX IF NOT EXISTS idx_users_trial_ends_at
  ON users (trial_ends_at) WHERE trial_ends_at IS NOT NULL;


-- ─── B. Didit identity deduplication ────────────────────
-- didit_identity_hash: a unique fingerprint derived from the
-- Didit verification payload (face biometrics + document ID).
-- UNIQUE constraint ensures one person = one account.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS didit_identity_hash  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS didit_session_id     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS didit_verified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS didit_status         VARCHAR(30) DEFAULT 'pending';
  -- didit_status: 'pending' | 'verified' | 'failed' | 'duplicate'

-- The one-person-one-account constraint:
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_didit_identity_hash
  ON users (didit_identity_hash)
  WHERE didit_identity_hash IS NOT NULL;


-- ─── C. Businesses table ────────────────────────────────
-- One person (one account) can operate multiple LLCs / businesses.
-- Business context is selected per job, per bid, per payout.

CREATE TABLE IF NOT EXISTS businesses (
  id              SERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name   VARCHAR(255) NOT NULL,
  ein             VARCHAR(20),             -- encrypted at app layer
  business_type   VARCHAR(50),             -- 'llc', 'sole_prop', 'corp', 'partnership'
  address_street  VARCHAR(255),
  address_city    VARCHAR(100),
  address_state   VARCHAR(50),
  address_zip     VARCHAR(10),
  is_primary      BOOLEAN DEFAULT FALSE,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_businesses_user_id ON businesses(user_id);

-- Ensure only one primary business per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_one_primary
  ON businesses(user_id) WHERE is_primary = TRUE;


-- ─── D. Effective tier view ─────────────────────────────
CREATE OR REPLACE VIEW user_effective_tier AS
SELECT
  id, email, role, membership_tier, trial_ends_at,
  didit_status, didit_verified_at,
  CASE
    WHEN membership_tier = 'pro'                                THEN 'pro'
    WHEN trial_ends_at IS NOT NULL AND trial_ends_at > NOW()    THEN 'pro'
    ELSE COALESCE(membership_tier, 'free')
  END AS effective_tier,
  CASE
    WHEN trial_ends_at IS NOT NULL AND trial_ends_at > NOW()
      AND (membership_tier IS NULL OR membership_tier != 'pro')
    THEN TRUE ELSE FALSE
  END AS is_trial_active,
  CASE
    WHEN trial_ends_at IS NOT NULL AND trial_ends_at > NOW()
    THEN GREATEST(0, EXTRACT(DAY FROM (trial_ends_at - NOW()))::INT)
    ELSE 0
  END AS trial_days_left
FROM users;

-- >>> END: 034_trial_identity_businesses.sql <<<

-- >>> BEGIN: 035_fix_didit.sql <<<
-- Migration 035: Fix Didit integration
-- Adds didit_session_id to identity_verifications (missing column the webhook handler references)
-- Adds identity dedup columns to users for one-person-one-account

-- A. Add didit_session_id to identity_verifications
ALTER TABLE identity_verifications
  ADD COLUMN IF NOT EXISTS didit_session_id VARCHAR(255);

-- Allow 'approved' and 'declined' statuses that Didit sends
ALTER TABLE identity_verifications
  DROP CONSTRAINT IF EXISTS chk_iv_status;

ALTER TABLE identity_verifications
  ADD CONSTRAINT chk_iv_status
  CHECK (status IN ('requires_input', 'processing', 'verified', 'canceled', 'approved', 'declined'));

CREATE INDEX IF NOT EXISTS idx_iv_didit_session
  ON identity_verifications(didit_session_id)
  WHERE didit_session_id IS NOT NULL;

-- B. Add identity dedup columns to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS didit_identity_hash  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS didit_verified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS didit_status         VARCHAR(30) DEFAULT 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_didit_identity_hash
  ON users (didit_identity_hash)
  WHERE didit_identity_hash IS NOT NULL;

-- >>> END: 035_fix_didit.sql <<<

-- >>> BEGIN: 036_post_job_wizard.sql <<<
-- ================================================================
-- Migration 036: Post Job Wizard — schema extensions
-- Adds: job_drafts, jobs table extensions, trade categories,
--        job_matches table for synchronous match scoring
-- OxSteed v2
-- ================================================================

BEGIN;

-- ── 1. Extend jobs table ─────────────────────────────────────────
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS budget_type            VARCHAR(20)  DEFAULT 'open',
  -- 'fixed' | 'hourly' | 'open'
  ADD COLUMN IF NOT EXISTS urgency                VARCHAR(20)  DEFAULT 'flexible',
  -- 'asap' | 'this_week' | 'next_week' | 'flexible'
  ADD COLUMN IF NOT EXISTS site_access            VARCHAR(30)  DEFAULT 'easy',
  -- 'easy' | 'lockbox' | 'schedule'
  ADD COLUMN IF NOT EXISTS job_type_label         VARCHAR(30)  DEFAULT 'one_time',
  -- 'one_time' | 'recurring'
  ADD COLUMN IF NOT EXISTS notes                  TEXT,
  ADD COLUMN IF NOT EXISTS location_point         GEOGRAPHY(Point, 4326),
  ADD COLUMN IF NOT EXISTS location_approx_lat    NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS location_approx_lng    NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS market_id              INTEGER,
  ADD COLUMN IF NOT EXISTS address_revealed_to    UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS address_revealed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_helper_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS draft_saved_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at             TIMESTAMPTZ DEFAULT now() + interval '30 days',
  ADD COLUMN IF NOT EXISTS is_urgent              BOOLEAN      DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_total         NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS platform_fee           NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS protection_fee         NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS broker_fee             NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS helper_payout          NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS is_broker_mediated     BOOLEAN      DEFAULT false,
  ADD COLUMN IF NOT EXISTS bid_count              INTEGER      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_urls             TEXT[]       DEFAULT '{}';

-- Back-fill location_point for existing rows that have lat/lng
UPDATE jobs
   SET location_point = ST_SetSRID(
         ST_MakePoint(location_lng::float, location_lat::float), 4326
       )::geography
 WHERE location_lat IS NOT NULL
   AND location_lng IS NOT NULL
   AND location_point IS NULL;

-- GiST index for geo radius queries
CREATE INDEX IF NOT EXISTS idx_jobs_location_point
  ON jobs USING GIST (location_point);

CREATE INDEX IF NOT EXISTS idx_jobs_expires_at
  ON jobs (expires_at)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_jobs_urgency
  ON jobs (urgency, created_at DESC);

-- ── 2. job_drafts table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_drafts (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wizard_step  INTEGER      NOT NULL DEFAULT 1,
  payload      JSONB        NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (client_id)   -- one active draft per user
);

CREATE INDEX IF NOT EXISTS idx_job_drafts_client
  ON job_drafts (client_id);

-- ── 3. job_matches table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_matches (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID         NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  helper_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_score      NUMERIC(5,2) NOT NULL DEFAULT 0,
  score_breakdown  JSONB        DEFAULT '{}',
  notified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (job_id, helper_id)
);

CREATE INDEX IF NOT EXISTS idx_job_matches_job
  ON job_matches (job_id, match_score DESC);

CREATE INDEX IF NOT EXISTS idx_job_matches_helper
  ON job_matches (helper_id);

-- ── 4. Extend categories table ───────────────────────────────────
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS category_group    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS requires_license  BOOLEAN  DEFAULT false,
  ADD COLUMN IF NOT EXISTS suggested_reqs    JSONB    DEFAULT '[]';
  -- e.g. ["license","insurance","skill_level"]

-- ── 5. Seed trade & expanded categories ─────────────────────────
-- Electrical
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('Electrical — Full Rewire',      'electrical-full',      'zap',           100, 'Electrical',   true,  '["license","insurance","skill_level","background_check"]'),
  ('Electrical — Repair / Panel',   'electrical-repair',    'zap',           101, 'Electrical',   true,  '["license","insurance","skill_level"]'),
  ('Electrical — Installation',     'electrical-install',   'zap',           102, 'Electrical',   true,  '["license","insurance"]'),
  ('Electrical — EV Charger',       'electrical-ev',        'zap',           103, 'Electrical',   true,  '["license","insurance"]'),
  ('Electrical — Solar Panels',     'electrical-solar',     'zap',           104, 'Electrical',   true,  '["license","insurance","skill_level"]'),
  ('Electrical — Generator',        'electrical-generator', 'zap',           105, 'Electrical',   true,  '["license","insurance"]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- Plumbing
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('Plumbing — General',            'plumbing-general',     'droplet',       200, 'Plumbing',     true,  '["license","insurance"]'),
  ('Plumbing — Drain / Sewer',      'plumbing-drain',       'droplet',       201, 'Plumbing',     true,  '["license","insurance"]'),
  ('Plumbing — Water Heater',       'plumbing-water-heater','droplet',       202, 'Plumbing',     true,  '["license","insurance"]'),
  ('Plumbing — Fixture Install',    'plumbing-fixture',     'droplet',       203, 'Plumbing',     true,  '["license","insurance"]'),
  ('Plumbing — Bathroom Remodel',   'plumbing-remodel',     'droplet',       204, 'Plumbing',     true,  '["license","insurance","skill_level"]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- HVAC
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('HVAC — Full System Install',    'hvac-install',         'wind',          300, 'HVAC',         true,  '["license","insurance","own_tools"]'),
  ('HVAC — Repair / Service',       'hvac-repair',          'wind',          301, 'HVAC',         true,  '["license","insurance"]'),
  ('HVAC — Duct Work',              'hvac-duct',            'wind',          302, 'HVAC',         true,  '["license","insurance"]'),
  ('HVAC — Mini-Split Install',     'hvac-mini-split',      'wind',          303, 'HVAC',         true,  '["license","insurance"]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- Construction
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('Roofing',                       'roofing',              'home',          400, 'Construction', false, '["insurance","skill_level"]'),
  ('Roofing — Repair',              'roofing-repair',       'home',          401, 'Construction', false, '["insurance"]'),
  ('Drywall',                       'drywall',              'square',        402, 'Construction', false, '["skill_level"]'),
  ('Framing',                       'framing',              'columns',       403, 'Construction', false, '["skill_level","own_tools"]'),
  ('Concrete Work',                 'concrete',             'layers',        404, 'Construction', false, '["skill_level","own_tools"]'),
  ('Foundation / Excavation',       'foundation',           'layers',        405, 'Construction', false, '["license","insurance","skill_level"]'),
  ('Masonry / Brickwork',           'masonry',              'box',           406, 'Construction', false, '["skill_level"]'),
  ('Decking / Fencing',             'decking',              'grid',          407, 'Construction', false, '["skill_level","own_tools"]'),
  ('Siding / Exterior',             'siding',               'home',          408, 'Construction', false, '["skill_level"]'),
  ('Insulation',                    'insulation',           'layers',        409, 'Construction', false, '["own_tools"]'),
  ('Windows & Doors',               'windows-doors',        'maximize',      410, 'Construction', false, '["skill_level"]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- Interior Finishes
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('Painting — Interior',           'painting-interior',    'paintbrush',    500, 'Interior',     false, '[]'),
  ('Painting — Exterior',           'painting-exterior',    'paintbrush',    501, 'Interior',     false, '["insurance"]'),
  ('Flooring — Hardwood',           'flooring-hardwood',    'layout',        502, 'Interior',     false, '["skill_level","own_tools"]'),
  ('Flooring — Tile',               'flooring-tile',        'layout',        503, 'Interior',     false, '["skill_level","own_tools"]'),
  ('Flooring — Carpet',             'flooring-carpet',      'layout',        504, 'Interior',     false, '["skill_level"]'),
  ('Carpentry — Trim / Molding',    'carpentry-trim',       'tool',          505, 'Interior',     false, '["skill_level","own_tools"]'),
  ('Carpentry — Cabinets',          'carpentry-cabinets',   'tool',          506, 'Interior',     false, '["skill_level","own_tools"]'),
  ('Carpentry — Custom',            'carpentry-custom',     'tool',          507, 'Interior',     false, '["skill_level","own_tools"]'),
  ('Tile — Backsplash',             'tile-backsplash',      'layout',        508, 'Interior',     false, '["skill_level"]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- Home Services (update existing + add new)
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('Home Cleaning',                 'home-cleaning',        'spray-can',     600, 'Home Services',false, '["background_check"]'),
  ('Deep Cleaning / Move Out',      'deep-cleaning',        'spray-can',     601, 'Home Services',false, '["background_check"]'),
  ('Handyman',                      'handyman',             'wrench',        602, 'Home Services',false, '["skill_level"]'),
  ('Appliance Installation',        'appliance-install',    'cpu',           603, 'Home Services',false, '["skill_level"]'),
  ('Appliance Repair',              'appliance-repair',     'cpu',           604, 'Home Services',false, '["skill_level"]'),
  ('Smart Home / AV Setup',         'smart-home',           'monitor',       605, 'Home Services',false, '["skill_level"]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- Lawn & Outdoor
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('Lawn Mowing',                   'lawn-mowing',          'scissors',      700, 'Outdoor',      false, '[]'),
  ('Landscaping / Garden',          'lawn-garden',          'leaf',          701, 'Outdoor',      false, '[]'),
  ('Tree Service / Trimming',       'tree-service',         'tree',          702, 'Outdoor',      false, '["insurance"]'),
  ('Snow Removal',                  'snow-removal',         'cloud-snow',    703, 'Outdoor',      false, '[]'),
  ('Irrigation / Sprinkler',        'irrigation',           'droplet',       704, 'Outdoor',      false, '["license"]'),
  ('Outdoor Lighting',              'outdoor-lighting',     'zap',           705, 'Outdoor',      false, '["license"]'),
  ('Pool Service / Repair',         'pool-service',         'droplet',       706, 'Outdoor',      false, '["license","insurance"]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- Moving & Hauling
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('Moving — Local',                'moving-local',         'truck',         800, 'Moving',       false, '["crew_size"]'),
  ('Moving — Long Distance',        'moving-long',          'truck',         801, 'Moving',       false, '["license","insurance","crew_size"]'),
  ('Junk Removal / Hauling',        'junk-removal',         'trash-2',       802, 'Moving',       false, '[]'),
  ('Furniture Assembly',            'furniture-assembly',   'package',       803, 'Moving',       false, '[]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- Vehicles & Auto
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('Auto Repair',                   'auto-repair',          'car',           900, 'Auto',         false, '["skill_level"]'),
  ('Auto Detailing',                'auto-detailing',       'car',           901, 'Auto',         false, '[]'),
  ('Auto Body / Paint',             'auto-body',            'car',           902, 'Auto',         false, '["skill_level","own_tools"]'),
  ('Tire Change / Rotation',        'tire-change',          'circle',        903, 'Auto',         false, '[]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- Care & Personal
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('Pet Care / Sitting',            'pet-care',             'heart',        1000, 'Care',         false, '["background_check"]'),
  ('Dog Walking',                   'dog-walking',          'heart',        1001, 'Care',         false, '["background_check"]'),
  ('Childcare / Babysitting',       'childcare',            'user',         1002, 'Care',         false, '["background_check"]'),
  ('Senior Care / Errands',         'senior-care',          'user',         1003, 'Care',         false, '["background_check"]'),
  ('Personal Training',             'personal-training',    'dumbbell',     1004, 'Care',         false, '["skill_level"]'),
  ('Tutoring / Teaching',           'tutoring',             'book-open',    1005, 'Care',         false, '[]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- Professional Services
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('Tech Support / IT',             'tech-support',         'monitor',      1100, 'Professional', false, '["skill_level"]'),
  ('Photography / Videography',     'photography',          'camera',       1101, 'Professional', false, '["skill_level"]'),
  ('Event Setup / Planning',        'event-planning',       'calendar',     1102, 'Professional', false, '[]'),
  ('Delivery & Errands',            'delivery-errands',     'package',      1103, 'Professional', false, '[]'),
  ('Security / Patrol',             'security',             'shield',       1104, 'Professional', false, '["license","background_check"]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

-- General (update existing)
INSERT INTO categories (name, slug, icon, sort_order, category_group, requires_license, suggested_reqs) VALUES
  ('General Labor',                 'general-labor',        'hard-hat',     1200, 'General',      false, '[]'),
  ('Other / Specify in Description','other',                'more-horizontal',1201,'General',     false, '[]')
ON CONFLICT (slug) DO UPDATE SET
  category_group   = EXCLUDED.category_group,
  requires_license = EXCLUDED.requires_license,
  suggested_reqs   = EXCLUDED.suggested_reqs;

COMMIT;

-- >>> END: 036_post_job_wizard.sql <<<

-- >>> BEGIN: 037_skills_and_licenses_lookup.sql <<<
-- Migration 037: Skills and Licenses Lookup Tables
-- 250 searchable skills + 250 searchable licenses for helper profiles
-- OxSteed v2

CREATE TABLE IF NOT EXISTS skills_lookup (
  id       SERIAL PRIMARY KEY,
  name     VARCHAR(150) NOT NULL UNIQUE,
  category VARCHAR(100),
  is_active BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_skills_lookup_search ON skills_lookup USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_skills_lookup_category ON skills_lookup(category);

CREATE TABLE IF NOT EXISTS licenses_lookup (
  id       SERIAL PRIMARY KEY,
  name     VARCHAR(200) NOT NULL UNIQUE,
  category VARCHAR(100),
  is_active BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_licenses_lookup_search ON licenses_lookup USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_licenses_lookup_category ON licenses_lookup(category);

-- ─── 250 Skills ──────────────────────────────────────────────────────────────

INSERT INTO skills_lookup (name, category) VALUES
-- Home Repair & Handyman (20)
('Drywall Repair','Home Repair'),('Drywall Installation','Home Repair'),
('Door Installation','Home Repair'),('Window Installation','Home Repair'),
('Lock Installation','Home Repair'),('Ceiling Fan Installation','Home Repair'),
('Appliance Installation','Home Repair'),('Fixture Installation','Home Repair'),
('Shelf Installation','Home Repair'),('Furniture Assembly','Home Repair'),
('TV Mounting','Home Repair'),('Smoke Detector Installation','Home Repair'),
('Security Camera Installation','Home Repair'),('Attic Insulation','Home Repair'),
('Bathroom Remodel','Home Repair'),('Kitchen Remodel','Home Repair'),
('Deck Building','Home Repair'),('Fence Installation','Home Repair'),
('Tile Installation','Home Repair'),('Cabinet Installation','Home Repair'),
-- Landscaping & Outdoor (18)
('Lawn Mowing','Landscaping'),('Lawn Edging','Landscaping'),
('Lawn Aeration','Landscaping'),('Mulching','Landscaping'),
('Leaf Removal','Landscaping'),('Tree Trimming','Landscaping'),
('Tree Removal','Landscaping'),('Stump Grinding','Landscaping'),
('Shrub Trimming','Landscaping'),('Garden Bed Design','Landscaping'),
('Sod Installation','Landscaping'),('Irrigation System Installation','Landscaping'),
('Sprinkler Repair','Landscaping'),('Retaining Wall Installation','Landscaping'),
('Landscape Design','Landscaping'),('Landscape Lighting Installation','Landscaping'),
('Snow Plowing','Landscaping'),('Pressure Washing Driveway','Landscaping'),
-- Cleaning (15)
('Standard House Cleaning','Cleaning'),('Deep Cleaning','Cleaning'),
('Move-In Cleaning','Cleaning'),('Move-Out Cleaning','Cleaning'),
('Post-Construction Cleaning','Cleaning'),('Carpet Cleaning','Cleaning'),
('Window Cleaning','Cleaning'),('Oven Cleaning','Cleaning'),
('Pressure Washing','Cleaning'),('Air Duct Cleaning','Cleaning'),
('Dryer Vent Cleaning','Cleaning'),('Mold Remediation','Cleaning'),
('Vacation Rental Cleaning','Cleaning'),('Odor Removal','Cleaning'),
('Disinfection Services','Cleaning'),
-- Electrical (15)
('Panel Upgrade','Electrical'),('Circuit Breaker Replacement','Electrical'),
('GFCI Outlet Installation','Electrical'),('Outlet Installation','Electrical'),
('Dimmer Switch Installation','Electrical'),('Light Fixture Installation','Electrical'),
('Recessed Lighting Installation','Electrical'),('Ceiling Fan Wiring','Electrical'),
('EV Charger Installation','Electrical'),('Generator Installation','Electrical'),
('Smoke Detector Wiring','Electrical'),('Rewiring (Partial)','Electrical'),
('Rewiring (Full House)','Electrical'),('Electrical Troubleshooting','Electrical'),
('Outdoor Outlet Installation','Electrical'),
-- Plumbing (15)
('Faucet Installation','Plumbing'),('Faucet Repair','Plumbing'),
('Toilet Installation','Plumbing'),('Toilet Repair','Plumbing'),
('Water Heater Installation','Plumbing'),('Drain Cleaning','Plumbing'),
('Sewer Line Repair','Plumbing'),('Pipe Leak Repair','Plumbing'),
('Water Softener Installation','Plumbing'),('Garbage Disposal Installation','Plumbing'),
('Sump Pump Installation','Plumbing'),('Gas Line Installation','Plumbing'),
('Shower Installation','Plumbing'),('Repiping (Full House)','Plumbing'),
('Water Filter Installation','Plumbing'),
-- HVAC & Mechanical (14)
('AC Installation','HVAC'),('AC Repair','HVAC'),
('AC Tune-Up','HVAC'),('Furnace Installation','HVAC'),
('Furnace Repair','HVAC'),('Heat Pump Installation','HVAC'),
('Mini-Split Installation','HVAC'),('Thermostat Installation','HVAC'),
('Smart Thermostat Installation','HVAC'),('Ductwork Installation','HVAC'),
('Duct Cleaning','HVAC'),('HVAC Dryer Vent Cleaning','HVAC'),
('Air Filter Replacement','HVAC'),('Whole-Home Humidifier Installation','HVAC'),
-- Carpentry & Woodworking (17)
('Custom Cabinet Building','Carpentry'),('Built-In Shelving','Carpentry'),
('Crown Molding Installation','Carpentry'),('Baseboard Installation','Carpentry'),
('Wainscoting Installation','Carpentry'),('Barn Door Installation','Carpentry'),
('Stair Building','Carpentry'),('Custom Deck Construction','Carpentry'),
('Pergola Building','Carpentry'),('Fence Building','Carpentry'),
('Furniture Repair','Carpentry'),('Wood Rot Repair','Carpentry'),
('Load-Bearing Wall Framing','Carpentry'),('Window Seat Building','Carpentry'),
('Closet System Installation','Carpentry'),('Wood Flooring Installation','Carpentry'),
('Subfloor Installation','Carpentry'),
-- Painting & Finishing (14)
('Interior Wall Painting','Painting'),('Exterior House Painting','Painting'),
('Ceiling Painting','Painting'),('Trim Painting','Painting'),
('Cabinet Painting','Painting'),('Deck Staining','Painting'),
('Fence Staining','Painting'),('Epoxy Floor Coating','Painting'),
('Wallpaper Hanging','Painting'),('Wallpaper Removal','Painting'),
('Popcorn Ceiling Removal','Painting'),('Spray Painting Exterior','Painting'),
('Surface Preparation','Painting'),('Paint Stripping','Painting'),
-- Roofing & Gutters (10)
('Roof Inspection','Roofing'),('Shingle Replacement Partial','Roofing'),
('Shingle Replacement Full','Roofing'),('Metal Roof Installation','Roofing'),
('Flat Roof Repair','Roofing'),('Chimney Flashing Repair','Roofing'),
('Ice Dam Removal','Roofing'),('Gutter Installation','Roofing'),
('Gutter Cleaning','Roofing'),('Gutter Guard Installation','Roofing'),
-- Flooring (13)
('Hardwood Floor Installation','Flooring'),('Hardwood Floor Refinishing','Flooring'),
('Laminate Flooring Installation','Flooring'),('Vinyl Plank Installation','Flooring'),
('Tile Flooring Installation','Flooring'),('Carpet Installation','Flooring'),
('Carpet Stretching','Flooring'),('Epoxy Floor Installation','Flooring'),
('Subfloor Leveling','Flooring'),('Grout Sealing','Flooring'),
('Radiant Heat Flooring Installation','Flooring'),('Hardwood Floor Sanding','Flooring'),
('Luxury Vinyl Tile Installation','Flooring'),
-- Moving & Hauling (10)
('Local Moving','Moving'),('Long Distance Moving','Moving'),
('Loading and Unloading','Moving'),('Furniture Disassembly and Reassembly','Moving'),
('Piano Moving','Moving'),('Junk Removal','Moving'),
('Packing Services','Moving'),('Appliance Removal','Moving'),
('Estate Cleanout','Moving'),('Storage Unit Moving','Moving'),
-- Auto & Vehicle (13)
('Oil Change','Auto'),('Tire Rotation','Auto'),
('Brake Pad Replacement','Auto'),('Battery Replacement','Auto'),
('Full Car Detailing','Auto'),('Interior Detailing','Auto'),
('Windshield Chip Repair','Auto'),('Paintless Dent Removal','Auto'),
('OBD Diagnostic Scan','Auto'),('Mobile Mechanic Service','Auto'),
('Pre-Purchase Vehicle Inspection','Auto'),('Tire Installation','Auto'),
('Ceramic Coating Application','Auto'),
-- Pest Control (8)
('General Pest Inspection','Pest Control'),('Termite Treatment','Pest Control'),
('Bed Bug Treatment','Pest Control'),('Rodent Extermination','Pest Control'),
('Mosquito Control','Pest Control'),('Wasp Nest Removal','Pest Control'),
('Wildlife Removal','Pest Control'),('Fumigation Services','Pest Control'),
-- Tech Support & Smart Home (15)
('Computer Setup and Configuration','Tech Support'),('Virus and Malware Removal','Tech Support'),
('Data Recovery','Tech Support'),('WiFi Router Setup','Tech Support'),
('Smart TV Setup','Tech Support'),('Smart Thermostat Setup and Programming','Tech Support'),
('Smart Doorbell Installation','Tech Support'),('Smart Lock Setup','Tech Support'),
('Home Security Camera Setup','Tech Support'),('Home Theater Setup','Tech Support'),
('TV Wall Mount Installation','Tech Support'),('Network Setup','Tech Support'),
('Smart Home Consultation','Tech Support'),('Laptop Repair','Tech Support'),
('Smart Speaker Setup','Tech Support'),
-- Personal Services & Wellness (20)
('Personal Training','Personal Services'),('Yoga Instruction','Personal Services'),
('Nutrition Consultation','Personal Services'),('Meal Prep Services','Personal Services'),
('Grocery Shopping','Personal Services'),('Errand Running','Personal Services'),
('House Sitting','Personal Services'),('Home Organization','Personal Services'),
('Senior Care Assistance','Personal Services'),('Elementary Tutoring','Personal Services'),
('High School Tutoring','Personal Services'),('Guitar Lessons','Personal Services'),
('Piano Lessons','Personal Services'),('Language Lessons','Personal Services'),
('Life Coaching','Personal Services'),('Resume Writing','Personal Services'),
('Notary Services','Personal Services'),('Personal Chef Services','Personal Services'),
('Personal Tax Preparation','Personal Services'),('Bookkeeping','Personal Services'),
-- Pet Care (10)
('Dog Walking','Pet Care'),('Cat Sitting','Pet Care'),
('Dog Sitting','Pet Care'),('Pet Grooming','Pet Care'),
('Dog Nail Trimming','Pet Care'),('Dog Training Basic Obedience','Pet Care'),
('Pet Transportation','Pet Care'),('Aquarium Maintenance','Pet Care'),
('Pet Waste Removal','Pet Care'),('Overnight Pet Sitting','Pet Care'),
-- Photography & Media (12)
('Portrait Photography','Photography'),('Wedding Photography','Photography'),
('Real Estate Photography','Photography'),('Product Photography','Photography'),
('Video Production','Photography'),('Drone Aerial Photography','Photography'),
('Photo Editing','Photography'),('Video Editing','Photography'),
('Social Media Content Creation','Photography'),('Headshot Photography','Photography'),
('Event Photography','Photography'),('Photo Restoration','Photography'),
-- Event Planning & Entertainment (11)
('Wedding Coordination','Events'),('Event Decor Setup','Events'),
('DJ Services','Events'),('Party Planning','Events'),
('Corporate Event Planning','Events'),('Catering Assistance','Events'),
('Bartending','Events'),('Face Painting','Events'),
('Event Setup Labor','Events'),('Event Cleanup','Events'),
('Kids Party Planning','Events')
ON CONFLICT (name) DO NOTHING;

-- ─── 250 Licenses ────────────────────────────────────────────────────────────

INSERT INTO licenses_lookup (name, category) VALUES
-- Electrical (20)
('Master Electrician License','Electrical'),('Journeyman Electrician License','Electrical'),
('Residential Electrician License','Electrical'),('Commercial Electrician License','Electrical'),
('Low-Voltage Technician License','Electrical'),('Electrical Contractor License','Electrical'),
('Solar PV Installer Certification (NABCEP)','Electrical'),
('EV Infrastructure Training Program (EVITP)','Electrical'),
('OSHA 10 Electrical','Electrical'),('NFPA 70E Electrical Safety Certification','Electrical'),
('Electrician Apprentice License','Electrical'),('Fire Alarm Electrician License','Electrical'),
('Sign Electrician License','Electrical'),('Communications Electrician License','Electrical'),
('Generator Technician Certification','Electrical'),
('Battery Storage Installer Certification','Electrical'),
('Licensed Electrical Inspector','Electrical'),('Low-Voltage Contractor License','Electrical'),
('Industrial Electrician License','Electrical'),
('Hazardous Location Wiring Certification','Electrical'),
-- Plumbing (20)
('Master Plumber License','Plumbing'),('Journeyman Plumber License','Plumbing'),
('Plumbing Contractor License','Plumbing'),('Residential Plumber License','Plumbing'),
('Commercial Plumber License','Plumbing'),
('Backflow Prevention Assembly Tester Certification','Plumbing'),
('Gas Piping License','Plumbing'),('Medical Gas Installer (ASSE 6010)','Plumbing'),
('Fire Sprinkler Contractor License','Plumbing'),('Irrigation Contractor License','Plumbing'),
('Certified Irrigation Technician (CIT)','Plumbing'),('Well Driller License','Plumbing'),
('Septic System Installer License','Plumbing'),('Plumbing Inspector License','Plumbing'),
('Drain Cleaner License','Plumbing'),('Water Treatment Specialist Certification','Plumbing'),
('Plumber Apprentice License','Plumbing'),('Sewer Pipe Layer License','Plumbing'),
('Water Distribution Operator License','Plumbing'),
('Wastewater Treatment Operator License','Plumbing'),
-- HVAC (15)
('EPA 608 Universal Certification','HVAC'),('NATE Core Certification','HVAC'),
('NATE Air Conditioning Service Certification','HVAC'),
('NATE Heat Pump Service Certification','HVAC'),
('NATE Gas Furnace Service Certification','HVAC'),
('HVAC Excellence Master Technician','HVAC'),('BPI Building Analyst Professional','HVAC'),
('Mechanical Contractor License','HVAC'),('HVAC Contractor License','HVAC'),
('Refrigeration Technician License','HVAC'),('Boiler Operator License','HVAC'),
('Stationary Engineer License','HVAC'),('Certified Energy Auditor (CEA)','HVAC'),
('IGSHPA Accredited Installer','HVAC'),('OSHA 10 HVAC','HVAC'),
-- Contractor & Construction (20)
('General Contractor License','Contractor'),('Residential Builder License','Contractor'),
('Home Improvement Contractor License','Contractor'),
('Roofing Contractor License','Contractor'),('Flooring Contractor License','Contractor'),
('Masonry Contractor License','Contractor'),('Concrete Contractor License','Contractor'),
('Drywall Contractor License','Contractor'),('Swimming Pool Contractor License','Contractor'),
('Demolition Contractor License','Contractor'),
('Asbestos Removal Contractor License','Contractor'),
('Lead Paint Abatement Contractor License','Contractor'),
('OSHA 10 Construction','Contractor'),('OSHA 30 Construction','Contractor'),
('ICC Residential Building Inspector Certification','Contractor'),
('LEED AP BD+C Certification','Contractor'),('Scaffold Contractor License','Contractor'),
('Waterproofing Contractor License','Contractor'),
('Insulation Contractor License','Contractor'),
('Window and Door Contractor License','Contractor'),
-- Auto & Vehicle (13)
('ASE Master Technician Certification','Auto'),('ASE Engine Repair A1','Auto'),
('ASE Brakes A5','Auto'),('ASE Electrical Systems A6','Auto'),
('ASE Heating and Air Conditioning A7','Auto'),('ASE Engine Performance A8','Auto'),
('ASE Collision Repair Certification','Auto'),('ICAR Gold Class Certification','Auto'),
('State Vehicle Safety Inspection License','Auto'),('Motor Vehicle Dealer License','Auto'),
('Automotive Glass Technician (AGRSS)','Auto'),
('Electric Vehicle Technician Certification','Auto'),
('Forklift Operator Safety Certification','Auto'),
-- Healthcare & Wellness (28)
('CPR/AED Certification (AHA)','Healthcare'),('First Aid Certification','Healthcare'),
('BLS Provider (AHA)','Healthcare'),('Emergency Medical Technician (EMT-B)','Healthcare'),
('Registered Nurse (RN)','Healthcare'),('Licensed Practical Nurse (LPN)','Healthcare'),
('Certified Nursing Assistant (CNA)','Healthcare'),('Home Health Aide (HHA)','Healthcare'),
('Certified Medical Assistant (CMA)','Healthcare'),
('Phlebotomy Technician Certification','Healthcare'),
('Physical Therapist License (PT)','Healthcare'),
('Occupational Therapist License (OTR/L)','Healthcare'),
('Speech Language Pathologist License','Healthcare'),('Registered Dietitian (RD)','Healthcare'),
('Certified Personal Trainer (NASM)','Healthcare'),('Certified Personal Trainer (ACE)','Healthcare'),
('200-Hour RYT Yoga Instructor','Healthcare'),('Licensed Massage Therapist (LMT)','Healthcare'),
('Acupuncture License (L.Ac.)','Healthcare'),('Chiropractic Doctor License (DC)','Healthcare'),
('Board Certified Behavior Analyst (BCBA)','Healthcare'),
('Mental Health First Aid Certification','Healthcare'),
('Substance Abuse Counselor Certification','Healthcare'),
('Certified Case Manager (CCM)','Healthcare'),
('International Board Certified Lactation Consultant (IBCLC)','Healthcare'),
('DONA Doula Certification','Healthcare'),
('Certified Therapeutic Recreation Specialist (CTRS)','Healthcare'),
('Bloodborne Pathogen Certification','Healthcare'),
-- Food & Hospitality (13)
('ServSafe Food Handler Certification','Food & Hospitality'),
('ServSafe Food Protection Manager Certification','Food & Hospitality'),
('ServSafe Alcohol Certification','Food & Hospitality'),
('ANSI Food Manager Certification','Food & Hospitality'),
('Responsible Beverage Service Certificate','Food & Hospitality'),
('Bartender License','Food & Hospitality'),
('SCA Barista Certification','Food & Hospitality'),
('WSET Level 2 Award in Wine','Food & Hospitality'),
('Certified Culinary Professional (CCP)','Food & Hospitality'),
('HACCP Certification','Food & Hospitality'),('Food Truck Business License','Food & Hospitality'),
('Cottage Food Producer License','Food & Hospitality'),
('Allergen Awareness Certificate','Food & Hospitality'),
-- Real Estate & Property (13)
('Real Estate Salesperson License','Real Estate'),('Real Estate Broker License','Real Estate'),
('Certified Residential Specialist (CRS)','Real Estate'),
('Certified Property Manager (CPM)','Real Estate'),
('Home Inspector License','Real Estate'),('Certified Home Inspector (NAHI)','Real Estate'),
('HUD Certified Housing Counselor','Real Estate'),
('Certified Residential Appraiser','Real Estate'),('Home Stager Certification','Real Estate'),
('Mortgage Loan Originator License (MLO)','Real Estate'),
('Lead Paint Inspector License','Real Estate'),('Radon Measurement Technician','Real Estate'),
('HERS Energy Rater Certification','Real Estate'),
-- Financial & Legal (13)
('Certified Public Accountant (CPA)','Financial & Legal'),
('IRS Enrolled Agent (EA)','Financial & Legal'),
('Certified Financial Planner (CFP)','Financial & Legal'),
('FINRA Series 7 License','Financial & Legal'),
('FINRA Series 65 License','Financial & Legal'),
('Certified Bookkeeper (CB)','Financial & Legal'),
('QuickBooks ProAdvisor Certification','Financial & Legal'),
('Certified Payroll Professional (CPP)','Financial & Legal'),
('Notary Public Commission','Financial & Legal'),
('NALA Certified Paralegal','Financial & Legal'),
('Certified Mediator','Financial & Legal'),
('Certified Fraud Examiner (CFE)','Financial & Legal'),
('FINRA Series 63 License','Financial & Legal'),
-- Education & Childcare (15)
('Child Development Associate (CDA)','Education'),
('Montessori Primary Certification','Education'),('Elementary Teaching License','Education'),
('Special Education Teaching License','Education'),
('ESL/ELL Teaching Certification','Education'),('TESOL Certificate','Education'),
('Reading Specialist Certification','Education'),
('NTPS Tutoring Certification','Education'),('After School Program Director License','Education'),
('Child Life Specialist Certification','Education'),
('Childcare Center Director License','Education'),
('Family Childcare Provider License','Education'),('Nanny Certification (NCS)','Education'),
('Mandated Reporter Training Certificate','Education'),
('Pediatric First Aid Certification','Education'),
-- Security (10)
('Unarmed Security Guard License','Security'),('Armed Security Guard License','Security'),
('Private Investigator License','Security'),('Alarm System Installer License','Security'),
('Certified Protection Professional (CPP)','Security'),
('Loss Prevention Agent Certification','Security'),
('Event Security Specialist Certification','Security'),('CompTIA Security+ Certification','Security'),
('CISSP Certification','Security'),('Certified Ethical Hacker (CEH)','Security'),
-- Transportation (13)
('Commercial Driver''s License (CDL-A)','Transportation'),
('CDL Class B License','Transportation'),
('CDL Hazardous Materials Endorsement','Transportation'),
('FMCSA Medical Examiner Certificate','Transportation'),
('OSHA Forklift Safety Certification','Transportation'),
('NCCCO Crane Operator License','Transportation'),
('Taxi and Rideshare Driver License','Transportation'),
('School Bus Driver License','Transportation'),
('Non-Emergency Medical Transport License','Transportation'),
('TWIC Card (Maritime Security)','Transportation'),
('USCG Marine Captain License','Transportation'),
('FAA Part 107 Commercial Drone Pilot','Transportation'),
('CDL Passenger Endorsement','Transportation'),
-- Environmental & Pest Control (13)
('Structural Pesticide Applicator License','Environmental'),
('Lawn and Ornamental Pesticide License','Environmental'),
('Certified Pest Control Operator','Environmental'),
('Fumigator License','Environmental'),('Termite Inspector Certification','Environmental'),
('Wildlife Control Operator License','Environmental'),
('Integrated Pest Management (IPM) Specialist','Environmental'),
('HAZWOPER 40-Hour Certification','Environmental'),
('Lead Abatement Worker License','Environmental'),
('Asbestos Inspector License','Environmental'),
('Mold Remediation Contractor License','Environmental'),
('Radon Mitigation Specialist Certification','Environmental'),
('Certified Indoor Environmentalist (CIE)','Environmental'),
-- Beauty & Personal Care (20)
('Cosmetology License','Beauty'),('Esthetician License','Beauty'),
('Barber License','Beauty'),('Nail Technician License','Beauty'),
('Makeup Artist Certification','Beauty'),('Permanent Makeup Artist License','Beauty'),
('Microblading Certification','Beauty'),('Lash Extension Certification','Beauty'),
('Laser Hair Removal Technician License','Beauty'),('Electrology License','Beauty'),
('Medical Laser Technician License','Beauty'),
('Medical Aesthetics Certification','Beauty'),('Chemical Peel Certification','Beauty'),
('Spray Tanning Certification','Beauty'),
('Advanced Hair Coloring Certificate','Beauty'),
('Natural Hair Specialist Certification','Beauty'),
('Cosmetology Instructor License','Beauty'),('Esthetics Instructor License','Beauty'),
('Barber Instructor License','Beauty'),('Salon Manager Certification','Beauty'),
-- Technology (15)
('CompTIA A+ Certification','Technology'),('CompTIA Network+ Certification','Technology'),
('CompTIA Security+ Certification (IT)','Technology'),
('Microsoft Azure Fundamentals (AZ-900)','Technology'),
('Microsoft Azure Administrator (AZ-104)','Technology'),
('Google Cloud Associate Cloud Engineer','Technology'),
('AWS Cloud Practitioner Certification','Technology'),
('AWS Certified Solutions Architect','Technology'),('Cisco CCNA Certification','Technology'),
('Apple Certified Support Professional (ACSP)','Technology'),
('ITIL Foundation Certificate','Technology'),
('PMP Project Management Professional','Technology'),
('Certified Scrum Master (CSM)','Technology'),
('Six Sigma Green Belt Certification','Technology'),
('Google Analytics Individual Qualification','Technology'),
-- Other Professional (9)
('Certified Interior Designer (CID)','Other Professional'),
('Certified Kitchen Designer (CKD)','Other Professional'),
('CAPS Certified Aging-in-Place Specialist','Other Professional'),
('ISA Certified Arborist','Other Professional'),
('Registered Landscape Architect','Other Professional'),
('NFPA Fire Inspector Level I','Other Professional'),
('Certified Safety Professional (CSP)','Other Professional'),
('Certified Industrial Hygienist (CIH)','Other Professional'),
('Professional Land Surveyor (PLS)','Other Professional')
ON CONFLICT (name) DO NOTHING;

-- >>> END: 037_skills_and_licenses_lookup.sql <<<

-- >>> BEGIN: 038_display_name_preference.sql <<<
-- Migration 038: Name display preference
-- Lets users choose how their name appears: full_name, first_name, or business_name
-- OxSteed v2

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name_preference VARCHAR(20) DEFAULT 'first_name';

-- Valid values: 'full_name' | 'first_name' | 'business_name'
-- 'business_name' falls back to first_name if no primary business found

COMMENT ON COLUMN users.display_name_preference IS
  'Controls public display name: full_name, first_name, or business_name';

-- >>> END: 038_display_name_preference.sql <<<

-- >>> BEGIN: 039_user_skills_and_tool_rentals.sql <<<
-- Migration 039: User Skills Listings & Tool Rentals
-- Allows any user to list skills they offer and tools they rent out
-- OxSteed v2

-- ── User Skills Offered ────────────────────────────────────────────────────
-- A user can list skills they offer for hire (used by both customers and helpers)
CREATE TABLE IF NOT EXISTS user_skills (
  id            SERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_name    VARCHAR(200) NOT NULL,
  category      VARCHAR(100),
  hourly_rate   NUMERIC(10,2),          -- null = negotiable
  description   TEXT,
  years_exp     SMALLINT CHECK (years_exp >= 0 AND years_exp <= 99),
  is_available  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_category ON user_skills(category);
CREATE INDEX IF NOT EXISTS idx_user_skills_avail ON user_skills(is_available) WHERE is_available = true;

-- ── Tool Rentals ───────────────────────────────────────────────────────────
-- A user can list tools/equipment they own and offer for rental
CREATE TABLE IF NOT EXISTS tool_rentals (
  id              SERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  category        VARCHAR(100),
  description     TEXT,
  daily_rate      NUMERIC(10,2),         -- $ per day, null = contact for pricing
  hourly_rate     NUMERIC(10,2),         -- $ per hour, null = N/A
  deposit_amount  NUMERIC(10,2),
  condition       VARCHAR(50) CHECK (condition IN ('excellent','good','fair','poor')),
  brand           VARCHAR(100),
  model           VARCHAR(100),
  is_available    BOOLEAN NOT NULL DEFAULT true,
  requires_deposit BOOLEAN NOT NULL DEFAULT false,
  delivery_available BOOLEAN NOT NULL DEFAULT false,
  pickup_only     BOOLEAN NOT NULL DEFAULT true,
  location_city   VARCHAR(100),
  location_state  VARCHAR(50),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_rentals_user ON tool_rentals(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_rentals_category ON tool_rentals(category);
CREATE INDEX IF NOT EXISTS idx_tool_rentals_avail ON tool_rentals(is_available) WHERE is_available = true;

-- updated_at auto-update trigger for user_skills
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_skills_updated_at') THEN
    CREATE TRIGGER trg_user_skills_updated_at
      BEFORE UPDATE ON user_skills
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tool_rentals_updated_at') THEN
    CREATE TRIGGER trg_tool_rentals_updated_at
      BEFORE UPDATE ON tool_rentals
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- >>> END: 039_user_skills_and_tool_rentals.sql <<<

-- >>> BEGIN: 040_referral_referred_by.sql <<<
-- Add referred_by to track who referred each user
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);

-- Store referral code through OTP-based customer registration flow
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS referral_ref VARCHAR(50);

-- >>> END: 040_referral_referred_by.sql <<<
