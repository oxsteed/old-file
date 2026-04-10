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
