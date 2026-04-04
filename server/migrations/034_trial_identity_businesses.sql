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
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
