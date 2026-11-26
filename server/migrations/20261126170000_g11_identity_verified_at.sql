-- G11-A4 (D-605): the identity flags carry a timestamp so the 2-year
-- TTL applies to them. Stripe Identity sets identity_verified /
-- id_verified with no timestamp, so the flags alone bypassed the Didit
-- freshness check in rentalIdentityStatus; from here a flag counts only
-- while its verification time is fresh. The column itself dates to
-- migration 001 and sat unwritten until now; this migration only
-- backfills it. Backfill: a Didit-verified user keeps the Didit
-- approval time (the same instant the flag was set).
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ;

UPDATE users
   SET identity_verified_at = didit_verified_at
 WHERE didit_status = 'verified'
   AND didit_verified_at IS NOT NULL
   AND identity_verified_at IS NULL;
