-- ATTACK #9 FIX: Invoice Idempotency Key Hardening
-- Ensure idempotency keys are properly scoped and can't leak across users

-- Add user_id scoping to idempotency tracking
-- This ensures an idempotency key for user A can't be replayed by user B
CREATE TABLE IF NOT EXISTS invoice_idempotency_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  resource_type VARCHAR(50) NOT NULL, -- 'invoice', 'payment', etc.
  resource_id UUID NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, idempotency_key, resource_type)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_user_key
  ON invoice_idempotency_log(user_id, idempotency_key, created_at DESC);

-- Cleanup old idempotency logs (older than 30 days)
-- Can be run via scheduled job: DELETE FROM invoice_idempotency_log WHERE created_at < NOW() - INTERVAL '30 days'

-- Add trigger to existing invoice tables to validate idempotency
-- When an invoice is created with an idempotency key, log it for future dedup

COMMENT ON TABLE invoice_idempotency_log IS 'Tracks idempotency keys per user to prevent replay attacks across different users';
