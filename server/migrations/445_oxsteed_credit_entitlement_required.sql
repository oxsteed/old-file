-- Allow an agreement to be either partner-wide or explicitly customer-allowlisted.
-- Existing agreements remain partner-wide for backward compatibility.
ALTER TABLE oxsteed_credit_partner_agreements
  ADD COLUMN IF NOT EXISTS requires_customer_entitlement BOOLEAN NOT NULL DEFAULT FALSE;
