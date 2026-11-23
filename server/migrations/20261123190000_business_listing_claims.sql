-- Groups 5-6 item 201: a business owner claims an imported directory listing
-- (prospect_businesses) for a business they own. Admin review decides; the
-- claim grants nothing until approved, and approval only links the listing.
CREATE TABLE IF NOT EXISTS business_listing_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id BIGINT NOT NULL REFERENCES prospect_businesses(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  claimant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('owner','officer','authorized_manager')),
  evidence TEXT NOT NULL CHECK (char_length(evidence) BETWEEN 20 AND 2000),
  contact_match BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (claimant_id, request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_listing_claims_one_open
  ON business_listing_claims (prospect_id, business_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS business_listing_claims_queue
  ON business_listing_claims (status, created_at);
