-- Persist single-entitlement request keys so an admin retry cannot apply a
-- changed customer access payload to the same customer and agreement.
CREATE TABLE IF NOT EXISTS oxsteed_credit_entitlement_requests (
  idempotency_key VARCHAR(160) PRIMARY KEY,
  request_hash CHAR(64) NOT NULL,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agreement_id UUID NOT NULL REFERENCES oxsteed_credit_partner_agreements(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_entitlement_requests_customer
  ON oxsteed_credit_entitlement_requests(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_entitlement_requests_agreement
  ON oxsteed_credit_entitlement_requests(agreement_id, created_at DESC);
