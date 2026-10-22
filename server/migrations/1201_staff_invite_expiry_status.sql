-- Migration 1201: S-10 invite expiry lifecycle.
--
-- Adds 'expired' to business_members.status so the expiry sweeper (and
-- the manual "expire now" action) can mark lapsed pending invites
-- distinctly from manager-revoked ones. Accept/deny/revoke paths all
-- filter on status = 'pending', so expired invites are inert by
-- construction; listMyInvitations additionally gates on expires_at.
--
-- Additive only. Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'business_members'::regclass
       AND conname = 'business_members_status_check'
  ) THEN
    ALTER TABLE business_members DROP CONSTRAINT business_members_status_check;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'business_members'::regclass
       AND conname = 'business_members_status_check'
  ) THEN
    ALTER TABLE business_members
      ADD CONSTRAINT business_members_status_check
      CHECK (status IN ('pending', 'active', 'revoked', 'expired'));
  END IF;
END $$;
