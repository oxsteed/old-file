-- Migration 248: Consultant contractor network for local referral operations
-- Supports country-based consultant matching, negotiated OxSteed referral cuts,
-- and consultant-owned dashboards for business launch referrals.

CREATE TABLE IF NOT EXISTS consultant_contractor_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline VARCHAR(180),
  bio TEXT,
  home_country VARCHAR(2),
  home_region VARCHAR(120),
  home_city VARCHAR(120),
  coverage_countries TEXT[] NOT NULL DEFAULT '{}'::text[],
  coverage_regions TEXT[] NOT NULL DEFAULT '{}'::text[],
  languages TEXT[] NOT NULL DEFAULT '{}'::text[],
  specialties TEXT[] NOT NULL DEFAULT '{}'::text[],
  years_experience INTEGER,
  default_oxsteed_cut_bps INTEGER NOT NULL DEFAULT 2000 CHECK (default_oxsteed_cut_bps >= 0 AND default_oxsteed_cut_bps <= 10000),
  minimum_package_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (minimum_package_price_cents >= 0),
  active_referral_limit INTEGER NOT NULL DEFAULT 12 CHECK (active_referral_limit >= 0),
  accepts_new_referrals BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_virtual_consulting BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  timezone VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultant_profiles_active
  ON consultant_contractor_profiles(is_active, accepts_new_referrals);

CREATE INDEX IF NOT EXISTS idx_consultant_profiles_home_country
  ON consultant_contractor_profiles(home_country, home_region);

ALTER TABLE consulting_requests
  ADD COLUMN IF NOT EXISTS consultant_assigned_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consultant_assignment_status VARCHAR(40) NOT NULL DEFAULT 'unassigned',
  ADD COLUMN IF NOT EXISTS consultant_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consultant_follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consultant_last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consultant_intro_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consultant_status_notes TEXT,
  ADD COLUMN IF NOT EXISTS assigned_oxsteed_cut_bps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assigned_consultant_cut_bps INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS estimated_total_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_oxsteed_share_cents INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_consultant_share_cents INTEGER;

ALTER TABLE consulting_requests
  DROP CONSTRAINT IF EXISTS consulting_requests_consultant_assignment_status_check;

ALTER TABLE consulting_requests
  ADD CONSTRAINT consulting_requests_consultant_assignment_status_check
  CHECK (consultant_assignment_status IN (
    'unassigned',
    'assigned',
    'intro_pending',
    'intro_sent',
    'discovery_scheduled',
    'proposal_sent',
    'engaged',
    'won',
    'lost',
    'completed',
    'paused'
  ));

CREATE INDEX IF NOT EXISTS idx_consulting_requests_consultant
  ON consulting_requests(consultant_assigned_id, consultant_assignment_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS consulting_request_referral_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES consulting_requests(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  note_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consulting_request_referral_log_request
  ON consulting_request_referral_log(request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_consulting_request_referral_log_actor
  ON consulting_request_referral_log(actor_id, created_at DESC);
