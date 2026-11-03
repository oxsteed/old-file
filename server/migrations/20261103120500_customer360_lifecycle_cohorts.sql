-- Customer 360 upgrade 7: lifecycle stage per customer and country cohort
-- comparison. Stages are derived (never entered by hand) from signup date
-- and transaction history; cohorts are (country, signup month). Aggregates
-- are precomputed so comparisons stay cheap at platform scale, and small
-- cells are suppressed when read.

CREATE TABLE IF NOT EXISTS customer_lifecycle (
  customer_id          UUID PRIMARY KEY,
  model_version        VARCHAR(40) NOT NULL,
  stage                VARCHAR(20) NOT NULL
    CHECK (stage IN ('new', 'never_activated', 'active', 'lapsing', 'dormant', 'closed')),
  country              VARCHAR(2)  NOT NULL,
  cohort_month         DATE        NOT NULL,
  first_transaction_at TIMESTAMPTZ,
  last_transaction_at  TIMESTAMPTZ,
  transactions_90d     INTEGER     NOT NULL DEFAULT 0 CHECK (transactions_90d >= 0),
  stage_since          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_lifecycle_month CHECK (cohort_month = date_trunc('month', cohort_month)::date)
);
CREATE INDEX IF NOT EXISTS customer_lifecycle_cohort_idx
  ON customer_lifecycle (country, cohort_month, stage);
CREATE INDEX IF NOT EXISTS customer_lifecycle_stale_idx
  ON customer_lifecycle (computed_at);

CREATE TABLE IF NOT EXISTS customer_cohort_stats (
  country        VARCHAR(2)  NOT NULL,
  cohort_month   DATE        NOT NULL,
  stage          VARCHAR(20) NOT NULL,
  customers      INTEGER     NOT NULL CHECK (customers >= 0),
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (country, cohort_month, stage)
);

-- Lookups the batched lifecycle computation relies on.
CREATE INDEX IF NOT EXISTS idx_payments_payer_created
  ON payments (payer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_orders_customer_created
  ON food_orders (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
