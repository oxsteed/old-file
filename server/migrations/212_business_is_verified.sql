-- Migration 212: Add is_business_verified flag to businesses table
-- Businesses get their own verification badge instead of inheriting
-- is_background_checked / is_identity_verified from the owner's helper profile.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS is_business_verified BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark existing businesses as verified if the owner's
-- helper profile was background-checked AND identity-verified.
UPDATE businesses b
SET    is_business_verified = TRUE
FROM   helper_profiles hp
WHERE  hp.user_id = b.user_id
  AND  hp.is_background_checked = TRUE
  AND  hp.is_identity_verified  = TRUE;

COMMENT ON COLUMN businesses.is_business_verified IS
  'Set by admin once the business entity has been verified. Replaces the individual background-check / ID-verify badges shown on the public profile.';
