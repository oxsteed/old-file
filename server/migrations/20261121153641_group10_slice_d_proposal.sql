-- Group 10 Slice D (items 521-525): agree on work.
-- Engagement proposals on the business-launch referral
-- (consulting_requests), the inquiry the consultant actually receives.
-- A proposal is a versioned offer: scope, price, deliverable definitions
-- and scope exclusions, approved or rejected by the client. Versions are
-- immutable once sent; a new version supersedes the previous sent one.
-- All additions; nothing modified.
--
-- 521 Engagement proposal: consulting_engagement_proposals.
-- 522 Deliverable definitions: consulting_proposal_deliverables.
-- 523 Scope exclusions: consulting_proposal_exclusions.
-- 524 Client approval: status approve/reject on the sent version; approval
--     moves the referral to 'engaged'.
-- 525 Proposal version history: version numbers + superseded rows; the list
--     endpoint returns every version, newest first.

CREATE TABLE IF NOT EXISTS consulting_engagement_proposals (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES consulting_requests(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INT NOT NULL CHECK (version >= 1),
  title VARCHAR(255) NOT NULL,
  scope_summary TEXT,
  price_cents INT CHECK (price_cents IS NULL OR price_cents >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'withdrawn', 'superseded')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consulting_engagement_proposals_request_version_unique
    UNIQUE (request_id, version)
);

CREATE INDEX IF NOT EXISTS idx_consulting_proposals_request
  ON consulting_engagement_proposals(request_id, version DESC);

-- At most one sent proposal per referral: sending a new version supersedes
-- the previous sent one, so the client never faces two live offers.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consulting_proposals_one_sent
  ON consulting_engagement_proposals(request_id)
  WHERE status = 'sent';

CREATE TABLE IF NOT EXISTS consulting_proposal_deliverables (
  id BIGSERIAL PRIMARY KEY,
  proposal_id BIGINT NOT NULL REFERENCES consulting_engagement_proposals(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  deliverable_type VARCHAR(100)
    CHECK (deliverable_type IN ('sop', 'contract', 'financial_tracker', 'marketing_plan', 'team_structure', 'operational_manual', 'other')),
  due_date DATE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consulting_proposal_deliverables_proposal
  ON consulting_proposal_deliverables(proposal_id, sort_order);

CREATE TABLE IF NOT EXISTS consulting_proposal_exclusions (
  id BIGSERIAL PRIMARY KEY,
  proposal_id BIGINT NOT NULL REFERENCES consulting_engagement_proposals(id) ON DELETE CASCADE,
  exclusion_text TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consulting_proposal_exclusions_proposal
  ON consulting_proposal_exclusions(proposal_id, sort_order);
