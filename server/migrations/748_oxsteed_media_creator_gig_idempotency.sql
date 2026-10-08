-- 748: replay-safe creator gig creation.
ALTER TABLE media_creator_gigs
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_creator_gigs_owner_idempotency
  ON media_creator_gigs(owner_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
