-- =============================================================================
-- Squashed migration history cutover (Option B — max 25 files)
--
-- DELETE below clears legacy per-file rows from _migrations so these 25 shards
-- can run and record their own filenames.
--
-- IMPORTANT — existing databases that already ran the old 158-file chain:
-- Re-running shard 01 from the top repeats 001_initial_schema.sql (CREATE TYPE,
-- CREATE TABLE, etc.). That typically FAILS on a non-empty schema (duplicate
-- type/table). This layout is intended for:
--   • Fresh PostgreSQL databases, or
--   • Environments where you intentionally reset / restore then apply this branch.
--
-- For production cutover from the legacy chain, use a schema-aware baseline or
-- manual migration plan; do not assume idempotency of 001 on a live DB.
-- =============================================================================
DELETE FROM _migrations WHERE filename NOT LIKE '_squashed_%';


-- >>> BEGIN: 001_initial_schema.sql <<<
-- ═══════════════════════════════════════════════════════════════
-- OxSteed — Migration 001: Initial Schema
-- Run this first. All other migrations depend on this.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";   -- For geo queries
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- For fuzzy search

-- ─── ENUM Types ───────────────────────────────────────────────
CREATE TYPE user_role AS ENUM (
  'customer',
  'helper',
  'helper_pro',
  'broker',
  'admin',
  'super_admin'
);

CREATE TYPE subscription_status AS ENUM (
  'none',
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'paused'
);

CREATE TYPE background_check_status AS ENUM (
  'not_submitted',
  'pending',
  'passed',
  'failed',
  'expired'
);

CREATE TYPE job_status AS ENUM (
  'draft',
  'published',
    'matched',
  'negotiating',
  'accepted',
  'in_progress',
  'completed',
  'cancelled',
  'closed'
);

CREATE TYPE job_type AS ENUM (
  'tier1_intro',      -- Off-platform, no money through OxSteed
  'tier2_bid',        -- Subscription helper, no escrow
  'tier3_protected'   -- Full escrow + dispute protection
);

CREATE TYPE escrow_status AS ENUM (
  'none',
  'held',
  'released',
  'refunded',
  'disputed'
);

CREATE TYPE dispute_status AS ENUM (
  'none',
  'open',
  'under_review',
  'resolved_customer',
  'resolved_helper',
  'withdrawn'
);

CREATE TYPE payout_status AS ENUM (
  'pending',
  'processing',
  'paid',
  'failed',
  'cancelled'
);

CREATE TYPE consent_type AS ENUM (
  'terms_of_service',
  'privacy_policy',
  'tier3_payment_agreement',
  'background_check_consent',
  'w9_certification'
);

