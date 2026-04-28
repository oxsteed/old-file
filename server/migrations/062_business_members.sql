-- Migration 062: Business members (representatives & managers)
-- Allows a helper who owns a business to invite other OxSteed users
-- to represent or manage that business on their behalf.
--
-- Role semantics:
--   manager      — full access to the business dashboard, invoices, and
--                  customer conversations on behalf of the business.
--   representative — can handle customer chat / job acceptance only;
--                   no access to financial data.
--
-- Invite flow:
--   1. Owner POSTs /api/businesses/:id/members with { email, role }.
--   2. If the email matches an existing user, member_id is set and a
--      notification is sent. Otherwise the record is pending email only.
--   3. The invitee calls POST /api/businesses/invitations/:id/accept.
--   4. Owner can revoke any time → status = 'revoked'.

CREATE TABLE IF NOT EXISTS business_members (
  id           BIGSERIAL    PRIMARY KEY,
  business_id  INT          NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  owner_id     UUID         NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  -- NULL until the invitee accepts (or if invited by email not yet registered)
  member_id    UUID         REFERENCES users(id) ON DELETE CASCADE,
  role         VARCHAR(30)  NOT NULL DEFAULT 'representative'
                 CHECK (role IN ('manager', 'representative')),
  invite_email VARCHAR(255) NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'revoked')),
  invited_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One active record per (business, member) pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_biz_members_unique
  ON business_members (business_id, member_id)
  WHERE member_id IS NOT NULL AND status != 'revoked';

-- One pending invite per (business, email) — prevents spam
CREATE UNIQUE INDEX IF NOT EXISTS idx_biz_members_pending_email
  ON business_members (business_id, invite_email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_biz_members_business
  ON business_members (business_id);

CREATE INDEX IF NOT EXISTS idx_biz_members_member
  ON business_members (member_id)
  WHERE member_id IS NOT NULL;
