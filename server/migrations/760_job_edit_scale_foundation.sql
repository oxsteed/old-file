-- Migration 760: posted-job editing at scale.
--
-- One source of truth for job money, schedule, and location; optimistic
-- concurrency; bid snapshots and reconfirmation; append-only revisions;
-- a transactional outbox for edit fan-out; and search/feed indexes.
--
-- Canonical columns (writers may still send the legacy columns; the trigger
-- below derives the canonical value and rewrites the legacy mirror so old
-- readers keep working):
--   money     → *_cents INTEGER (jobs budget/financials, bids.amount_cents)
--   schedule  → jobs.scheduled_start_at TIMESTAMPTZ + scheduled_precision
--   location  → jobs.location_lat/lng → location_point + fuzzed approx coords
--
-- See docs/job-editing.md and docs/job-status-transitions.md.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── jobs: concurrency, revision, canonical fields ─────────────────────────────
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS material_edit_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_material_edit_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS budget_min_cents INTEGER,
  ADD COLUMN IF NOT EXISTS budget_max_cents INTEGER,
  ADD COLUMN IF NOT EXISTS job_value_cents INTEGER,
  ADD COLUMN IF NOT EXISTS customer_total_cents INTEGER,
  ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER,
  ADD COLUMN IF NOT EXISTS protection_fee_cents INTEGER,
  ADD COLUMN IF NOT EXISTS broker_fee_cents INTEGER,
  ADD COLUMN IF NOT EXISTS helper_payout_cents INTEGER,
  ADD COLUMN IF NOT EXISTS job_value NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS customer_total NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS protection_fee NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS broker_fee NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS helper_payout NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS scheduled_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_precision VARCHAR(10),
  ADD COLUMN IF NOT EXISTS location_country VARCHAR(100),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS search_document TSVECTOR;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jobs_scheduled_precision') THEN
    ALTER TABLE jobs ADD CONSTRAINT chk_jobs_scheduled_precision
      CHECK (scheduled_precision IS NULL OR scheduled_precision IN ('date', 'datetime'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jobs_budget_cents_order') THEN
    ALTER TABLE jobs ADD CONSTRAINT chk_jobs_budget_cents_order
      CHECK (budget_min_cents IS NULL OR budget_max_cents IS NULL OR budget_min_cents <= budget_max_cents) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jobs_version_positive') THEN
    ALTER TABLE jobs ADD CONSTRAINT chk_jobs_version_positive CHECK (version >= 1 AND revision >= 1);
  END IF;
END $$;

-- Derive the canonical cents value for one dollars/cents pair.
-- Cents win when they changed (or are the only value on insert); otherwise a
-- changed dollars value is converted. Unchanged pairs keep their cents.
CREATE OR REPLACE FUNCTION oxsteed_money_cents(
  is_insert BOOLEAN,
  old_dollars NUMERIC, new_dollars NUMERIC,
  old_cents INTEGER, new_cents INTEGER
) RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF is_insert THEN
    IF new_cents IS NOT NULL THEN RETURN new_cents; END IF;
    IF new_dollars IS NULL THEN RETURN NULL; END IF;
    RETURN ROUND(new_dollars * 100)::INTEGER;
  END IF;
  IF new_cents IS DISTINCT FROM old_cents THEN RETURN new_cents; END IF;
  IF new_dollars IS DISTINCT FROM old_dollars THEN
    IF new_dollars IS NULL THEN RETURN NULL; END IF;
    RETURN ROUND(new_dollars * 100)::INTEGER;
  END IF;
  RETURN new_cents;
END $$;

CREATE OR REPLACE FUNCTION jobs_canonical_fields() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ins BOOLEAN := TG_OP = 'INSERT';
  fuzz_deg CONSTANT DOUBLE PRECISION := 2.0 / 69.0;
BEGIN
  -- Money: cents are canonical, dollars mirror them for legacy readers.
  NEW.budget_min_cents := oxsteed_money_cents(ins, CASE WHEN ins THEN NULL ELSE OLD.budget_min END, NEW.budget_min, CASE WHEN ins THEN NULL ELSE OLD.budget_min_cents END, NEW.budget_min_cents);
  NEW.budget_max_cents := oxsteed_money_cents(ins, CASE WHEN ins THEN NULL ELSE OLD.budget_max END, NEW.budget_max, CASE WHEN ins THEN NULL ELSE OLD.budget_max_cents END, NEW.budget_max_cents);
  NEW.job_value_cents := oxsteed_money_cents(ins, CASE WHEN ins THEN NULL ELSE OLD.job_value END, NEW.job_value, CASE WHEN ins THEN NULL ELSE OLD.job_value_cents END, NEW.job_value_cents);
  NEW.customer_total_cents := oxsteed_money_cents(ins, CASE WHEN ins THEN NULL ELSE OLD.customer_total END, NEW.customer_total, CASE WHEN ins THEN NULL ELSE OLD.customer_total_cents END, NEW.customer_total_cents);
  NEW.platform_fee_cents := oxsteed_money_cents(ins, CASE WHEN ins THEN NULL ELSE OLD.platform_fee END, NEW.platform_fee, CASE WHEN ins THEN NULL ELSE OLD.platform_fee_cents END, NEW.platform_fee_cents);
  NEW.protection_fee_cents := oxsteed_money_cents(ins, CASE WHEN ins THEN NULL ELSE OLD.protection_fee END, NEW.protection_fee, CASE WHEN ins THEN NULL ELSE OLD.protection_fee_cents END, NEW.protection_fee_cents);
  NEW.broker_fee_cents := oxsteed_money_cents(ins, CASE WHEN ins THEN NULL ELSE OLD.broker_fee END, NEW.broker_fee, CASE WHEN ins THEN NULL ELSE OLD.broker_fee_cents END, NEW.broker_fee_cents);
  NEW.helper_payout_cents := oxsteed_money_cents(ins, CASE WHEN ins THEN NULL ELSE OLD.helper_payout END, NEW.helper_payout, CASE WHEN ins THEN NULL ELSE OLD.helper_payout_cents END, NEW.helper_payout_cents);
  NEW.budget_min := NEW.budget_min_cents / 100.0;
  NEW.budget_max := NEW.budget_max_cents / 100.0;
  NEW.job_value := NEW.job_value_cents / 100.0;
  NEW.customer_total := NEW.customer_total_cents / 100.0;
  NEW.platform_fee := NEW.platform_fee_cents / 100.0;
  NEW.protection_fee := NEW.protection_fee_cents / 100.0;
  NEW.broker_fee := NEW.broker_fee_cents / 100.0;
  NEW.helper_payout := NEW.helper_payout_cents / 100.0;

  -- Schedule: scheduled_start_at is canonical. Date-only schedules anchor to
  -- 09:00 UTC (the long-standing appointment default) with precision 'date'.
  IF ins THEN
    IF NEW.scheduled_start_at IS NOT NULL THEN
      NEW.scheduled_precision := COALESCE(NEW.scheduled_precision, 'datetime');
    ELSIF NEW.scheduled_time IS NOT NULL THEN
      NEW.scheduled_start_at := NEW.scheduled_time;
      NEW.scheduled_precision := 'datetime';
    ELSIF NEW.scheduled_date IS NOT NULL THEN
      NEW.scheduled_start_at := (NEW.scheduled_date::date + TIME '09:00') AT TIME ZONE 'UTC';
      NEW.scheduled_precision := 'date';
    END IF;
  ELSE
    IF NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at
       OR NEW.scheduled_precision IS DISTINCT FROM OLD.scheduled_precision THEN
      IF NEW.scheduled_start_at IS NOT NULL THEN
        NEW.scheduled_precision := COALESCE(NEW.scheduled_precision, 'datetime');
      END IF;
    ELSIF NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time AND NEW.scheduled_time IS NOT NULL THEN
      NEW.scheduled_start_at := NEW.scheduled_time;
      NEW.scheduled_precision := 'datetime';
    ELSIF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date THEN
      IF NEW.scheduled_date IS NULL THEN
        NEW.scheduled_start_at := NULL;
      ELSE
        NEW.scheduled_start_at := (NEW.scheduled_date::date + TIME '09:00') AT TIME ZONE 'UTC';
        NEW.scheduled_precision := 'date';
      END IF;
    END IF;
  END IF;
  IF NEW.scheduled_start_at IS NULL THEN
    NEW.scheduled_precision := NULL;
    NEW.scheduled_date := NULL;
    NEW.scheduled_time := NULL;
  ELSE
    NEW.scheduled_date := (NEW.scheduled_start_at AT TIME ZONE 'UTC')::date;
    NEW.scheduled_time := CASE WHEN NEW.scheduled_precision = 'datetime' THEN NEW.scheduled_start_at ELSE NULL END;
  END IF;

  -- Location: exact coordinates are canonical; the point and the public
  -- fuzzed coordinates are always recomputed from them. Moving the address
  -- without new coordinates clears stale geo so city fallback matching applies.
  IF ins OR NEW.location_lat IS DISTINCT FROM OLD.location_lat OR NEW.location_lng IS DISTINCT FROM OLD.location_lng THEN
    IF NEW.location_lat IS NOT NULL AND NEW.location_lng IS NOT NULL THEN
      NEW.location_point := ST_SetSRID(ST_MakePoint(NEW.location_lng::double precision, NEW.location_lat::double precision), 4326)::geography;
      IF NOT ins OR NEW.location_approx_lat IS NULL OR NEW.location_approx_lng IS NULL THEN
        NEW.location_approx_lat := ROUND((NEW.location_lat::double precision + (random() * 2 - 1) * fuzz_deg)::numeric, 6);
        NEW.location_approx_lng := ROUND((NEW.location_lng::double precision + (random() * 2 - 1) * fuzz_deg)::numeric, 6);
      END IF;
    ELSIF NOT ins THEN
      NEW.location_point := NULL;
      NEW.location_approx_lat := NULL;
      NEW.location_approx_lng := NULL;
    END IF;
  ELSIF NEW.location_city IS DISTINCT FROM OLD.location_city
     OR NEW.location_state IS DISTINCT FROM OLD.location_state
     OR NEW.location_zip IS DISTINCT FROM OLD.location_zip
     OR NEW.location_country IS DISTINCT FROM OLD.location_country
     OR NEW.location_address IS DISTINCT FROM OLD.location_address THEN
    NEW.location_lat := NULL;
    NEW.location_lng := NULL;
    NEW.location_point := NULL;
    NEW.location_approx_lat := NULL;
    NEW.location_approx_lng := NULL;
  END IF;

  -- Full-text search document (only rebuilt when searchable text changes).
  IF ins OR NEW.search_document IS NULL
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.category_name IS DISTINCT FROM OLD.category_name THEN
    NEW.search_document :=
      setweight(to_tsvector('simple'::regconfig, COALESCE(NEW.title, '')), 'A') ||
      setweight(to_tsvector('simple'::regconfig, COALESCE(NEW.category_name, '')), 'B') ||
      setweight(to_tsvector('simple'::regconfig, COALESCE(NEW.description, '')), 'C');
  END IF;

  -- Optimistic concurrency: any change other than counters/bookkeeping bumps
  -- the version so If-Match / expected_version detects concurrent writers.
  IF NOT ins THEN
    IF (to_jsonb(NEW) - ARRAY['version', 'updated_at', 'bid_count', 'search_document'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['version', 'updated_at', 'bid_count', 'search_document']) THEN
      NEW.version := OLD.version + 1;
    ELSE
      NEW.version := OLD.version;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jobs_canonical_fields ON jobs;
CREATE TRIGGER trg_jobs_canonical_fields
  BEFORE INSERT OR UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION jobs_canonical_fields();

-- Backfill canonical values. The trigger is disabled for the backfill so the
-- version column and fuzzed coordinates of existing rows are not churned.
ALTER TABLE jobs DISABLE TRIGGER trg_jobs_canonical_fields;
UPDATE jobs
   SET budget_min_cents = COALESCE(budget_min_cents, ROUND(budget_min * 100)::INTEGER),
       budget_max_cents = COALESCE(budget_max_cents, ROUND(budget_max * 100)::INTEGER),
       job_value_cents = COALESCE(job_value_cents, ROUND(job_value * 100)::INTEGER),
       customer_total_cents = COALESCE(customer_total_cents, ROUND(customer_total * 100)::INTEGER),
       platform_fee_cents = COALESCE(platform_fee_cents, ROUND(platform_fee * 100)::INTEGER),
       protection_fee_cents = COALESCE(protection_fee_cents, ROUND(protection_fee * 100)::INTEGER),
       broker_fee_cents = COALESCE(broker_fee_cents, ROUND(broker_fee * 100)::INTEGER),
       helper_payout_cents = COALESCE(helper_payout_cents, ROUND(helper_payout * 100)::INTEGER),
       scheduled_start_at = COALESCE(
         scheduled_start_at,
         scheduled_time,
         CASE WHEN scheduled_date IS NOT NULL THEN (scheduled_date::date + TIME '09:00') AT TIME ZONE 'UTC' END
       ),
       scheduled_precision = CASE
         WHEN scheduled_start_at IS NOT NULL OR scheduled_time IS NOT NULL THEN 'datetime'
         WHEN scheduled_date IS NOT NULL THEN 'date'
         ELSE NULL
       END,
       location_point = CASE
         WHEN location_point IS NULL AND location_lat IS NOT NULL AND location_lng IS NOT NULL
           THEN ST_SetSRID(ST_MakePoint(location_lng::double precision, location_lat::double precision), 4326)::geography
         ELSE location_point
       END,
       search_document =
         setweight(to_tsvector('simple'::regconfig, COALESCE(title, '')), 'A') ||
         setweight(to_tsvector('simple'::regconfig, COALESCE(category_name, '')), 'B') ||
         setweight(to_tsvector('simple'::regconfig, COALESCE(description, '')), 'C');
-- Mirror the legacy columns from the canonical values.
UPDATE jobs
   SET budget_min = budget_min_cents / 100.0,
       budget_max = budget_max_cents / 100.0,
       scheduled_date = CASE WHEN scheduled_start_at IS NULL THEN NULL ELSE (scheduled_start_at AT TIME ZONE 'UTC')::date END,
       scheduled_time = CASE WHEN scheduled_precision = 'datetime' THEN scheduled_start_at ELSE NULL END
 WHERE budget_min IS DISTINCT FROM budget_min_cents / 100.0
    OR budget_max IS DISTINCT FROM budget_max_cents / 100.0
    OR scheduled_time IS DISTINCT FROM CASE WHEN scheduled_precision = 'datetime' THEN scheduled_start_at ELSE NULL END
    OR scheduled_date IS DISTINCT FROM CASE WHEN scheduled_start_at IS NULL THEN NULL ELSE (scheduled_start_at AT TIME ZONE 'UTC')::date END;
ALTER TABLE jobs ENABLE TRIGGER trg_jobs_canonical_fields;

-- ── bids: cents-only amounts and job snapshots ───────────────────────────────
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS job_version INTEGER,
  ADD COLUMN IF NOT EXISTS job_revision INTEGER,
  ADD COLUMN IF NOT EXISTS job_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS needs_reconfirm BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reconfirm_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconfirmed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION bids_canonical_amount() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ins BOOLEAN := TG_OP = 'INSERT';
BEGIN
  NEW.amount_cents := oxsteed_money_cents(ins, CASE WHEN ins THEN NULL ELSE OLD.amount END, NEW.amount, CASE WHEN ins THEN NULL ELSE OLD.amount_cents END, NEW.amount_cents);
  IF NEW.amount_cents IS NOT NULL THEN
    NEW.amount := NEW.amount_cents / 100.0;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bids_canonical_amount ON bids;
CREATE TRIGGER trg_bids_canonical_amount
  BEFORE INSERT OR UPDATE OF amount, amount_cents ON bids
  FOR EACH ROW EXECUTE FUNCTION bids_canonical_amount();

UPDATE bids SET amount_cents = ROUND(amount * 100)::INTEGER WHERE amount_cents IS NULL AND amount IS NOT NULL;
UPDATE bids b
   SET job_revision = COALESCE(b.job_revision, j.revision),
       job_version = COALESCE(b.job_version, j.version)
  FROM jobs j
 WHERE j.id = b.job_id AND (b.job_revision IS NULL OR b.job_version IS NULL);

-- ── job_revisions: append-only, monthly partitions ───────────────────────────
CREATE TABLE IF NOT EXISTS job_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  job_id UUID NOT NULL,
  version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  is_material BOOLEAN NOT NULL DEFAULT FALSE,
  source VARCHAR(20) NOT NULL
    CHECK (source IN ('owner', 'admin', 'rollback', 'change_order', 'system')),
  actor_id UUID,
  actor_role VARCHAR(30),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 1000),
  changes JSONB NOT NULL,
  snapshot JSONB,
  request_id VARCHAR(120),
  idempotency_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS job_revisions_default PARTITION OF job_revisions DEFAULT;
CREATE INDEX IF NOT EXISTS idx_job_revisions_job_created ON job_revisions (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_revisions_job_id_id ON job_revisions (job_id, id);
CREATE INDEX IF NOT EXISTS idx_job_revisions_idempotency
  ON job_revisions (job_id, actor_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Creates monthly partitions from the current month through months_ahead.
CREATE OR REPLACE FUNCTION ensure_job_revision_partitions(months_ahead INTEGER DEFAULT 3)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  start_month DATE := date_trunc('month', NOW())::date;
  m DATE;
  part_name TEXT;
  created INTEGER := 0;
BEGIN
  FOR i IN 0..GREATEST(months_ahead, 0) LOOP
    m := (start_month + make_interval(months => i))::date;
    part_name := 'job_revisions_' || to_char(m, 'YYYY_MM');
    IF to_regclass(part_name) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF job_revisions FOR VALUES FROM (%L) TO (%L)',
        part_name, m, (m + INTERVAL '1 month')::date
      );
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

SELECT ensure_job_revision_partitions(3);

-- ── job_event_outbox: transactional outbox for edit fan-out ──────────────────
CREATE TABLE IF NOT EXISTS job_event_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id UUID NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  coalesce_key VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  lease_token UUID,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_event_outbox_pending_coalesce
  ON job_event_outbox (coalesce_key)
  WHERE status = 'pending' AND coalesce_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_event_outbox_due
  ON job_event_outbox (next_attempt_at, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_job_event_outbox_stale
  ON job_event_outbox (locked_at) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS idx_job_event_outbox_sent
  ON job_event_outbox (sent_at) WHERE status IN ('sent', 'failed');

-- ── change orders: money application bookkeeping ─────────────────────────────
ALTER TABLE IF EXISTS work_agreement_change_orders
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_job_value_cents INTEGER,
  ADD COLUMN IF NOT EXISTS payment_adjustment JSONB;

-- ── payments: pending adjustment from approved change orders ─────────────────
ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS capture_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS pending_increase_cents INTEGER NOT NULL DEFAULT 0;

-- ── Feed, search, and bid indexes ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jobs_open_feed
  ON jobs (created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND status IN ('published', 'matched');
CREATE INDEX IF NOT EXISTS idx_jobs_open_category_feed
  ON jobs (category_name, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND status IN ('published', 'matched');
CREATE INDEX IF NOT EXISTS idx_jobs_open_location
  ON jobs USING GIST (location_point)
  WHERE deleted_at IS NULL AND status IN ('published', 'matched');
CREATE INDEX IF NOT EXISTS idx_jobs_open_city_fallback
  ON jobs (LOWER(location_city), LOWER(location_state))
  WHERE deleted_at IS NULL AND status IN ('published', 'matched') AND location_point IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_open_budget_max
  ON jobs (budget_max_cents DESC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL AND status IN ('published', 'matched');
CREATE INDEX IF NOT EXISTS idx_jobs_open_budget_min
  ON jobs (budget_min_cents ASC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL AND status IN ('published', 'matched');
CREATE INDEX IF NOT EXISTS idx_jobs_search_document
  ON jobs USING GIN (search_document);
CREATE INDEX IF NOT EXISTS idx_jobs_city_trgm
  ON jobs USING GIN (location_city gin_trgm_ops)
  WHERE deleted_at IS NULL AND status IN ('published', 'matched');
CREATE INDEX IF NOT EXISTS idx_jobs_client_status_created
  ON jobs (client_id, status, created_at DESC);
-- Bid lists show each helper's completed-job count per row.
CREATE INDEX IF NOT EXISTS idx_jobs_helper_status
  ON jobs (assigned_helper_id, status) WHERE assigned_helper_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bids_job_status ON bids (job_id, status);
CREATE INDEX IF NOT EXISTS idx_bids_job_pending_helper
  ON bids (job_id, helper_id) WHERE status = 'pending';

-- Duplicates: 012/013 recreated indexes 001 already had under new names, and
-- UNIQUE (job_id, helper_id) / idx_bids_job_status already lead with job_id.
DROP INDEX IF EXISTS idx_jobs_client_id;
DROP INDEX IF EXISTS idx_jobs_assigned_helper_id;
DROP INDEX IF EXISTS idx_jobs_created_at;
DROP INDEX IF EXISTS idx_bids_job_id;
DROP INDEX IF EXISTS idx_bids_job;
DROP INDEX IF EXISTS idx_bids_helper_id;
