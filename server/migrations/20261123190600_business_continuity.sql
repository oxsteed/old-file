-- Groups 5-6 items 241-245: ownership transfer, deputy, departed access, closure plan.
CREATE TABLE IF NOT EXISTS business_ownership_transfers (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id),
  to_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','awaiting_admin','completed','declined','cancelled','expired','rejected')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  admin_id UUID REFERENCES users(id),
  admin_note TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_user_id <> to_user_id),
  CHECK (admin_id IS NULL OR (admin_id <> from_user_id AND admin_id <> to_user_id))
);
CREATE UNIQUE INDEX IF NOT EXISTS business_ownership_transfers_open_uq ON business_ownership_transfers (business_id) WHERE status IN ('pending','awaiting_admin');

CREATE TABLE IF NOT EXISTS business_deputies (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  deputy_user_id UUID NOT NULL REFERENCES users(id),
  membership_id BIGINT NOT NULL REFERENCES business_members(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  granted_codes TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS business_deputies_biz ON business_deputies (business_id, ends_at DESC);

ALTER TABLE staff_offboarding_records ADD COLUMN IF NOT EXISTS former_access_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS business_closure_plans (
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  target_date DATE,
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 500),
  customer_message TEXT CHECK (customer_message IS NULL OR char_length(customer_message) <= 2000),
  export_confirmed_at TIMESTAMPTZ,
  export_confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
