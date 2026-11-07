-- Migration 20261106183000: Phase 8 multi-location (goal goal_a0fc7c0f0394;
-- baseline gap 18, sections 6 and 8).
--
-- Track A — FX policy + stored rates. Rates are DATA, never a live
-- feed and never invented: an admin enters them (or they are imported)
-- and conversion uses the stored rate as of a stated date. A missing
-- rate fails closed (native detail only, gap flagged), it never
-- guesses. Convention, stated everywhere a converted figure appears:
-- one unit of base_currency buys `rate` units of quote_currency, so
-- amount_quote = amount_base * rate, rounded to the nearest minor
-- unit. Same-currency conversion is 1 and needs no stored row.
-- Policy default (product decision still owed from Emile, see the
-- Phase 8 report): reporting currency = the restaurant's primary
-- location currency, rate date = the period end, rate source = any
-- stored rate. A stored policy row wins over the default.
--
-- Track B — per-store tip-pool settings with restaurant-level
-- fallback (same shape as the Phase 1 per-location labor policies);
-- pay runs record the store scope they were built from
-- (location_ids) and the currency they were priced in.
--
-- Track C — cross-restaurant pay-run consolidations: a group of
-- finalized per-restaurant runs for one pay period, with its own
-- maker-checker finalize/approve (Phase 5 dual control) and
-- per-store attribution through the member runs.
--
-- Track D — staged brand menu rollouts (pilot restaurants, then
-- all); inter-store labor borrowing (a worker's shift at another
-- store of the same restaurant, requested then approved).
--
-- Track E — franchise reporting needs no new table: royalty and
-- marketing-fee terms already live on franchise_agreements
-- (royalty_bps, marketing_fee_bps, currency, initial_fee_cents)
-- and the reporting reads them. Scheduled HQ/franchise digests
-- reuse the Phase 7 scheduled-reports ledger: two new report
-- types, brand-scoped.

CREATE TABLE IF NOT EXISTS restaurant_fx_rates (
  id BIGSERIAL PRIMARY KEY,
  base_currency CHAR(3) NOT NULL,
  quote_currency CHAR(3) NOT NULL,
  rate NUMERIC(20,10) NOT NULL CHECK (rate > 0),
  rate_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'admin_entered'
    CHECK (source IN ('admin_entered', 'import')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (base_currency <> quote_currency),
  UNIQUE (base_currency, quote_currency, rate_date)
);
CREATE INDEX IF NOT EXISTS idx_restaurant_fx_rates_pair
  ON restaurant_fx_rates (base_currency, quote_currency, rate_date DESC);

CREATE TABLE IF NOT EXISTS restaurant_fx_policies (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT REFERENCES food_restaurants(id) ON DELETE CASCADE,
  brand_id BIGINT REFERENCES restaurant_brands(id) ON DELETE CASCADE,
  reporting_currency CHAR(3) NOT NULL,
  rate_source TEXT NOT NULL DEFAULT 'stored'
    CHECK (rate_source IN ('stored', 'admin_entered', 'import')),
  rate_date_mode TEXT NOT NULL DEFAULT 'period_end'
    CHECK (rate_date_mode IN ('period_end', 'rate_date')),
  -- 'period_end': use the rate as of the report period end.
  -- 'rate_date': use the rate as of this fixed date instead.
  rate_date DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (restaurant_id IS NOT NULL OR brand_id IS NOT NULL),
  CHECK (NOT (restaurant_id IS NOT NULL AND brand_id IS NOT NULL)),
  CHECK (rate_date_mode <> 'rate_date' OR rate_date IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_fx_policies_restaurant
  ON restaurant_fx_policies (restaurant_id) WHERE restaurant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_fx_policies_brand
  ON restaurant_fx_policies (brand_id) WHERE brand_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS restaurant_location_tip_pool_settings (
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  pooling_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  tip_out_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restaurant_id, location_id)
);

-- Pay-run store scope (Track B). location_ids is the explicit store
-- list the run was computed from. Legacy runs predate scoping and
-- keep '{}': they covered the whole restaurant and are flagged
-- unscoped wherever a per-store view reads them, never silently
-- attributed to one store. currency_code snapshots the restaurant
-- currency at creation so a later currency change cannot rewrite
-- history.
ALTER TABLE restaurant_pay_runs
  ADD COLUMN IF NOT EXISTS location_ids BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS currency_code CHAR(3);
UPDATE restaurant_pay_runs pr
   SET currency_code = fr.currency_code
  FROM food_restaurants fr
 WHERE pr.restaurant_id = fr.id AND pr.currency_code IS NULL
   AND fr.currency_code IS NOT NULL;
ALTER TABLE restaurant_pay_runs
  ALTER COLUMN currency_code SET DEFAULT 'USD';

-- Per-line store attribution (Track B/C). Set only when the run was
-- computed for exactly one store; multi-store runs leave lines
-- unattributed and attribute at run level through location_ids.
ALTER TABLE restaurant_pay_run_lines
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_pay_run_lines_location
  ON restaurant_pay_run_lines (pay_run_id, location_id);

CREATE TABLE IF NOT EXISTS restaurant_pay_run_consolidations (
  id BIGSERIAL PRIMARY KEY,
  brand_id BIGINT REFERENCES restaurant_brands(id) ON DELETE CASCADE,
  anchor_restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'finalized', 'approved', 'voided')),
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  finalized_by UUID REFERENCES users(id) ON DELETE SET NULL,
  finalized_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_from <= period_to),
  -- Phase 5 dual control, second line of defense behind the
  -- controller's maker != checker rejection.
  CHECK (approved_by IS NULL OR approved_by <> finalized_by)
);
CREATE INDEX IF NOT EXISTS idx_pay_run_consolidations_brand
  ON restaurant_pay_run_consolidations (brand_id, period_from DESC, period_to DESC);
