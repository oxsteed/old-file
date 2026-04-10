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
  is_active             BOOLEAN     NOT NULL DEFAULT true,
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
