-- Groups 5-6 items 226 (approval thresholds), 227 (work authorization
-- policy), 228 (cancellation settings). Additive and idempotent; absent rows
-- mean "no threshold / no extra authorization / existing service defaults".
CREATE TABLE IF NOT EXISTS business_operating_policies (
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  quote_approval_cents INTEGER CHECK (quote_approval_cents IS NULL OR quote_approval_cents > 0),
  expense_approval_cents INTEGER CHECK (expense_approval_cents IS NULL OR expense_approval_cents > 0),
  refund_approval_cents INTEGER CHECK (refund_approval_cents IS NULL OR refund_approval_cents > 0),
  work_start_requires TEXT NOT NULL DEFAULT 'none' CHECK (work_start_requires IN ('none','confirmed_booking','accepted_quote')),
  work_start_min_role TEXT NOT NULL DEFAULT 'employee' CHECK (work_start_min_role IN ('employee','representative','manager','owner')),
  default_cancellation_fee_percent INTEGER NOT NULL DEFAULT 0 CHECK (default_cancellation_fee_percent BETWEEN 0 AND 100),
  no_show_fee_percent INTEGER NOT NULL DEFAULT 0 CHECK (no_show_fee_percent BETWEEN 0 AND 100),
  version INTEGER NOT NULL DEFAULT 0,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS business_operating_policy_history (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, version)
);
ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS approved_total_cents INTEGER;
ALTER TABLE business_expenses ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE business_expenses ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE business_expenses ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ;
ALTER TABLE business_expenses ADD COLUMN IF NOT EXISTS approval_note TEXT;
DO $$ BEGIN
  ALTER TABLE business_expenses ADD CONSTRAINT business_expenses_approval_status_check CHECK (approval_status IN ('approved','pending','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
