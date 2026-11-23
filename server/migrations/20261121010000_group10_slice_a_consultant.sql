-- Migration 20261121010000: Group 10 Slice A (items 501-510) consultant qualify + present services
-- Adds a profile approval workflow to consultant_contractor_profiles and a
-- consultant portfolio table. Existing profiles are grandfathered to
-- 'approved': they were already operating under is_active, and re-reviewing
-- every working consultant on deploy would hide them from matching.
-- New profiles start 'pending' and are hidden from matching and the public
-- profile until an admin approves them.

ALTER TABLE consultant_contractor_profiles
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'declined')),
  ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_note TEXT;

UPDATE consultant_contractor_profiles
SET approval_status = 'approved'
WHERE approval_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_consultant_profiles_approval_status
  ON consultant_contractor_profiles(approval_status);

CREATE TABLE IF NOT EXISTS consultant_portfolio_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  link_url VARCHAR(500),
  image_url VARCHAR(500),
  visibility VARCHAR(20) NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'hidden')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultant_portfolio_items_owner
  ON consultant_portfolio_items(user_id, sort_order, created_at);
