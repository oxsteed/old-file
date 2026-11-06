-- Migration 20261106020000: Phase 4 Track B (goal goal_a0fc7c0f0394) —
-- PTO balances + accrual, shift templates.
--
-- PTO: an accrual policy per employee per time-off type
-- (business_time_off_policies) plus a stored balance per employee per
-- type (business_time_off_balances). An approved request decrements the
-- balance for its type; pending/denied/cancelled requests never do.
-- Accrual grants are recorded in business_time_off_accrual_events so
-- every balance movement is auditable. Balances are hours or days owed,
-- never currency, and never enter pay math.
--
-- Carryover cap: a grant that would push the balance past the policy's
-- carryover_cap banks only up to the cap; the excess is not banked.
--
-- Templates: a named set of shifts for a week
-- (business_shift_templates + business_shift_template_shifts), saved
-- from a published week and applied as drafts through the same copy
-- path as copy-week. day_of_week follows the existing convention
-- (0 = Sunday, matching business_staff_availability).
--
-- Additive only. Idempotent.

-- ── PTO accrual policies ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_time_off_policies (
  id              BIGSERIAL PRIMARY KEY,
  business_id     INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type    VARCHAR(24) NOT NULL
    CHECK (request_type IN ('vacation', 'sick', 'personal', 'unpaid', 'other')),
  accrual_amount  NUMERIC(10,2) NOT NULL CHECK (accrual_amount >= 0),
  accrual_unit    VARCHAR(8)  NOT NULL DEFAULT 'days'
    CHECK (accrual_unit IN ('hours', 'days')),
  accrual_period  VARCHAR(16) NOT NULL DEFAULT 'monthly'
    CHECK (accrual_period IN ('weekly', 'monthly', 'yearly', 'once')),
  carryover_cap   NUMERIC(10,2) CHECK (carryover_cap IS NULL OR carryover_cap >= 0),
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_time_off_policies_unique
    UNIQUE (business_id, user_id, request_type)
);

-- ── PTO balances ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_time_off_balances (
  id           BIGSERIAL PRIMARY KEY,
  business_id  INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type VARCHAR(24) NOT NULL
    CHECK (request_type IN ('vacation', 'sick', 'personal', 'unpaid', 'other')),
  balance      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  unit         VARCHAR(8)  NOT NULL DEFAULT 'days'
    CHECK (unit IN ('hours', 'days')),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_time_off_balances_unique
    UNIQUE (business_id, user_id, request_type)
);

-- ── PTO balance movement ledger (auditable, append-only) ───────────
CREATE TABLE IF NOT EXISTS business_time_off_accrual_events (
  id            BIGSERIAL PRIMARY KEY,
  business_id   INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type  VARCHAR(24) NOT NULL
    CHECK (request_type IN ('vacation', 'sick', 'personal', 'unpaid', 'other')),
  amount        NUMERIC(10,2) NOT NULL,
  unit          VARCHAR(8)  NOT NULL CHECK (unit IN ('hours', 'days')),
  event_type    VARCHAR(16) NOT NULL
    CHECK (event_type IN ('accrual', 'approval', 'reversal', 'adjustment', 'initial')),
  request_id    BIGINT      REFERENCES business_time_off_requests(id) ON DELETE SET NULL,
  balance_after NUMERIC(10,2) NOT NULL,
  created_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_btop_business_user
  ON business_time_off_policies (business_id, user_id);
CREATE INDEX IF NOT EXISTS idx_btob_business_user
  ON business_time_off_balances (business_id, user_id);
CREATE INDEX IF NOT EXISTS idx_btoa_business_user
  ON business_time_off_accrual_events (business_id, user_id, created_at);

-- ── Shift templates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_shift_templates (
  id          BIGSERIAL PRIMARY KEY,
  business_id INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        VARCHAR(120) NOT NULL,
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_shift_templates_unique UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS business_shift_template_shifts (
  id            BIGSERIAL PRIMARY KEY,
  template_id   BIGINT      NOT NULL REFERENCES business_shift_templates(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week   INTEGER     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME        NOT NULL,
  end_time      TIME        NOT NULL,
  role_label    VARCHAR(120),
  notes         TEXT,
  location_id   BIGINT      REFERENCES restaurant_locations(id) ON DELETE SET NULL,
  restaurant_id BIGINT      REFERENCES food_restaurants(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bsts_template
  ON business_shift_template_shifts (template_id);
