-- Agreement creation is an operator workflow and must replay safely after a
-- browser retry instead of silently creating another version.

ALTER TABLE oxsteed_credit_partner_agreements
  ADD COLUMN IF NOT EXISTS creation_idempotency_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS creation_request_hash CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_agreement_creation_idempotency
  ON oxsteed_credit_partner_agreements(creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;
