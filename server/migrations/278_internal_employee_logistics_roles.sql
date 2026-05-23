-- Internal employee support for corporate assignments and logistics workspaces.

DO $$
BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'employee';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS logistics_role TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_logistics_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_logistics_role_check
      CHECK (
        logistics_role IS NULL OR logistics_role IN (
          'individual_buyer',
          'business_buyer',
          'organizer',
          'reseller',
          'franchise_buyer',
          'sourcing_operator',
          'logistics_coordinator',
          'warehouse_operator',
          'compliance_reviewer',
          'admin',
          'super_admin'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_logistics_role
  ON users(logistics_role)
  WHERE logistics_role IS NOT NULL;
