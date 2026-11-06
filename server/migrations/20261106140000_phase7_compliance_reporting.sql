-- Phase 7 compliance hardening + reporting (goal goal_a0fc7c0f0394;
-- baseline gaps 11, 15, 17, 19, 20, 21).
--
-- Temperature logs (gap 11): time-series readings per storage area
-- with the threshold snapshot taken at record time, a breach flag,
-- and a link to a corrective action in the existing audits flow.
-- Break attestations (gap 17): the employee's own statement at
-- clock-out, one per time entry; the premium math itself stays in
-- restaurantPayrollService.tierRows (Phase 1), the attestation only
-- confirms or disputes the punch record.
-- Scheduled reports (gap 19): schedules + a deliveries ledger whose
-- (schedule, business_date) unique key is the no-duplicate-send guard.
-- Rollup cache (gap 20): cached HQ rollups with an explicit expiry so
-- every read can state its staleness.
-- Retention / erasure (gap 21): per-class retention policy (the 7-year
-- default from staffOffboarding.js is the baseline; a stored row wins)
-- and erasure requests. Anonymization never deletes history rows:
-- time entries, pay runs, schedule versions and audit rows stay;
-- personal content on them is cleared instead.
--
-- Daily close locking (gap 19, verified 2026-11-06): the daily close
-- is RE-COMPUTABLE, not locked. computeDailyClose in
-- restaurantReportsController.js aggregates live order data on every
-- call; no close row is written and no lock table exists. Scheduled
-- deliveries therefore stamp as_of + snapshot=true + locked_close=false
-- and never claim to be a locked close.

