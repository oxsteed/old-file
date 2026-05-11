-- Tool rental peer agreement / liability clarity
-- Keeps OxSteed as a facilitator while capturing owner/renter acknowledgements.

ALTER TABLE tool_rentals
  ADD COLUMN IF NOT EXISTS owner_rules TEXT,
  ADD COLUMN IF NOT EXISTS owner_custom_terms TEXT,
  ADD COLUMN IF NOT EXISTS owner_custom_terms_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS replacement_value NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS owner_attested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_attestation_version VARCHAR(50);

ALTER TABLE tool_rentals_bookings
  ADD COLUMN IF NOT EXISTS agreement_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS renter_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renter_agreement_version VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_tool_rentals_owner_attested
  ON tool_rentals(owner_attested_at)
  WHERE owner_attested_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tool_bookings_renter_ack
  ON tool_rentals_bookings(renter_acknowledged_at)
  WHERE renter_acknowledged_at IS NOT NULL;