CREATE INDEX IF NOT EXISTS idx_pay_run_consolidations_anchor
  ON restaurant_pay_run_consolidations (anchor_restaurant_id, period_from DESC, period_to DESC);

CREATE TABLE IF NOT EXISTS restaurant_pay_run_consolidation_members (
  id BIGSERIAL PRIMARY KEY,
  consolidation_id BIGINT NOT NULL REFERENCES restaurant_pay_run_consolidations(id) ON DELETE CASCADE,
  pay_run_id BIGINT NOT NULL REFERENCES restaurant_pay_runs(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_ids BIGINT[] NOT NULL DEFAULT '{}',
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  -- Snapshot of the member run's totals at join time; the run itself
  -- stays the immutable record.
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (consolidation_id, pay_run_id),
  UNIQUE (pay_run_id)
);
CREATE INDEX IF NOT EXISTS idx_pay_run_consolidation_members_consolidation
  ON restaurant_pay_run_consolidation_members (consolidation_id);

CREATE TABLE IF NOT EXISTS restaurant_brand_menu_rollouts (
  id BIGSERIAL PRIMARY KEY,
  brand_id BIGINT NOT NULL REFERENCES restaurant_brands(id) ON DELETE CASCADE,
  source_restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  status VARCHAR(24) NOT NULL DEFAULT 'pilot'
    CHECK (status IN ('pilot', 'rolled_out', 'cancelled')),
  pilot_restaurant_ids BIGINT[] NOT NULL DEFAULT '{}',
  target_restaurant_ids BIGINT[] NOT NULL DEFAULT '{}',
  -- Optional menu-item subset; NULL means the whole source menu,
  -- same as a direct brand publish.
  source_menu_item_ids BIGINT[],
  price_cents INTEGER,
  is_available BOOLEAN,
  idempotency_key VARCHAR(200) NOT NULL,
  -- One entry per stage publish: { stage, restaurant_ids, published,
  -- item_count, target_store_count, synced, failed, at }.
  stage_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (cardinality(pilot_restaurant_ids) >= 1),
  CHECK (cardinality(target_restaurant_ids) >= 1)
);
CREATE INDEX IF NOT EXISTS idx_brand_menu_rollouts_brand
  ON restaurant_brand_menu_rollouts (brand_id, created_at DESC);
-- One open rollout per brand at a time: two staged publishes to the
-- same brand would race each other's pilot results.
CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_menu_rollouts_open
  ON restaurant_brand_menu_rollouts (brand_id) WHERE status = 'pilot';

CREATE TABLE IF NOT EXISTS restaurant_labor_borrows (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  staff_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  home_location_id BIGINT NOT NULL REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  borrow_location_id BIGINT NOT NULL REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  role_label VARCHAR(100),
  status VARCHAR(24) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'declined', 'completed', 'cancelled')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (home_location_id <> borrow_location_id),
  CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS idx_labor_borrows_restaurant_date
  ON restaurant_labor_borrows (restaurant_id, shift_date, status);
CREATE INDEX IF NOT EXISTS idx_labor_borrows_staff_date
  ON restaurant_labor_borrows (staff_user_id, shift_date, status);

-- Scheduled HQ / franchise digests (Track D/E) reuse the Phase 7
-- deliveries ledger: same (schedule, business_date) no-duplicate
-- guard, same snapshot stamp, never a locked close.
ALTER TABLE restaurant_scheduled_reports
  ADD COLUMN IF NOT EXISTS brand_id BIGINT REFERENCES restaurant_brands(id) ON DELETE CASCADE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_scheduled_reports_report_type_check'
  ) THEN
    ALTER TABLE restaurant_scheduled_reports
      DROP CONSTRAINT restaurant_scheduled_reports_report_type_check;
  END IF;
END $$;
ALTER TABLE restaurant_scheduled_reports
  ADD CONSTRAINT restaurant_scheduled_reports_report_type_check
  CHECK (report_type IN ('daily_close', 'labor', 'exceptions', 'hq_digest', 'franchise_digest'));
ALTER TABLE restaurant_scheduled_reports
  ADD CONSTRAINT restaurant_scheduled_reports_digest_brand_check
  CHECK (report_type NOT IN ('hq_digest', 'franchise_digest') OR brand_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_brand
  ON restaurant_scheduled_reports (brand_id, enabled);
