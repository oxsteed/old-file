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
