-- S-20: labor rules for minors and Fair Workweek schedule changes.
--
-- Minor status is stored as a band plus the date it ends (the 18th
-- birthday or the 16th for the under-16 band), never a date of birth.
CREATE TABLE IF NOT EXISTS business_staff_labor_profiles (
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  minor_band TEXT CHECK (minor_band IN ('under_16','age_16_17')),
  minor_until DATE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, user_id),
  CHECK ((minor_band IS NULL) = (minor_until IS NULL))
);

-- Changes to an already-published shift. Inside the jurisdiction's notice
-- window an employer-initiated change owes predictability pay; the row is
-- the evidence and the payroll export input.
CREATE TABLE IF NOT EXISTS business_staff_schedule_changes (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  shift_id BIGINT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  restaurant_id BIGINT,
  location_id BIGINT,
  change_type TEXT NOT NULL CHECK (change_type IN ('edited','deleted')),
  before_state JSONB NOT NULL,
  after_state JSONB,
  hours_before_start NUMERIC(8,2),
  notice_hours INTEGER,
  jurisdiction_code TEXT,
  employee_requested BOOLEAN NOT NULL DEFAULT FALSE,
  premium_due BOOLEAN NOT NULL DEFAULT FALSE,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_staff_schedule_changes_business
  ON business_staff_schedule_changes(business_id, created_at DESC);
