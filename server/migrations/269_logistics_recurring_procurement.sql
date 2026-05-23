-- 269_logistics_recurring_procurement.sql
-- Lightweight recurring procurement programs for the OxSteed Logistics branch.

CREATE TABLE IF NOT EXISTS logistics_recurring_procurement_programs (
  id                   SERIAL PRIMARY KEY,
  business_id          INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  owner_user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lane_id              INTEGER REFERENCES logistics_lanes(id),
  sourcing_request_id  INTEGER REFERENCES sourcing_requests(id) ON DELETE SET NULL,
  title                VARCHAR(240) NOT NULL,
  category             VARCHAR(120),
  description          TEXT,
  cadence              VARCHAR(40) NOT NULL DEFAULT 'monthly',
  target_qty           INTEGER,
  target_unit          VARCHAR(40) DEFAULT 'unit',
  preferred_freight    freight_option,
  destination_country  CHAR(2),
  destination_city     VARCHAR(100),
  budget_max_usd       NUMERIC(12,2),
  status               VARCHAR(30) NOT NULL DEFAULT 'draft', -- draft,active,paused,archived
  next_run_date        DATE,
  last_run_date        DATE,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logistics_recurring_procurement_business
  ON logistics_recurring_procurement_programs(business_id);

CREATE INDEX IF NOT EXISTS idx_logistics_recurring_procurement_owner
  ON logistics_recurring_procurement_programs(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_logistics_recurring_procurement_status
  ON logistics_recurring_procurement_programs(status, next_run_date);