-- ─── MARKETS ──────────────────────────────────────────────────
-- Each city/region OxSteed operates in is a "market."
-- Supports national expansion without schema changes.
CREATE TABLE markets (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,          -- "Springfield, OH"
  slug          VARCHAR(100)  NOT NULL UNIQUE,   -- "springfield-oh"
  city          VARCHAR(100)  NOT NULL,
  state         CHAR(2)       NOT NULL,
  zip_codes     TEXT[]        NOT NULL DEFAULT '{}',
  is_active     BOOLEAN       NOT NULL DEFAULT false,
  launched_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Seed the first market
INSERT INTO markets (name, slug, city, state, zip_codes, is_active, launched_at)
VALUES (
  'Springfield, OH',
  'springfield-oh',
  'Springfield',
  'OH',
  ARRAY['45501','45502','45503','45504','45505',
        '45506'],
  true,
  now()
);

-- ─── USERS ────────────────────────────────────────────────────
CREATE TABLE users (
  id                        UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                     VARCHAR(255) NOT NULL UNIQUE,
  phone                     VARCHAR(20),
  password_hash             VARCHAR(255) NOT NULL,
  first_name                VARCHAR(100) NOT NULL,
  last_name                 VARCHAR(100) NOT NULL,
  username                  VARCHAR(50)  UNIQUE,
  role                      user_role    NOT NULL DEFAULT 'customer',
  subscription_status       subscription_status NOT NULL DEFAULT 'none',

  -- Email verification
  email_verified            BOOLEAN      NOT NULL DEFAULT false,
  email_verify_token        VARCHAR(255),
  email_verify_expires      TIMESTAMPTZ,

  -- Password reset
  reset_token               VARCHAR(255),
  reset_token_expires       TIMESTAMPTZ,

  -- Background check (Checkr)
  background_check_status   background_check_status NOT NULL DEFAULT 'not_submitted',
  background_check_id       VARCHAR(255),         -- Checkr candidate ID
  background_check_report_id VARCHAR(255),        -- Checkr report ID
  background_check_passed_at TIMESTAMPTZ,
  background_check_expiry   TIMESTAMPTZ,          -- 12 months from pass

  -- Tax compliance
  w9_on_file                BOOLEAN      NOT NULL DEFAULT false,
  w9_submitted_at           TIMESTAMPTZ,
  tax_id_last4              CHAR(4),              -- Last 4 of SSN/EIN only
  stripe_1099_issued        BOOLEAN      NOT NULL DEFAULT false,

  -- Stripe Identity verification
  stripe_identity_session_id VARCHAR(255),
  identity_verified         BOOLEAN      NOT NULL DEFAULT false,
  identity_verified_at      TIMESTAMPTZ,

  -- Account state
  is_active                 BOOLEAN      NOT NULL DEFAULT true,
  is_banned                 BOOLEAN      NOT NULL DEFAULT false,
  ban_reason                TEXT,
  banned_at                 TIMESTAMPTZ,
  banned_by                 UUID         REFERENCES users(id),

  -- Privacy
  last_known_ip_hash        VARCHAR(64),          -- SHA-256 of IP, never raw
  preferred_language        VARCHAR(10)  NOT NULL DEFAULT 'en',  -- en, es, ht

  -- Timestamps
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_login_at             TIMESTAMPTZ,
  deleted_at                TIMESTAMPTZ           -- Soft delete
);

CREATE INDEX idx_users_email          ON users(email);
CREATE INDEX idx_users_role           ON users(role);
CREATE INDEX idx_users_subscription   ON users(subscription_status);
CREATE INDEX idx_users_background     ON users(background_check_status);
CREATE INDEX idx_users_active         ON users(is_active) WHERE is_active = true;
CREATE INDEX idx_users_created        ON users(created_at DESC);

-- ─── USER CONSENT LOG ─────────────────────────────────────────
-- Records every clickwrap acceptance. Critical for legal defense.
CREATE TABLE user_consents (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type    consent_type NOT NULL,
  version         VARCHAR(20) NOT NULL,      -- "2026-03-20"
  ip_hash         VARCHAR(64) NOT NULL,      -- SHA-256 of IP
  user_agent      TEXT,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consents_user   ON user_consents(user_id);
CREATE INDEX idx_consents_type   ON user_consents(consent_type);
CREATE INDEX idx_consents_date   ON user_consents(accepted_at DESC);

-- ─── REFRESH TOKENS ───────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      VARCHAR(255) NOT NULL UNIQUE,
  device_info     TEXT,
  ip_hash         VARCHAR(64),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked         BOOLEAN     NOT NULL DEFAULT false,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash    ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expiry  ON refresh_tokens(expires_at)
  WHERE revoked = false;

-- ─── PLANS ────────────────────────────────────────────────────
CREATE TABLE plans (
  id                    SERIAL      PRIMARY KEY,
  slug                  VARCHAR(50) NOT NULL UNIQUE, -- 'free','pro','broker'
  name                  VARCHAR(100) NOT NULL,
  description           TEXT,
  amount_cents          INTEGER     NOT NULL DEFAULT 0,
  currency              CHAR(3)     NOT NULL DEFAULT 'usd',
  interval              VARCHAR(20) NOT NULL DEFAULT 'month',
  stripe_price_id       VARCHAR(255),
  stripe_product_id     VARCHAR(255),
  tier                  VARCHAR(50),
  active                BOOLEAN     NOT NULL DEFAULT true,
  features              JSONB       NOT NULL DEFAULT '[]',
  sort_order            INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (slug, name, description, amount_cents, features, sort_order)
VALUES
  ('free',
   'Free',
   'Basic directory listing — no platform fees',
   0,
   '["Profile listing","Browse job posts","Receive introduction requests","Set your own rates"]',
   1),
  ('pro',
   'Pro',
   'Verified subscription with bidding and push alerts',
   2900,
   '["Everything in Free","Verified Pro badge","Submit bids on jobs","Push notifications for urgent jobs","Background check eligibility","Priority search placement"]',
   2),
  ('broker',
   'Broker',
   'Full protected payments and mediation capability',
   7900,
   '["Everything in Pro","Stripe Express payout account","Accept protected payments via escrow","Dispute resolution coverage","Mediate jobs for other helpers","Broker commission on mediated jobs"]',
   3);

-- ─── SUBSCRIPTIONS ────────────────────────────────────────────
CREATE TABLE subscriptions (
  id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                   UUID        NOT NULL REFERENCES users(id)
                                          ON DELETE CASCADE,
  plan_id                   INTEGER     NOT NULL REFERENCES plans(id),
  status                    subscription_status NOT NULL DEFAULT 'trialing',
  stripe_subscription_id    VARCHAR(255) UNIQUE,
  stripe_customer_id        VARCHAR(255),
  current_period_start      TIMESTAMPTZ,
  current_period_end        TIMESTAMPTZ,
  trial_start               TIMESTAMPTZ,
  trial_end                 TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  cancel_at_period_end      BOOLEAN     NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user     ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe   ON subscriptions(stripe_subscription_id);
CREATE INDEX idx_subscriptions_status   ON subscriptions(status);
CREATE INDEX idx_subscriptions_period   ON subscriptions(current_period_end)
  WHERE status = 'active';

-- ─── HELPER PROFILES ──────────────────────────────────────────
CREATE TABLE helper_profiles (
  id                      SERIAL      PRIMARY KEY,
  user_id                 UUID        NOT NULL UNIQUE
                                        REFERENCES users(id) ON DELETE CASCADE,
  tier                    VARCHAR(20) NOT NULL DEFAULT 'free',

  -- Bio
  bio_short               VARCHAR(280),   -- Twitter-length teaser
  bio_long                TEXT,
  profile_photo_url       TEXT,

  -- Service area
  service_city            VARCHAR(100),
  service_state           CHAR(2),
  service_zip             VARCHAR(10),
  service_radius_miles    INTEGER     NOT NULL DEFAULT 10,
  service_lat             DECIMAL(10,7),
  service_lng             DECIMAL(10,7),
  service_location        GEOGRAPHY(POINT, 4326),  -- PostGIS point

  -- Pricing
  hourly_rate_min         DECIMAL(8,2),
  hourly_rate_max         DECIMAL(8,2),
  flat_rate_available     BOOLEAN     NOT NULL DEFAULT false,
  contact_for_pricing     BOOLEAN     NOT NULL DEFAULT false,

  -- Reputation
  avg_rating              DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  total_reviews           INTEGER      NOT NULL DEFAULT 0,
  completed_jobs_count    INTEGER      NOT NULL DEFAULT 0,
  response_time_hours     DECIMAL(5,2),  -- Avg hours to respond

  -- Verification flags
  is_background_checked   BOOLEAN     NOT NULL DEFAULT false,
  is_identity_verified    BOOLEAN     NOT NULL DEFAULT false,
  is_insured              BOOLEAN     NOT NULL DEFAULT false,   -- Self-declared
  is_licensed             BOOLEAN     NOT NULL DEFAULT false,   -- Self-declared
  insurance_details       TEXT,
  license_details         TEXT,

  -- Availability
  availability_json       JSONB       NOT NULL DEFAULT '{}',
  is_available_now        BOOLEAN     NOT NULL DEFAULT false,

  -- Stripe Connect (Tier 3)
  stripe_account_id       VARCHAR(255) UNIQUE,
  stripe_charges_enabled  BOOLEAN     NOT NULL DEFAULT false,
  stripe_payouts_enabled  BOOLEAN     NOT NULL DEFAULT false,
  stripe_onboarded_at     TIMESTAMPTZ,

  -- Market association
  market_id               INTEGER     REFERENCES markets(id),

  -- Metadata
  profile_views           INTEGER     NOT NULL DEFAULT 0,
  search_rank_boost       DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_helper_profiles_user       ON helper_profiles(user_id);
CREATE INDEX idx_helper_profiles_tier       ON helper_profiles(tier);
CREATE INDEX idx_helper_profiles_rating     ON helper_profiles(avg_rating DESC);
CREATE INDEX idx_helper_profiles_location   ON helper_profiles
  USING GIST(service_location);
CREATE INDEX idx_helper_profiles_market     ON helper_profiles(market_id);
CREATE INDEX idx_helper_profiles_bgc        ON helper_profiles(is_background_checked);

-- ─── HELPER SKILLS / CATEGORIES ───────────────────────────────
CREATE TABLE categories (
  id            SERIAL      PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  slug          VARCHAR(100) NOT NULL UNIQUE,
  parent_id     INTEGER      REFERENCES categories(id),
  icon          VARCHAR(50),
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE helper_skills (
  id            SERIAL      PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id   INTEGER     NOT NULL REFERENCES categories(id),
  skill_name    VARCHAR(100) NOT NULL,
  years_exp     INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id, skill_name)
);

CREATE INDEX idx_helper_skills_user     ON helper_skills(user_id);
CREATE INDEX idx_helper_skills_category ON helper_skills(category_id);

-- ─── JOBS ─────────────────────────────────────────────────────
CREATE TABLE jobs (
  id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Parties
  client_id                 UUID        NOT NULL REFERENCES users(id)
                                          ON DELETE CASCADE,
  assigned_helper_id        UUID        REFERENCES users(id),
  broker_id                 UUID        REFERENCES users(id),

  -- Job details
  title                     VARCHAR(255) NOT NULL,
  description               TEXT         NOT NULL,
  category_id               INTEGER      REFERENCES categories(id),
  category_name             VARCHAR(100),
  job_type                  job_type     NOT NULL DEFAULT 'tier1_intro',
  status                    job_status   NOT NULL DEFAULT 'draft',
  is_urgent                 BOOLEAN      NOT NULL DEFAULT false,

  -- Location (masked in public feed, full only to confirmed helper)
  location_address          TEXT,         -- Full address — never public
  location_city             VARCHAR(100),
  location_state            CHAR(2),
  location_zip              VARCHAR(10),
  location_lat              DECIMAL(10,7),
  location_lng              DECIMAL(10,7),
  location_point            GEOGRAPHY(POINT, 4326),
  location_approx_lat       DECIMAL(10,7), -- Fuzzed ±2 miles for public feed
  location_approx_lng       DECIMAL(10,7),

  -- Market
  market_id                 INTEGER      REFERENCES markets(id),

  -- Budget
    budget_min                DECIMAL(10,2),
  budget_max                DECIMAL(10,2),

  -- Agreed financials (set when bid accepted)
  job_value                 DECIMAL(10,2),         -- Helper's agreed price
  customer_total            DECIMAL(10,2),         -- Job value + all fees
  platform_fee              DECIMAL(10,2),         -- OxSteed's cut
  protection_fee            DECIMAL(10,2),         -- 2% payment protection
  broker_fee                DECIMAL(10,2),         -- 5% if brokered
  helper_payout             DECIMAL(10,2),         -- What helper receives
  is_broker_mediated        BOOLEAN      NOT NULL DEFAULT false,

  -- Escrow
  escrow_status             escrow_status NOT NULL DEFAULT 'none',
  stripe_payment_intent_id  VARCHAR(255),
  escrow_held_at            TIMESTAMPTZ,
  escrow_released_at        TIMESTAMPTZ,
  auto_release_at           TIMESTAMPTZ,           -- 72h after scheduled end

  -- Completion
  scheduled_start_at        TIMESTAMPTZ,
  scheduled_end_at          TIMESTAMPTZ,
  started_at                TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  completion_confirmed_at   TIMESTAMPTZ,
  completion_confirmed_by   UUID         REFERENCES users(id),

  -- Dispute
  dispute_status            dispute_status NOT NULL DEFAULT 'none',
  dispute_filed_at          TIMESTAMPTZ,
  dispute_filed_by          UUID         REFERENCES users(id),
  dispute_reason            TEXT,
  dispute_resolved_at       TIMESTAMPTZ,
  dispute_resolved_by       UUID         REFERENCES users(id),
  dispute_resolution_notes  TEXT,

  -- Address reveal gate
  -- Full address revealed to helper only within 12h of start
  -- and only after attendance confirmed
  address_revealed_at       TIMESTAMPTZ,
  address_revealed_to       UUID         REFERENCES users(id),
  attendance_confirmed_at   TIMESTAMPTZ,

  -- Bidding
  bid_count                 INTEGER      NOT NULL DEFAULT 0,
  max_bids                  INTEGER      NOT NULL DEFAULT 10,

  -- Media
  media_urls                TEXT[]       NOT NULL DEFAULT '{}',

  -- Metadata
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at                TIMESTAMPTZ,           -- Auto-expire unpicked jobs
  deleted_at                TIMESTAMPTZ            -- Soft delete
);

CREATE INDEX idx_jobs_client          ON jobs(client_id);
CREATE INDEX idx_jobs_helper          ON jobs(assigned_helper_id);
CREATE INDEX idx_jobs_broker          ON jobs(broker_id);
CREATE INDEX idx_jobs_status          ON jobs(status);
CREATE INDEX idx_jobs_type            ON jobs(job_type);
CREATE INDEX idx_jobs_market          ON jobs(market_id);
CREATE INDEX idx_jobs_category        ON jobs(category_id);
CREATE INDEX idx_jobs_urgent          ON jobs(is_urgent) WHERE is_urgent = true;
CREATE INDEX idx_jobs_location        ON jobs USING GIST(location_point);
CREATE INDEX idx_jobs_created         ON jobs(created_at DESC);
CREATE INDEX idx_jobs_escrow          ON jobs(escrow_status)
  WHERE escrow_status IN ('held','disputed');
CREATE INDEX idx_jobs_auto_release    ON jobs(auto_release_at)
  WHERE escrow_status = 'held' AND status = 'completed';

-- ─── BIDS ─────────────────────────────────────────────────────
CREATE TABLE bids (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  helper_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          DECIMAL(10,2) NOT NULL,
  message         TEXT,
  eta_hours       DECIMAL(5,1),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- pending → accepted | rejected | withdrawn | expired
  accepted_at     TIMESTAMPTZ,
  rejected_at     TIMESTAMPTZ,
  withdrawn_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, helper_id)   -- One bid per helper per job
);

CREATE INDEX idx_bids_job     ON bids(job_id);
CREATE INDEX idx_bids_helper  ON bids(helper_id);
CREATE INDEX idx_bids_status  ON bids(status);
CREATE INDEX idx_bids_expiry  ON bids(expires_at)
  WHERE status = 'pending';

-- ─── REVIEWS ──────────────────────────────────────────────────
CREATE TABLE reviews (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reviewer_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating          SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  is_public       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, reviewer_id)  -- One review per job per reviewer
);

CREATE INDEX idx_reviews_job       ON reviews(job_id);
CREATE INDEX idx_reviews_reviewee  ON reviews(reviewee_id);
CREATE INDEX idx_reviews_reviewer  ON reviews(reviewer_id);
CREATE INDEX idx_reviews_rating    ON reviews(rating);
CREATE INDEX idx_reviews_public    ON reviews(is_public, created_at DESC)
  WHERE is_public = true;

-- ─── PLATFORM LEDGER ──────────────────────────────────────────
-- Immutable financial audit trail. Never UPDATE or DELETE rows.
CREATE TABLE platform_ledger (
  id                          BIGSERIAL    PRIMARY KEY,
  source_type                 VARCHAR(50)  NOT NULL,
  -- subscription | job_fee | protection_fee | broker_fee |
  -- stripe_fee | refund | payout | adjustment | marketing
  amount_cents                INTEGER      NOT NULL,  -- Negative = outflow
  currency                    CHAR(3)      NOT NULL DEFAULT 'usd',
  user_id                     UUID         REFERENCES users(id)
                                             ON DELETE SET NULL,
  job_id                      UUID         REFERENCES jobs(id)
                                             ON DELETE SET NULL,
  stripe_payment_intent_id    VARCHAR(255),
  stripe_transfer_id          VARCHAR(255),
  stripe_charge_id            VARCHAR(255),
  description                 TEXT,
  metadata                    JSONB        NOT NULL DEFAULT '{}',
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_source      ON platform_ledger(source_type);
CREATE INDEX idx_ledger_user        ON platform_ledger(user_id);
CREATE INDEX idx_ledger_job         ON platform_ledger(job_id);
CREATE INDEX idx_ledger_created     ON platform_ledger(created_at DESC);
CREATE INDEX idx_ledger_stripe_pi   ON platform_ledger(stripe_payment_intent_id);

-- Prevent any UPDATE or DELETE on the ledger — immutable audit trail
CREATE RULE ledger_no_update AS ON UPDATE TO platform_ledger
  DO INSTEAD NOTHING;
CREATE RULE ledger_no_delete AS ON DELETE TO platform_ledger
  DO INSTEAD NOTHING;

-- ─── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE notifications (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            VARCHAR(100) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  body            TEXT         NOT NULL,
  data            JSONB        NOT NULL DEFAULT '{}',
  is_read         BOOLEAN      NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user     ON notifications(user_id);
CREATE INDEX idx_notifications_unread   ON notifications(user_id, is_read)
  WHERE is_read = false;
CREATE INDEX idx_notifications_created  ON notifications(created_at DESC);

-- ─── PUSH SUBSCRIPTIONS ───────────────────────────────────────
CREATE TABLE push_subscriptions (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        TEXT        NOT NULL UNIQUE,
  p256dh          TEXT        NOT NULL,
  auth            TEXT        NOT NULL,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX idx_push_subs_user ON push_subscriptions(user_id);

-- ─── INTRODUCTION REQUESTS (Tier 1 flow) ──────────────────────
CREATE TABLE intro_requests (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helper_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_description TEXT        NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- pending → accepted | declined | expired
  accepted_at     TIMESTAMPTZ,
  declined_at     TIMESTAMPTZ,
  contact_revealed_at TIMESTAMPTZ,  -- When phone/email shared
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, helper_id)
);

CREATE INDEX idx_intro_requests_customer ON intro_requests(customer_id);
CREATE INDEX idx_intro_requests_helper   ON intro_requests(helper_id);
CREATE INDEX idx_intro_requests_status   ON intro_requests(status);

-- ─── ADMIN AUDIT LOG ──────────────────────────────────────────
-- Every admin action is recorded here. Cannot be deleted.
CREATE TABLE admin_audit_log (
  id              BIGSERIAL    PRIMARY KEY,
  admin_id        UUID         NOT NULL REFERENCES users(id)
                                 ON DELETE SET NULL,
  action          VARCHAR(100) NOT NULL,
  target_type     VARCHAR(50),  -- 'user','job','dispute','subscription'
  target_id       TEXT,
  before_state    JSONB,
  after_state     JSONB,
  ip_hash         VARCHAR(64),
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_admin      ON admin_audit_log(admin_id);
CREATE INDEX idx_audit_action     ON admin_audit_log(action);
CREATE INDEX idx_audit_target     ON admin_audit_log(target_type, target_id);
CREATE INDEX idx_audit_created    ON admin_audit_log(created_at DESC);

-- Prevent deletion of audit log
CREATE RULE audit_no_delete AS ON DELETE TO admin_audit_log
  DO INSTEAD NOTHING;

-- ─── FEATURE FLAGS ────────────────────────────────────────────
-- Allows super admin to toggle features without deploys
CREATE TABLE feature_flags (
  id              SERIAL       PRIMARY KEY,
  key             VARCHAR(100) NOT NULL UNIQUE,
  is_enabled      BOOLEAN      NOT NULL DEFAULT false,
  description     TEXT,
  updated_by      UUID         REFERENCES users(id),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO feature_flags (key, is_enabled, description) VALUES
  ('tier3_payments_enabled',      true,  'Enable Tier 3 escrow payments'),
  ('background_checks_enabled',   true,  'Enable Checkr background checks'),
  ('referral_system_enabled',     true,  'Enable referral reward system'),
  ('broker_mediation_enabled',    true,  'Enable broker mediation feature'),
  ('urgent_push_enabled',         true,  'Push alerts for urgent jobs'),
  ('new_market_signups_enabled',  false, 'Allow signups outside current markets'),
  ('maintenance_mode',            false, 'Put platform in read-only maintenance mode');

-- ─── UPDATED_AT TRIGGERS ──────────────────────────────────────
-- Auto-update updated_at on every table that has it

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_jobs_updated
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bids_updated
  BEFORE UPDATE ON bids
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_helper_profiles_updated
  BEFORE UPDATE ON helper_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_subscriptions_updated
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_plans_updated
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_markets_updated
  BEFORE UPDATE ON markets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_feature_flags_updated
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── HELPER PROFILE RATING TRIGGER ───────────────────────────
-- Auto-recalculate avg_rating on helper_profiles when a review
-- is inserted or updated

CREATE OR REPLACE FUNCTION recalculate_helper_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE helper_profiles
  SET
    avg_rating    = (
      SELECT ROUND(AVG(rating)::numeric, 2)
      FROM reviews
      WHERE reviewee_id = NEW.reviewee_id
        AND is_public   = true
    ),
    total_reviews = (
      SELECT COUNT(*)
      FROM reviews
      WHERE reviewee_id = NEW.reviewee_id
        AND is_public   = true
    )
  WHERE user_id = NEW.reviewee_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_review_rating_update
  AFTER INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION recalculate_helper_rating();

-- ─── REVIEW COUNT ON JOBS TRIGGER ─────────────────────────────
-- Increment completed_jobs_count on helper_profiles
-- when a job transitions to 'completed'

CREATE OR REPLACE FUNCTION increment_helper_jobs()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed'
     AND NEW.assigned_helper_id IS NOT NULL THEN
    UPDATE helper_profiles
    SET completed_jobs_count = completed_jobs_count + 1
    WHERE user_id = NEW.assigned_helper_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_job_completion_counter
  AFTER UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION increment_helper_jobs();

-- ─── BID COUNT TRIGGER ────────────────────────────────────────
-- Keep jobs.bid_count in sync automatically

CREATE OR REPLACE FUNCTION update_bid_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE jobs SET bid_count = bid_count + 1 WHERE id = NEW.job_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE jobs SET bid_count = GREATEST(bid_count - 1, 0) WHERE id = OLD.job_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bid_count
  AFTER INSERT OR DELETE ON bids
  FOR EACH ROW EXECUTE FUNCTION update_bid_count();

-- ─── ADDRESS REVEAL AUDIT TRIGGER ────────────────────────────
-- Log every time a full address is revealed to a helper
-- Critical for privacy compliance

CREATE OR REPLACE FUNCTION log_address_reveal()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.address_revealed_at IS NOT NULL
     AND OLD.address_revealed_at IS NULL THEN
    INSERT INTO admin_audit_log
      (admin_id, action, target_type, target_id, after_state)
    VALUES (
      NEW.address_revealed_to,
      'address_revealed',
      'job',
      NEW.id::text,
      jsonb_build_object(
        'job_id',         NEW.id,
        'helper_id',      NEW.address_revealed_to,
        'revealed_at',    NEW.address_revealed_at,
        'job_start_at',   NEW.scheduled_start_at
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_address_reveal_log
  AFTER UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION log_address_reveal();

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- END OF MIGRATION 001
-- Next: Run migrations/002_auth_and_profiles.sql
-- ═══════════════════════════════════════════════════════════════


-- >>> END: 001_initial_schema.sql <<<

-- >>> BEGIN: 005_admin.sql <<<
BEGIN;

-- ── Admin roles extension ─────────────────────────────────────
-- Add 'admin' and 'super_admin' to users.role enum
DO $$ BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin';
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Admin audit log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  action        VARCHAR(80) NOT NULL,
  target_type   VARCHAR(40),           -- 'user'|'job'|'payout'|'setting'|'dispute'
  target_id     UUID,
  description   TEXT,
  ip_address    INET,
  user_agent    TEXT,
  before_state  JSONB,                 -- snapshot before change
  after_state   JSONB,                 -- snapshot after change
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_admin
  ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_target
  ON admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created
  ON admin_audit_log(created_at DESC);

-- ── Platform settings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
  key           VARCHAR(80) PRIMARY KEY,
  value         TEXT        NOT NULL,
  value_type    VARCHAR(20) DEFAULT 'string', -- 'string'|'number'|'boolean'|'json'
  description   TEXT,
  is_public     BOOLEAN     DEFAULT false,    -- expose to frontend?
  updated_by    UUID        REFERENCES users(id),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Default platform settings
INSERT INTO platform_settings (key, value, value_type, description, is_public)
VALUES
  ('platform_fee_starter',    '0.18',  'number',  'Fee rate for Starter plan helpers',    false),
  ('platform_fee_pro',        '0.14',  'number',  'Fee rate for Pro plan helpers',         false),
  ('platform_fee_elite',      '0.10',  'number',  'Fee rate for Elite plan helpers',       false),
  ('platform_fee_broker',     '0.22',  'number',  'Gross fee rate for brokered jobs',      false),
  ('broker_cut_rate',         '0.35',  'number',  'Broker share of platform fee',          false),
  ('max_job_budget',          '50000', 'number',  'Maximum allowed job budget',            true),
  ('bid_expiry_hours',        '72',    'number',  'Hours before a bid expires',            false),
  ('escrow_release_delay_hrs','0',     'number',  'Hours to delay escrow release',         false),
  ('maintenance_mode',        'false', 'boolean', 'Disable platform for maintenance',      true),
  ('new_user_registrations',  'true',  'boolean', 'Allow new user sign-ups',               false),
  ('require_id_verification', 'false', 'boolean', 'Require ID verification to bid',        false),
  ('min_helper_rating',       '0',     'number',  'Minimum rating to remain active',       false),
  ('support_email',           'support@oxsteed.com', 'string', 'Public support email',     true)
ON CONFLICT (key) DO NOTHING;

-- ── Feature flags ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flags (
  key           VARCHAR(80) PRIMARY KEY,
  is_enabled    BOOLEAN     DEFAULT false,
  description   TEXT,
  rollout_pct   INT         DEFAULT 100,  -- % of users who see this feature
  updated_by    UUID        REFERENCES users(id),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

INSERT INTO feature_flags (key, is_enabled, description)
VALUES
  ('tool_rental',        false, 'Enable tool rental marketplace'),
  ('broker_flow',        true,  'Enable broker claim/assign flow'),
  ('recurring_jobs',     false, 'Enable recurring job type'),
  ('instant_book',       false, 'Enable instant booking without bidding'),
  ('id_verification',    false, 'Enable Stripe Identity ID verification'),
  ('background_checks',  false, 'Enable Checkr background check integration'),
  ('referral_program',   false, 'Enable referral codes and rewards'),
  ('mobile_app',         false, 'Show mobile app download banners')
ON CONFLICT (key) DO NOTHING;

-- ── Reports / flagged content ─────────────────────────────────
CREATE TABLE IF NOT EXISTS content_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  target_type     VARCHAR(20) NOT NULL,   -- 'job'|'user'|'bid'|'review'
  target_id       UUID        NOT NULL,
  reason          VARCHAR(60) NOT NULL,   -- 'spam'|'fraud'|'inappropriate'|'other'
  description     TEXT,
  status          VARCHAR(20) DEFAULT 'pending', -- pending|reviewed|dismissed|actioned
  reviewed_by     UUID        REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  action_taken    TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_status
  ON content_reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_target
  ON content_reports(target_type, target_id);

COMMIT;

-- >>> END: 005_admin.sql <<<

-- >>> BEGIN: 010_phase3_create_plans.sql <<<
BEGIN;

-- Subscription plans table
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  slug VARCHAR(50) NOT NULL UNIQUE,
  stripe_price_id VARCHAR(255) NOT NULL,
  stripe_product_id VARCHAR(255) NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'usd',
  interval VARCHAR(20) DEFAULT 'month',
  tier VARCHAR(20) NOT NULL,
  features JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed plans
INSERT INTO plans (name, slug, stripe_price_id, stripe_product_id, amount_cents, tier, features) VALUES
('Basic Verified', 'basic', 'price_basic_monthly', 'prod_basic', 1999, 'tier2_basic',
  '["Background check", "Verified badge", "Full name visible", "Phone exchange on intro", "Priority in search"]'::jsonb),
('Pro Verified', 'pro', 'price_pro_monthly', 'prod_pro', 3999, 'tier2_pro',
  '["Everything in Basic", "Pro badge", "Featured placement", "Analytics dashboard", "Priority support", "Intro video"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES plans(id),
  stripe_subscription_id VARCHAR(255) UNIQUE,
  stripe_customer_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'incomplete',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ NULL,
  trial_end TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_sub_status CHECK (status IN ('incomplete', 'active', 'past_due', 'cancelled', 'trialing', 'unpaid'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

COMMIT;

-- >>> END: 010_phase3_create_plans.sql <<<

-- >>> BEGIN: 011_phase3_create_background_checks.sql <<<
BEGIN;

CREATE TABLE IF NOT EXISTS background_checks (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  checkr_candidate_id VARCHAR(255),
  checkr_invitation_id VARCHAR(255),
  checkr_report_id VARCHAR(255),
  status VARCHAR(30) DEFAULT 'pending',
  result VARCHAR(30) NULL,
  completed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  adjudication VARCHAR(30) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_bg_status CHECK (status IN ('pending', 'invited', 'in_progress', 'complete', 'suspended', 'error')),
  CONSTRAINT chk_bg_result CHECK (result IN (NULL, 'clear', 'consider', 'adverse'))
);

CREATE INDEX IF NOT EXISTS idx_bg_checks_user ON background_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_bg_checks_status ON background_checks(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bg_checks_checkr ON background_checks(checkr_candidate_id);

-- Identity verification records (Stripe Identity)
CREATE TABLE IF NOT EXISTS identity_verifications (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  stripe_verification_session_id VARCHAR(255) UNIQUE,
  status VARCHAR(30) DEFAULT 'requires_input',
  type VARCHAR(20) DEFAULT 'document',
  verified_name VARCHAR(255) NULL,
  verified_dob DATE NULL,
  document_type VARCHAR(50) NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_iv_status CHECK (status IN ('requires_input', 'processing', 'verified', 'canceled'))
);

CREATE INDEX IF NOT EXISTS idx_iv_user ON identity_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_iv_stripe ON identity_verifications(stripe_verification_session_id);

-- Badges table
CREATE TABLE IF NOT EXISTS badges (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  label VARCHAR(100) NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_badges_user ON badges(user_id);
CREATE INDEX IF NOT EXISTS idx_badges_type ON badges(type);

COMMIT;

-- >>> END: 011_phase3_create_background_checks.sql <<<

-- >>> BEGIN: 012_phase4_create_jobs.sql <<<
-- Phase 4: Jobs table for Tier 3 Protected Payments
-- Supports job posting, bidding, assignment, and completion workflow

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_helper_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100),
    category_name VARCHAR(100),
    subcategory VARCHAR(100),
    job_type VARCHAR(50) DEFAULT 'standard',
    budget_min NUMERIC(10, 2),
    budget_max NUMERIC(10, 2),
    final_price NUMERIC(10, 2),
    job_value NUMERIC(10, 2),
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    -- open, published, bidding, assigned, in_progress, completed, cancelled, disputed
    dispute_status VARCHAR(50),
    priority VARCHAR(20) DEFAULT 'normal',
    -- normal, urgent, emergency
    location_address TEXT,
    location_city VARCHAR(100),
    location_state VARCHAR(50),
    location_zip VARCHAR(20),
    location_lat NUMERIC(10, 7),
    location_lng NUMERIC(10, 7),
    is_remote BOOLEAN DEFAULT false,
    is_broker_mediated BOOLEAN DEFAULT false,
    scheduled_date TIMESTAMPTZ,
    scheduled_time_start TIME,
    scheduled_time_end TIME,
    estimated_duration_hours NUMERIC(5, 2),
    actual_duration_hours NUMERIC(5, 2),
    bid_count INTEGER DEFAULT 0,
    requirements JSONB DEFAULT '[]',
    images JSONB DEFAULT '[]',
    tags JSONB DEFAULT '[]',
    assigned_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    poster_confirmed BOOLEAN DEFAULT false,
    helper_confirmed BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill missing columns for tables created by earlier partial runs
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS category VARCHAR(100),
    ADD COLUMN IF NOT EXISTS category_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100),
    ADD COLUMN IF NOT EXISTS job_type VARCHAR(50) DEFAULT 'standard',
    ADD COLUMN IF NOT EXISTS job_value NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS dispute_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS scheduled_time_start TIME,
    ADD COLUMN IF NOT EXISTS scheduled_time_end TIME,
    ADD COLUMN IF NOT EXISTS estimated_duration_hours NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS actual_duration_hours NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS bid_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
    ADD COLUMN IF NOT EXISTS poster_confirmed BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS helper_confirmed BOOLEAN DEFAULT false;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_client_id ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_assigned_helper_id ON jobs(assigned_helper_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);
CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs(location_city, location_state);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);

-- >>> END: 012_phase4_create_jobs.sql <<<

-- >>> BEGIN: 013_phase4_create_bids.sql <<<
-- Phase 4: Bids table for job bidding system
-- Helpers bid on open jobs, posters accept/reject
-- NOTE: bids table already created in 001_initial_schema.sql with UUID types
-- This migration only adds extra columns/indexes if missing

-- Add columns that might be missing from 001
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Indexes (IF NOT EXISTS for safety)
CREATE INDEX IF NOT EXISTS idx_bids_job_id ON bids(job_id);
CREATE INDEX IF NOT EXISTS idx_bids_helper_id ON bids(helper_id);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids(status);
CREATE INDEX IF NOT EXISTS idx_bids_job_status ON bids(job_id, status);

-- >>> END: 013_phase4_create_bids.sql <<<

-- >>> BEGIN: 014_phase4_create_payments.sql <<<
-- Phase 4: Payments table for Tier 3 Protected Payments
-- Escrow-style payments via Stripe Connect
-- Platform holds funds until job completion confirmed

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES users(id),
  payee_id UUID NOT NULL REFERENCES users(id),
  stripe_payment_intent_id VARCHAR(255),
  stripe_transfer_id VARCHAR(255),
  stripe_charge_id VARCHAR(255),
  amount NUMERIC(10, 2) NOT NULL,
  platform_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
  platform_fee_percent NUMERIC(5, 2) DEFAULT 15.00,
  helper_payout NUMERIC(10, 2),
  currency VARCHAR(3) DEFAULT 'usd',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  -- pending, authorized, captured, released, refunded, disputed, failed
  escrow_status VARCHAR(30) DEFAULT 'none',
  -- none, held, released, refunded
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  refund_amount NUMERIC(10, 2),
  refund_reason TEXT,
  failure_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payments_job_id ON payments(job_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer_id ON payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_payments_payee_id ON payments(payee_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_escrow ON payments(escrow_status);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_pi ON payments(stripe_payment_intent_id);

-- Connect accounts table for Stripe Connect onboarding
CREATE TABLE IF NOT EXISTS connect_accounts (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id VARCHAR(255) NOT NULL UNIQUE,
  charges_enabled BOOLEAN DEFAULT false,
  payouts_enabled BOOLEAN DEFAULT false,
  onboarding_complete BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connect_accounts_user ON connect_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_connect_accounts_stripe ON connect_accounts(stripe_account_id);

-- >>> END: 014_phase4_create_payments.sql <<<
