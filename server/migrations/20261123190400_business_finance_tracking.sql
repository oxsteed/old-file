-- Groups 5-6 items 233 (payout reconciliation) and 234 (expense categories).
CREATE TABLE IF NOT EXISTS business_expense_categories (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  base_category TEXT NOT NULL CHECK (base_category IN ('materials','labor','vehicle','software','marketing','equipment','utilities','other')),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_expense_categories_name_uq ON business_expense_categories (business_id, LOWER(name));
ALTER TABLE business_expenses ADD COLUMN IF NOT EXISTS custom_category_id BIGINT REFERENCES business_expense_categories(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS business_payout_deposits (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  deposited_on DATE NOT NULL,
  reference TEXT CHECK (reference IS NULL OR char_length(reference) <= 100),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_payout_deposits_biz ON business_payout_deposits (business_id, deposited_on DESC);
CREATE TABLE IF NOT EXISTS business_payout_deposit_items (
  id BIGSERIAL PRIMARY KEY,
  deposit_id BIGINT NOT NULL REFERENCES business_payout_deposits(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('invoice','appointment')),
  source_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  UNIQUE (business_id, source, source_id)
);
