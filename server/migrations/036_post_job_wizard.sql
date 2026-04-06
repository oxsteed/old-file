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
