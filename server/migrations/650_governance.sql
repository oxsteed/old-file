-- Migration 650: market governance workspace (M5).
--
-- policy_rules: the registry of marketplace governance policies (code of
-- conduct, fraud, content moderation, dispute handling, etc.). This is an
-- admin CRUD registry only; it is separate from the mode-policy runtime
-- (ModePolicies) that actually enforces platform behavior.
--
-- contracts: records of executed vendor/partner/contractor agreements. A
-- records registry only: legal execution, signatures, and counsel review
-- stay operational and are not handled by this table.

CREATE TABLE IF NOT EXISTS policy_rules (
  id            BIGSERIAL    PRIMARY KEY,
  code          TEXT         NOT NULL UNIQUE,
  title         TEXT         NOT NULL,
  category      TEXT         NOT NULL,
  body          TEXT         NOT NULL,
  version       INTEGER      NOT NULL DEFAULT 1,
  status        TEXT         NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'retired')),
  effective_from DATE,
  created_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_rules_status
  ON policy_rules (status);

CREATE TABLE IF NOT EXISTS contracts (
  id            BIGSERIAL    PRIMARY KEY,
  counterparty  TEXT         NOT NULL,
  contract_type TEXT         NOT NULL,
  title         TEXT         NOT NULL,
  signed_at     DATE,
  expires_at    DATE,
  status        TEXT         NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  storage_ref   TEXT,
  notes         TEXT,
  created_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT contracts_expiry_not_before_signature
    CHECK (expires_at IS NULL OR signed_at IS NULL OR expires_at >= signed_at)
);

CREATE INDEX IF NOT EXISTS idx_contracts_status
  ON contracts (status);