CREATE TABLE IF NOT EXISTS restaurant_temperature_logs (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL,
  area_id BIGINT REFERENCES restaurant_inventory_storage_areas(id) ON DELETE SET NULL,
  -- Snapshot: the area may be renamed or deactivated later, the log keeps
  -- what the reading was taken against.
  area_name VARCHAR(160) NOT NULL,
  station_label VARCHAR(120),
  reading_celsius NUMERIC(5,2) NOT NULL,
  threshold_min_c NUMERIC(5,2),
  threshold_max_c NUMERIC(5,2),
  breach BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Business-local date of the reading: the daily log view groups on this.
  business_date DATE NOT NULL DEFAULT CURRENT_DATE,
  corrective_action_id BIGINT REFERENCES restaurant_corrective_actions(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_temp_logs_restaurant_day
  ON restaurant_temperature_logs(restaurant_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_temp_logs_breach
  ON restaurant_temperature_logs(restaurant_id, breach, recorded_at DESC)
  WHERE breach;

CREATE TABLE IF NOT EXISTS restaurant_break_attestations (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time_entry_id BIGINT NOT NULL REFERENCES business_time_entries(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL,
  meal_break_taken BOOLEAN NOT NULL,
  rest_break_taken BOOLEAN NOT NULL DEFAULT FALSE,
  waived BOOLEAN NOT NULL DEFAULT FALSE,
  waiver_reason TEXT,
  attested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Set at record time: the attestation disagrees with the punch
  -- record (says "taken" while the breaks show a missed meal break,
  -- or says "missed" while a full break is recorded). A disputed
  -- attestation never changes the premium: the punch record still
  -- prices it, and the dispute surfaces for a manager to resolve.
  disputed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (time_entry_id),
  -- A waiver is a statement that the meal break was NOT taken, for a
  -- stated reason. Attesting "taken" and "waived" together is a
  -- contradiction, not a waiver.
  CHECK (NOT (meal_break_taken AND waived)),
  CHECK (NOT waived OR (waiver_reason IS NOT NULL AND LENGTH(TRIM(waiver_reason)) > 0))
);
CREATE INDEX IF NOT EXISTS idx_break_attestations_business_day
  ON restaurant_break_attestations(business_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_break_attestations_waived
  ON restaurant_break_attestations(business_id, waived, entry_date DESC)
  WHERE waived;

CREATE TABLE IF NOT EXISTS restaurant_scheduled_reports (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('daily_close', 'labor', 'exceptions')),
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
  delivery_channel TEXT NOT NULL DEFAULT 'in_app' CHECK (delivery_channel IN ('in_app', 'email', 'both')),
  -- [{ "user_id": "<uuid>" }] for in-app, [{ "email": "a@b.c" }] for
  -- email. Validated in the service; the table stores the intent.
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_business_date DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_restaurant
  ON restaurant_scheduled_reports(restaurant_id, enabled);

CREATE TABLE IF NOT EXISTS restaurant_scheduled_report_deliveries (
  id BIGSERIAL PRIMARY KEY,
  scheduled_report_id BIGINT NOT NULL REFERENCES restaurant_scheduled_reports(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  report_type TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  -- The delivered report is a snapshot of re-computable data, never a
  -- locked close (see the header note). The flags travel with the
  -- delivery so a reader can never mistake one for the other.
  snapshot BOOLEAN NOT NULL DEFAULT TRUE,
  locked_close BOOLEAN NOT NULL DEFAULT FALSE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One delivery per schedule per business day: the second run of the
  -- job replays (ON CONFLICT DO NOTHING) instead of sending twice.
  UNIQUE (scheduled_report_id, business_date)
);
CREATE INDEX IF NOT EXISTS idx_scheduled_deliveries_date
  ON restaurant_scheduled_report_deliveries(business_date DESC);

CREATE TABLE IF NOT EXISTS restaurant_daily_rollups (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hq_labor')),
  currency_code TEXT,
  payload JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (from_date <= to_date),
  UNIQUE (restaurant_id, location_id, from_date, to_date, kind) NULLS NOT DISTINCT
);
CREATE INDEX IF NOT EXISTS idx_daily_rollups_expiry
  ON restaurant_daily_rollups(restaurant_id, expires_at);

-- Retention policy per record class (gap 21). The 7-year default is the
-- baseline from staffOffboarding.js (businesses.staff_record_retention_years,
-- default 7); a stored row wins over it, and a jurisdiction row (source =
-- 'jurisdiction', jurisdiction_code set) wins over an operator row for the
-- same class. No jurisdiction-specific period is invented here: where a
-- period needs a legal input it stays at the default and is flagged for
-- Emile's legal review (see the Phase 7 report).
CREATE TABLE IF NOT EXISTS restaurant_retention_policies (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL,
  record_class TEXT NOT NULL CHECK (record_class IN (
    'time_entries', 'pay_runs', 'schedule_versions', 'staff_documents',
    'tip_records', 'audit_events'
  )),
  retention_years INTEGER NOT NULL CHECK (retention_years >= 1 AND retention_years <= 30),
  jurisdiction_code TEXT,
  source TEXT NOT NULL DEFAULT 'default' CHECK (source IN ('default', 'jurisdiction', 'operator')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, location_id, record_class) NULLS NOT DISTINCT
);

CREATE TABLE IF NOT EXISTS restaurant_erasure_requests (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  restaurant_id BIGINT REFERENCES food_restaurants(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'completed', 'rejected')),
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  outcome JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_erasure_requests_business
  ON restaurant_erasure_requests(business_id, status, requested_at DESC);

-- Storage areas gain numeric thresholds so a temperature reading can be
-- judged against the area's own config instead of free text. The
-- free-text temperature_range stays as the human label.
ALTER TABLE restaurant_inventory_storage_areas
  ADD COLUMN IF NOT EXISTS temperature_min_c NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS temperature_max_c NUMERIC(5,2);

-- Work-permit document type (gap 17): minors' permits live in the staff
-- document vault alongside the other types. The CHECK lives in migration
-- 950 with an auto-generated name; resolve it from the catalog so this
-- stays correct if the name ever differs.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT c.conname INTO constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'restaurant_staff_documents'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%certificate_food_handler%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE restaurant_staff_documents DROP CONSTRAINT %I', constraint_name);
  END IF;
  ALTER TABLE restaurant_staff_documents
    ADD CONSTRAINT restaurant_staff_documents_doc_type_check
    CHECK (doc_type IN (
      'certificate_food_handler', 'certificate_allergen', 'certificate_manager',
      'certificate_other', 'id_document', 'policy_handbook', 'sop_document',
      'work_permit', 'other'
    ));
END $$;
