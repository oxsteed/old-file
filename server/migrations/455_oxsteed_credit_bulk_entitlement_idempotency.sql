-- Persist bulk entitlement request keys so an admin retry cannot repeat a
-- multi-restaurant authorization with a different request body.
CREATE TABLE IF NOT EXISTS oxsteed_credit_entitlement_bulk_requests (
  idempotency_key VARCHAR(160) PRIMARY KEY,
  request_hash CHAR(64) NOT NULL,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agreement_ids UUID[] NOT NULL CHECK (cardinality(agreement_ids) > 0),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_entitlement_bulk_requests_customer
  ON oxsteed_credit_entitlement_bulk_requests(customer_id, created_at DESC);
