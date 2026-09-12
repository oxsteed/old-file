-- Migration 421: OxSteed Credit foundation.
--
-- OxSteed Credit is a separate stored-value rail from the existing
-- restaurant-scoped customer wallets. A customer account can spend only
-- through an active partner agreement; journal transactions always move
-- value between two internal accounts.

CREATE TABLE IF NOT EXISTS oxsteed_credit_partners (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL UNIQUE REFERENCES food_restaurants(id) ON DELETE RESTRICT,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  settlement_currency_code CHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (settlement_currency_code ~ '^[A-Z]{3}$'),
  settlement_terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_partners_status
  ON oxsteed_credit_partners(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS oxsteed_credit_partner_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id BIGINT NOT NULL REFERENCES oxsteed_credit_partners(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'active', 'suspended', 'expired', 'terminated')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  customer_terms TEXT,
  allowed_order_types TEXT[] NOT NULL DEFAULT ARRAY['pickup', 'delivery', 'dine_in']::TEXT[],
  allowed_categories TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  allowed_menu_item_ids BIGINT[],
  geography JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_transaction_cents BIGINT CHECK (max_transaction_cents IS NULL OR max_transaction_cents > 0),
  daily_customer_limit_cents BIGINT CHECK (daily_customer_limit_cents IS NULL OR daily_customer_limit_cents > 0),
  lifetime_customer_limit_cents BIGINT CHECK (lifetime_customer_limit_cents IS NULL OR lifetime_customer_limit_cents > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  UNIQUE (partner_id, version)
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_agreements_partner_status
  ON oxsteed_credit_partner_agreements(partner_id, status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS oxsteed_credit_customer_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agreement_id UUID NOT NULL REFERENCES oxsteed_credit_partner_agreements(id) ON DELETE RESTRICT,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked', 'expired')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  max_transaction_cents BIGINT CHECK (max_transaction_cents IS NULL OR max_transaction_cents > 0),
  daily_limit_cents BIGINT CHECK (daily_limit_cents IS NULL OR daily_limit_cents > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  UNIQUE (customer_id, agreement_id)
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_entitlements_customer_status
  ON oxsteed_credit_customer_entitlements(customer_id, status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_entitlements_agreement_status
  ON oxsteed_credit_customer_entitlements(agreement_id, status, starts_at, ends_at);

-- One account table supports strict journal movement between customer,
-- partner-payable, and platform clearing/revenue accounts.
CREATE TABLE IF NOT EXISTS oxsteed_credit_accounts (
  id BIGSERIAL PRIMARY KEY,
  account_type VARCHAR(32) NOT NULL
    CHECK (account_type IN ('customer_wallet', 'partner_payable', 'platform_treasury', 'platform_revenue')),
  customer_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  partner_id BIGINT REFERENCES oxsteed_credit_partners(id) ON DELETE RESTRICT,
  currency_code CHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (currency_code ~ '^[A-Z]{3}$'),
  -- Customer balances cannot go below zero. Partner payables and platform
  -- clearing accounts may be negative so post-settlement refunds remain
  -- representable as a receivable instead of being silently rejected.
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (
    balance_cents >= 0
    OR account_type IN ('partner_payable', 'platform_treasury', 'platform_revenue')
  ),
  reserved_cents BIGINT NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  ledger_version BIGINT NOT NULL DEFAULT 0 CHECK (ledger_version >= 0),
  last_entry_hash TEXT,
  last_posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (account_type = 'customer_wallet' AND customer_id IS NOT NULL AND partner_id IS NULL)
    OR (account_type = 'partner_payable' AND customer_id IS NULL AND partner_id IS NOT NULL)
    OR (account_type IN ('platform_treasury', 'platform_revenue') AND customer_id IS NULL AND partner_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_customer_account
  ON oxsteed_credit_accounts(customer_id, currency_code)
  WHERE account_type = 'customer_wallet';
CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_partner_account
  ON oxsteed_credit_accounts(partner_id, currency_code)
  WHERE account_type = 'partner_payable';
CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_platform_account
  ON oxsteed_credit_accounts(account_type, currency_code)
  WHERE account_type IN ('platform_treasury', 'platform_revenue');
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_accounts_customer
  ON oxsteed_credit_accounts(customer_id, status, updated_at DESC)
  WHERE account_type = 'customer_wallet';
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_accounts_partner
  ON oxsteed_credit_accounts(partner_id, status, updated_at DESC)
  WHERE account_type = 'partner_payable';

CREATE TABLE IF NOT EXISTS oxsteed_credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type VARCHAR(32) NOT NULL
    CHECK (transaction_type IN ('load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement', 'fee', 'expiration', 'chargeback')),
  status VARCHAR(20) NOT NULL DEFAULT 'posted'
    CHECK (status IN ('pending', 'posted', 'reversed', 'voided')),
  debit_account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  credit_account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  partner_id BIGINT REFERENCES oxsteed_credit_partners(id) ON DELETE RESTRICT,
  agreement_id UUID REFERENCES oxsteed_credit_partner_agreements(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(160) NOT NULL,
  correlation_id VARCHAR(160),
  reference_type VARCHAR(80),
  reference_id VARCHAR(160),
  description VARCHAR(255),
  actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  posted_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (debit_account_id <> credit_account_id),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_transactions_partner
  ON oxsteed_credit_transactions(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_transactions_agreement
  ON oxsteed_credit_transactions(agreement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_transactions_reference
  ON oxsteed_credit_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_transactions_customer_accounts
  ON oxsteed_credit_transactions(debit_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_transactions_credit_accounts
  ON oxsteed_credit_transactions(credit_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oxsteed_credit_transaction_entries (
  id BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  entry_side VARCHAR(8) NOT NULL CHECK (entry_side IN ('debit', 'credit')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  balance_after_cents BIGINT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  previous_entry_hash TEXT,
  entry_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, account_id, entry_side),
  UNIQUE (account_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_entries_transaction
  ON oxsteed_credit_transaction_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_entries_account
  ON oxsteed_credit_transaction_entries(account_id, sequence DESC);

-- Holds reserve spendable customer value without posting a purchase.
CREATE TABLE IF NOT EXISTS oxsteed_credit_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  partner_id BIGINT NOT NULL REFERENCES oxsteed_credit_partners(id) ON DELETE RESTRICT,
  agreement_id UUID NOT NULL REFERENCES oxsteed_credit_partner_agreements(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'captured', 'released', 'expired')),
  purpose VARCHAR(100),
  reference_type VARCHAR(80),
  reference_id VARCHAR(160),
  idempotency_key VARCHAR(160) NOT NULL,
  correlation_id VARCHAR(160),
  captured_transaction_id UUID REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  capture_idempotency_key VARCHAR(160) UNIQUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_holds_account_status
  ON oxsteed_credit_holds(account_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_holds_partner
  ON oxsteed_credit_holds(partner_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS oxsteed_credit_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id BIGINT NOT NULL REFERENCES oxsteed_credit_partners(id) ON DELETE RESTRICT,
  agreement_id UUID NOT NULL REFERENCES oxsteed_credit_partner_agreements(id) ON DELETE RESTRICT,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  gross_cents BIGINT NOT NULL DEFAULT 0 CHECK (gross_cents >= 0),
  refund_cents BIGINT NOT NULL DEFAULT 0 CHECK (refund_cents >= 0),
  fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  net_cents BIGINT NOT NULL DEFAULT 0 CHECK (net_cents >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'paid', 'disputed', 'voided')),
  payment_reference VARCHAR(160),
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end > period_start),
  CHECK (net_cents = GREATEST(0, gross_cents - refund_cents - fee_cents)
         OR status IN ('pending', 'voided'))
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_settlements_partner_period
  ON oxsteed_credit_settlements(partner_id, period_end DESC);

CREATE TABLE IF NOT EXISTS oxsteed_credit_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'balanced', 'difference', 'failed')),
  account_balance_cents BIGINT NOT NULL DEFAULT 0,
  journal_balance_cents BIGINT NOT NULL DEFAULT 0,
  difference_cents BIGINT NOT NULL DEFAULT 0,
  account_count INTEGER NOT NULL DEFAULT 0,
  entry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (period_end > period_start),
  UNIQUE (currency_code, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS oxsteed_credit_audit_events (
  id BIGSERIAL PRIMARY KEY,
  action_type VARCHAR(80) NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  partner_id BIGINT REFERENCES oxsteed_credit_partners(id) ON DELETE SET NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(160) NOT NULL,
  reason TEXT,
  correlation_id VARCHAR(160),
  request_ip INET,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_audit_resource
  ON oxsteed_credit_audit_events(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_audit_customer
  ON oxsteed_credit_audit_events(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_audit_partner
  ON oxsteed_credit_audit_events(partner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oxsteed_credit_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  partner_id BIGINT REFERENCES oxsteed_credit_partners(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_review', 'resolved', 'rejected')),
  reason_code VARCHAR(60) NOT NULL,
  description TEXT NOT NULL,
  resolution TEXT,
  opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, transaction_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_active_dispute
  ON oxsteed_credit_disputes(transaction_id)
  WHERE status IN ('open', 'in_review');
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_disputes_customer
  ON oxsteed_credit_disputes(customer_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_disputes_partner
  ON oxsteed_credit_disputes(partner_id, status, opened_at DESC);

-- Credit journal rows and control-plane audit rows are append-only. Corrections
-- must be represented by a compensating transaction or a new audit event.
CREATE OR REPLACE RULE oxsteed_credit_entries_no_update AS
  ON UPDATE TO oxsteed_credit_transaction_entries DO INSTEAD NOTHING;
CREATE OR REPLACE RULE oxsteed_credit_entries_no_delete AS
  ON DELETE TO oxsteed_credit_transaction_entries DO INSTEAD NOTHING;
CREATE OR REPLACE RULE oxsteed_credit_audit_no_update AS
  ON UPDATE TO oxsteed_credit_audit_events DO INSTEAD NOTHING;
CREATE OR REPLACE RULE oxsteed_credit_audit_no_delete AS
  ON DELETE TO oxsteed_credit_audit_events DO INSTEAD NOTHING;
