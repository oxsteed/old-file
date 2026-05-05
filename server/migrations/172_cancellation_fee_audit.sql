-- Migration 172: Cancellation Fee Records, Audit Log & User Restrictions
-- Supports Phase 2: moral accountability layer for job cancellations

-- ─── Cancellation Audit Log ───────────────────────────────────────────────────
-- Every cancellation (customer or helper) writes a row here for dispute/audit
CREATE TABLE IF NOT EXISTS cancellation_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cancelled_by_id UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cancelled_by_role VARCHAR(10) NOT NULL CHECK (cancelled_by_role IN ('customer','helper')),
  counterparty_id UUID   REFERENCES users(id) ON DELETE SET NULL,

  -- Fee details (customer cancellations only)
  fee_reason      VARCHAR(50) DEFAULT NULL,  -- 'customer_initiated_fee' | 'helper_initiated_no_fee' | 'no_fee_advance'
  fee_amount_cents INTEGER DEFAULT 0,
  fee_status      VARCHAR(20) DEFAULT 'none', -- 'none' | 'pending' | 'collected' | 'waived'

  -- Context
  hours_before_start DECIMAL(8,2) DEFAULT NULL,  -- negative means after scheduled time
  cancellation_reason TEXT DEFAULT NULL,
  payment_method  VARCHAR(50) DEFAULT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cancel_audit_job        ON cancellation_audit_log(job_id);
CREATE INDEX IF NOT EXISTS idx_cancel_audit_by         ON cancellation_audit_log(cancelled_by_id);
CREATE INDEX IF NOT EXISTS idx_cancel_audit_counterparty ON cancellation_audit_log(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_cancel_audit_fee_status ON cancellation_audit_log(fee_status) WHERE fee_status != 'none';
CREATE INDEX IF NOT EXISTS idx_cancel_audit_created_at ON cancellation_audit_log(created_at);

-- ─── Cancellation Fees ────────────────────────────────────────────────────────
-- Tracks actual fee transfers from customer → helper
CREATE TABLE IF NOT EXISTS cancellation_fees (
  id              BIGSERIAL PRIMARY KEY,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  audit_log_id    BIGINT REFERENCES cancellation_audit_log(id) ON DELETE SET NULL,

  -- Parties
  payer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- customer
  payee_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- helper

  -- Amounts (all in cents)
  gross_fee_cents   INTEGER NOT NULL,   -- total charged to customer
  helper_gets_cents INTEGER NOT NULL,   -- after platform cut
  platform_cut_cents INTEGER NOT NULL,  -- platform portion
  stripe_fee_cents  INTEGER NOT NULL DEFAULT 0,  -- estimated Stripe fees

  -- Status
  status          VARCHAR(20) DEFAULT 'pending',  -- 'pending' | 'collected' | 'failed' | 'refunded' | 'waived'
  stripe_charge_id  VARCHAR(255) DEFAULT NULL,    -- populated after Stripe charge
  failure_reason    TEXT DEFAULT NULL,

  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  collected_at    TIMESTAMPTZ DEFAULT NULL,
  refunded_at     TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_cancel_fees_job     ON cancellation_fees(job_id);
CREATE INDEX IF NOT EXISTS idx_cancel_fees_payer   ON cancellation_fees(payer_id);
CREATE INDEX IF NOT EXISTS idx_cancel_fees_payee   ON cancellation_fees(payee_id);
CREATE INDEX IF NOT EXISTS idx_cancel_fees_status  ON cancellation_fees(status);

-- ─── User Restrictions ────────────────────────────────────────────────────────
-- Granular restrictions applied by enforcement system (separate from account suspension)
CREATE TABLE IF NOT EXISTS user_restrictions (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enforcement_id  BIGINT REFERENCES enforcement_actions(id) ON DELETE SET NULL,

  -- Restriction type
  restriction_type VARCHAR(50) NOT NULL,
  -- Values: 'bidding' | 'job_posting' | 'checkout' | 'all'

  -- Active window
  is_active       BOOLEAN DEFAULT TRUE,
  starts_at       TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ DEFAULT NULL,   -- NULL = indefinite

  -- Audit
  issued_by_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT NOT NULL,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_restrictions_user    ON user_restrictions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_restrictions_active  ON user_restrictions(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_restrictions_expires ON user_restrictions(expires_at) WHERE is_active = TRUE AND expires_at IS NOT NULL;

-- ─── Suspension tracking on users table ───────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended     BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until  TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_suspended ON users(is_suspended) WHERE is_suspended = TRUE;
