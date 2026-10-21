-- Migration 985: restaurant accounting integration contracts.
-- Provider credentials remain runtime-only Secrets Manager dynamic references;
-- this schema never stores OAuth plaintext. Journal exports are durable,
-- idempotent outbox rows so a future QuickBooks/Xero worker can post and
-- reconcile without duplicating a period.

CREATE TABLE IF NOT EXISTS restaurant_accounting_integrations (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('quickbooks', 'xero')),
  status VARCHAR(20) NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'configured', 'active', 'paused', 'error')),
  external_company_id VARCHAR(180),
  access_token_ref TEXT,
  refresh_token_ref TEXT,
  token_expires_at TIMESTAMPTZ,
  account_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_export_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, provider),
  UNIQUE (restaurant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_accounting_integrations_status
  ON restaurant_accounting_integrations(restaurant_id, status);

CREATE TABLE IF NOT EXISTS restaurant_accounting_exports (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL,
  integration_id BIGINT NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  currency_code VARCHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  idempotency_key VARCHAR(180) NOT NULL,
  status VARCHAR(28) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'posted', 'failed', 'requires_reconciliation')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_batch_id VARCHAR(180),
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token UUID,
  leased_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (integration_id, idempotency_key),
  FOREIGN KEY (restaurant_id, integration_id)
    REFERENCES restaurant_accounting_integrations(restaurant_id, id)
    ON DELETE CASCADE,
  CHECK (period_from <= period_to)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_accounting_exports_queue
  ON restaurant_accounting_exports(status, leased_at, created_at);
CREATE INDEX IF NOT EXISTS idx_restaurant_accounting_exports_restaurant
  ON restaurant_accounting_exports(restaurant_id, period_from, period_to);
