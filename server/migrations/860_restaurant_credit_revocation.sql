-- Migration 860: restaurant credit approvals + revocation migrations
-- (Phase 6 of the restaurant credit protection system: the revocation path).
--
-- restaurant_credit_approvals is the platform's per-restaurant approval to
-- offer credit. A restaurant with NO row here is treated as 'approved'
-- (grandfathering: existing behavior keeps working until an admin acts).
-- A 'pending' row means the restaurant has never been approved and is
-- blocked from issuing new credit, same as 'suspended'/'revoked' (fail
-- closed). Only 'revoked' starts the 30-day grace clock; 'suspended' is
-- reversible and does not touch the grace clock.
--
-- restaurant_credit_migrations is the audit ledger for the grace-period
-- auto-migration worker: each row records one customer's restaurant wallet
-- balance moved into OxSteed Credit (via the audited conversion_out
-- dual-posting path) when a revoked restaurant's grace period ends.
-- 'failed' rows leave the customer balance untouched so the worker can
-- retry; they never overwrite a 'completed' row.

CREATE TABLE IF NOT EXISTS restaurant_credit_approvals (
  restaurant_id BIGINT PRIMARY KEY REFERENCES food_restaurants(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'suspended', 'revoked')),
  approved_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason VARCHAR(500),
  grace_period_ends_at TIMESTAMPTZ,
  migrated_at TIMESTAMPTZ,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_credit_approvals_due_migration
  ON restaurant_credit_approvals (status, grace_period_ends_at)
  WHERE migrated_at IS NULL;

CREATE TABLE IF NOT EXISTS restaurant_credit_migrations (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  wallet_ledger_entry_id BIGINT REFERENCES food_customer_wallet_ledger(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed')),
  failure_code VARCHAR(80),
  failure_message VARCHAR(500),
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  migrated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_credit_migrations_restaurant_migrated
  ON restaurant_credit_migrations (restaurant_id, migrated_at);
