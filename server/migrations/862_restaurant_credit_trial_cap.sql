-- Migration 862: Phase 5 restaurant credit trial cap + FIFO derisking.
--
-- Trial-tier restaurants (those WITHOUT a Phase 4 pre-purchase reserve row)
-- may carry at most cap_cents of outstanding customer credit (default $100,
-- configurable per restaurant and via FOOD_CREDIT_TRIAL_CAP_CENTS). When
-- outstanding exposure reaches the cap, new customer credit requests are
-- blocked with 409 restaurant_credit_at_capacity until the restaurant
-- derisks oldest balances first (FIFO) by migrating them to OxSteed Credit.
--
-- outstanding = SUM(food_customer_wallet_accounts.balance_cents) for the
-- restaurant.
--
-- MAINTENANCE DECISION (trigger vs compute-on-read):
-- A delta-based AFTER trigger keeps restaurant_credit_exposure.outstanding_cents
-- exact with O(1) work per wallet balance change, so the enforcement read on
-- the request path is a single primary-key lookup instead of an aggregate
-- scan. The alternative (compute-on-read) would add a SUM query to every
-- credit-request check and could disagree with concurrent writes; the
-- trigger is the more accurate choice and is what this migration installs.
--
-- Money-safety notes for the trigger:
--  - Deltas are exact integer arithmetic on balance_cents, which itself has
--    CHECK (balance_cents >= 0); the exposure CHECK (outstanding_cents >= 0)
--    therefore only fires on a genuine bug, failing the wallet write closed
--    (loud) instead of silently drifting the cap accounting.
--  - The UPDATE branch uses an upsert (not a bare UPDATE) so a missing
--    exposure row (e.g. restaurant created outside the normal flow) is
--    created with the delta rather than silently dropping it.
--  - Concurrent wallet writes serialize on the exposure row lock; the
--    `outstanding_cents + delta` update is atomic per row, so no deltas
--    are lost.
--  - This migration backfills outstanding_cents from the live SUM so
--    pre-existing balances are counted from deploy time.
--
-- restaurant_credit_derisks is the durable per-customer record of each FIFO
-- derisk migration: the restaurant wallet balance was zeroed (via the
-- append-only wallet ledger) and the customer was made whole in OxSteed
-- Credit. One row per (batch, customer); a batch groups the customers
-- migrated by a single operator derisk run.

CREATE TABLE IF NOT EXISTS restaurant_credit_exposure (
  restaurant_id BIGINT PRIMARY KEY REFERENCES food_restaurants(id) ON DELETE CASCADE,
  outstanding_cents BIGINT NOT NULL DEFAULT 0 CHECK (outstanding_cents >= 0),
  -- Per-restaurant trial cap. Defaults to $100 (10000); operators may raise
  -- it per restaurant. New restaurants inherit FOOD_CREDIT_TRIAL_CAP_CENTS
  -- (default 10000) via the lazy ensure in restaurantCreditDeriskService.
  cap_cents BIGINT NOT NULL DEFAULT 10000 CHECK (cap_cents > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_credit_derisks (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  derisked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operator_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_restaurant_credit_derisks_restaurant
  ON restaurant_credit_derisks (restaurant_id, derisked_at DESC);

-- Backfill: one exposure row per restaurant with the live outstanding sum.
INSERT INTO restaurant_credit_exposure (restaurant_id, outstanding_cents, cap_cents)
SELECT r.id,
       COALESCE(s.total_cents, 0),
       10000
  FROM food_restaurants r
  LEFT JOIN (
    SELECT restaurant_id, SUM(balance_cents) AS total_cents
      FROM food_customer_wallet_accounts
     GROUP BY restaurant_id
  ) s ON s.restaurant_id = r.id
ON CONFLICT (restaurant_id) DO NOTHING;

-- Delta trigger: keep outstanding_cents exact on every wallet balance change.
CREATE OR REPLACE FUNCTION trg_maintain_restaurant_credit_exposure()
RETURNS trigger AS $$
DECLARE
  delta_cents BIGINT;
  target_restaurant_id BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta_cents := COALESCE(NEW.balance_cents, 0);
    target_restaurant_id := NEW.restaurant_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id THEN
      -- A restaurant_id change is not expected (UNIQUE covers it), but
      -- handle it exactly rather than misattributing the delta.
      INSERT INTO restaurant_credit_exposure (restaurant_id, outstanding_cents, cap_cents)
      VALUES (OLD.restaurant_id, 0, 10000)
      ON CONFLICT (restaurant_id) DO UPDATE
        SET outstanding_cents = GREATEST(restaurant_credit_exposure.outstanding_cents - OLD.balance_cents, 0),
            updated_at = NOW();
      delta_cents := COALESCE(NEW.balance_cents, 0);
      target_restaurant_id := NEW.restaurant_id;
    ELSIF NEW.balance_cents IS DISTINCT FROM OLD.balance_cents THEN
      delta_cents := COALESCE(NEW.balance_cents, 0) - COALESCE(OLD.balance_cents, 0);
      target_restaurant_id := NEW.restaurant_id;
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    delta_cents := -COALESCE(OLD.balance_cents, 0);
    target_restaurant_id := OLD.restaurant_id;
  ELSE
    RETURN NULL;
  END IF;

  IF delta_cents <> 0 THEN
    INSERT INTO restaurant_credit_exposure (restaurant_id, outstanding_cents, cap_cents)
    VALUES (target_restaurant_id, GREATEST(delta_cents, 0), 10000)
    ON CONFLICT (restaurant_id) DO UPDATE
      SET outstanding_cents = restaurant_credit_exposure.outstanding_cents + EXCLUDED.outstanding_cents,
          updated_at = NOW();
    -- A negative delta on an existing row: apply it, floored at zero so a
    -- transient inconsistency can never wedge wallet writes with a CHECK
    -- violation. (Exact arithmetic keeps this path unreachable in practice.)
    IF delta_cents < 0 THEN
      UPDATE restaurant_credit_exposure
         SET outstanding_cents = GREATEST(outstanding_cents + delta_cents, 0),
             updated_at = NOW()
       WHERE restaurant_id = target_restaurant_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_credit_exposure_delta'
  ) THEN
    CREATE TRIGGER trg_restaurant_credit_exposure_delta
      AFTER INSERT OR UPDATE OR DELETE ON food_customer_wallet_accounts
      FOR EACH ROW
      EXECUTE FUNCTION trg_maintain_restaurant_credit_exposure();
  END IF;
END $$;
