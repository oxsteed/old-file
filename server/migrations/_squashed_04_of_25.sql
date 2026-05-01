
-- >>> BEGIN: 028_add_review_response_columns.sql <<<
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response_at TIMESTAMPTZ;

-- >>> END: 028_add_review_response_columns.sql <<<

-- >>> BEGIN: 029_add_pending_reg_user_tracking.sql <<<
-- Migration 029: Add user_id and account_created to pending_registrations
-- Supports creating the user row at OTP-verify time and tracking
-- whether the account has already been provisioned.

ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_created BOOLEAN NOT NULL DEFAULT FALSE;

-- >>> END: 029_add_pending_reg_user_tracking.sql <<<

-- >>> BEGIN: 029b_onboarding_tiers_tier3.sql <<<
BEGIN;

ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS user_id INTEGER,
  ADD COLUMN IF NOT EXISTS account_created BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pending_registrations_user_id_fkey'
      AND table_name = 'pending_registrations'
  ) THEN
    ALTER TABLE pending_registrations
      ADD CONSTRAINT pending_registrations_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'verified_pending_onboarding',
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tier_selected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS w9_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS membership_tier TEXT NOT NULL DEFAULT 'tier1',
  ADD COLUMN IF NOT EXISTS id_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS background_check_passed BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_onboarding_status_check'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_onboarding_status_check
      CHECK (
        onboarding_status IN (
          'verified_pending_onboarding',
          'onboarding_in_progress',
          'onboarding_complete',
          'suspended'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_membership_tier_check'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_membership_tier_check
      CHECK (membership_tier IN ('tier1', 'tier2'));
  END IF;
END $$;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS transaction_mode TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS tier3_requested_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tier3_accepted_by_helper BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS estimate_acknowledged_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS estimate_acknowledged_by_helper BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scope_acknowledged_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scope_acknowledged_by_helper BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS waiver_acknowledged_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS waiver_acknowledged_by_helper BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS best_practice_warning_shown BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'jobs_transaction_mode_check'
      AND table_name = 'jobs'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_transaction_mode_check
      CHECK (transaction_mode IN ('direct', 'guided_protected'));
  END IF;
END $$;

UPDATE users
SET
  contact_completed  = COALESCE(contact_completed,  FALSE),
  profile_completed  = COALESCE(profile_completed,  FALSE),
  tier_selected      = COALESCE(tier_selected,       FALSE),
  w9_completed       = COALESCE(w9_completed,        FALSE),
  terms_accepted     = COALESCE(terms_accepted,      FALSE),
  onboarding_completed = (
    COALESCE(profile_completed, FALSE)
    AND COALESCE(tier_selected,  FALSE)
    AND COALESCE(w9_completed,   FALSE)
    AND COALESCE(terms_accepted, FALSE)
  ),
  onboarding_status = CASE
    WHEN (
      COALESCE(profile_completed, FALSE)
      AND COALESCE(tier_selected,  FALSE)
      AND COALESCE(w9_completed,   FALSE)
      AND COALESCE(terms_accepted, FALSE)
    ) THEN 'onboarding_complete'
    ELSE 'verified_pending_onboarding'
  END
WHERE role = 'helper';

COMMIT;

-- >>> END: 029b_onboarding_tiers_tier3.sql <<<

-- >>> BEGIN: 030_update_plan_prices_stripe_ids.sql <<<
BEGIN;

-- Migration: Update plan prices and Stripe price IDs to match live Stripe products
-- Stripe is source of truth for pricing

-- Update Pro plan (Helper Pro): $14.99/month
UPDATE plans SET
  name = 'Pro',
  amount_cents = 1499,
  stripe_price_id = 'price_1THoNSGo54BMlgSy63EqsMJ3',
  stripe_product_id = 'prod_UGL3EVpq4MgUPs',
  features = '["Everything in Free", "Verified Pro badge", "Submit bids on jobs", "Push notifications for urgent jobs", "Background check eligibility", "Priority search placement"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'pro';

-- Update Broker plan: $39.00/month
UPDATE plans SET
  name = 'Broker',
  amount_cents = 3900,
  stripe_price_id = 'price_1THs8GGo54BMlgSyGjMDOWo7',
  stripe_product_id = 'prod_UGOwmUMeLKepTN',
  features = '["Everything in Pro", "Stripe Express payout account", "Accept protected payments via escrow", "Dispute resolution coverage", "Mediate jobs for other helpers", "Broker commission on mediated jobs"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'broker';

-- Ensure Free plan exists
INSERT INTO plans (name, slug, amount_cents, currency, interval, features)
VALUES (
  'Free',
  'free',
  0,
  'usd',
  'month',
  '["Profile listing", "Browse job posts", "Receive introduction requests", "Set your own rates"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;

-- >>> END: 030_update_plan_prices_stripe_ids.sql <<<

-- >>> BEGIN: 031_life_dashboard_tables.sql <<<
-- ═══════════════════════════════════════════════════════════════════════════
-- 030 — Life Dashboard Tables
-- Supports: expense tracking, budgets, goals, saved helpers, home maintenance
-- ═══════════════════════════════════════════════════════════════════════════

-- ── EXPENSES ──────────────────────────────────────────────────────────────
-- Tracks both income and expenses for any user (helper earnings auto-logged later)
CREATE TABLE IF NOT EXISTS expenses (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          VARCHAR(10) NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category      VARCHAR(60) NOT NULL,           -- e.g. 'Gas & Transportation', 'Supplies', 'Gig Payment'
  description   VARCHAR(255),
  occurred_at   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_user_type ON expenses (user_id, type);

-- ── BUDGET CATEGORIES ─────────────────────────────────────────────────────
-- User-defined monthly budget limits per category
CREATE TABLE IF NOT EXISTS budget_categories (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      VARCHAR(60) NOT NULL,
  monthly_limit NUMERIC(12,2) NOT NULL CHECK (monthly_limit >= 0),
  color         VARCHAR(20) DEFAULT '#F4A261',  -- for UI rendering
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category)
);

-- ── GOALS ─────────────────────────────────────────────────────────────────
-- Financial + life goals with progress tracking
CREATE TABLE IF NOT EXISTS goals (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         VARCHAR(120) NOT NULL,
  goal_type     VARCHAR(20) NOT NULL DEFAULT 'financial' CHECK (goal_type IN ('financial', 'task', 'career')),
  target_value  NUMERIC(12,2),                  -- for financial goals (dollar amount)
  current_value NUMERIC(12,2) DEFAULT 0,        -- for financial goals
  is_completed  BOOLEAN NOT NULL DEFAULT false,
  due_date      DATE,
  icon          VARCHAR(10) DEFAULT '🎯',        -- emoji for UI
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user ON goals (user_id, is_completed);

-- ── SAVED HELPERS ─────────────────────────────────────────────────────────
-- Customers can save/favorite helpers for quick rehiring
CREATE TABLE IF NOT EXISTS saved_helpers (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the customer
  helper_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the helper
  note          VARCHAR(255),                    -- optional personal note
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, helper_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_helpers_user ON saved_helpers (user_id);

-- ── HOME TASKS ────────────────────────────────────────────────────────────
-- Recurring home maintenance reminders + one-off tasks
CREATE TABLE IF NOT EXISTS home_tasks (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(120) NOT NULL,
  description     VARCHAR(500),
  due_date        DATE,
  recurrence_days INT,                           -- null = one-time, 30 = monthly, 90 = quarterly, etc.
  is_completed    BOOLEAN NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ,
  urgency         VARCHAR(10) DEFAULT 'low' CHECK (urgency IN ('low', 'medium', 'high')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_home_tasks_user ON home_tasks (user_id, is_completed, due_date);

-- ── LIFE CHECKLIST ────────────────────────────────────────────────────────
-- Simple personal to-do / life admin items
CREATE TABLE IF NOT EXISTS checklist_items (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         VARCHAR(200) NOT NULL,
  due_date      DATE,
  is_completed  BOOLEAN NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_user ON checklist_items (user_id, is_completed);

-- >>> END: 031_life_dashboard_tables.sql <<<

-- >>> BEGIN: 032_update_plans_pricing.sql <<<
-- ═══════════════════════════════════════════════════════════════════════════
-- 031 — Update plans to match OxSteed pricing
-- Free ($0) + Pro Monthly ($14.99) + Pro Yearly ($79.99)
--
-- IMPORTANT: After running this migration, you MUST update the
-- stripe_price_id and stripe_product_id values with real IDs from
-- your Stripe dashboard. The placeholder values will NOT work.
-- ═══════════════════════════════════════════════════════════════════════════

-- Update existing 'basic' slug to be the Free plan
UPDATE plans SET
  name = 'Free',
  amount_cents = 0,
  tier = 'free',
  stripe_price_id = 'price_FREE_PLACEHOLDER',
  stripe_product_id = 'prod_FREE_PLACEHOLDER',
  features = '["Profile listing on OxSteed", "Browse and view job posts", "Receive introduction requests", "Set your own rates", "Basic messaging"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'basic';

-- Update existing 'pro' slug to be Pro Monthly
UPDATE plans SET
  name = 'Pro',
  amount_cents = 1499,
  tier = 'pro',
  interval = 'month',
  stripe_price_id = 'REPLACE_WITH_REAL_STRIPE_PRICE_ID_MONTHLY',
  stripe_product_id = 'REPLACE_WITH_REAL_STRIPE_PRODUCT_ID',
  features = '["Everything in Free", "Verified Pro badge", "Submit bids on jobs", "Push notifications for urgent jobs", "Background check eligibility", "Identity verification", "Priority search placement", "Full Life Dashboard", "Saved helpers & home maintenance", "Community insights"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'pro';

-- Add Pro Yearly plan
INSERT INTO plans (name, slug, stripe_price_id, stripe_product_id, amount_cents, currency, interval, tier, features, active)
VALUES (
  'Pro (Yearly)',
  'pro-yearly',
  'REPLACE_WITH_REAL_STRIPE_PRICE_ID_YEARLY',
  'REPLACE_WITH_REAL_STRIPE_PRODUCT_ID',
  7999,
  'usd',
  'year',
  'pro',
  '["Everything in Free", "Verified Pro badge", "Submit bids on jobs", "Push notifications for urgent jobs", "Background check eligibility", "Identity verification", "Priority search placement", "Full Life Dashboard", "Saved helpers & home maintenance", "Community insights", "Save 56% vs monthly"]'::jsonb,
  TRUE
) ON CONFLICT (slug) DO UPDATE SET
  amount_cents = 7999,
  interval = 'year',
  stripe_price_id = EXCLUDED.stripe_price_id,
  stripe_product_id = EXCLUDED.stripe_product_id,
  features = EXCLUDED.features,
  updated_at = NOW();

-- >>> END: 032_update_plans_pricing.sql <<<

-- >>> BEGIN: 033_add_missing_helper_profile_columns.sql <<<
-- Migration 033: Add columns to helper_profiles that migration 019 defines
-- in CREATE TABLE but silently skips on existing tables (IF NOT EXISTS).
-- Fixes "Profile failed to save" errors on existing deployments.
-- OxSteed v2

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS profile_headline VARCHAR(280),
  ADD COLUMN IF NOT EXISTS rate_preference VARCHAR(20) DEFAULT 'per_job';

-- >>> END: 033_add_missing_helper_profile_columns.sql <<<
