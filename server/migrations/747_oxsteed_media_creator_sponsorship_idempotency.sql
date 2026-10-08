-- 747: replay-safe creator sponsorship offers.
-- The key is scoped to the sponsor so a lost response cannot create a second
-- offer, while NULL preserves compatibility for historical rows.

ALTER TABLE media_creator_sponsorships
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_creator_sponsorships_sponsor_idempotency
  ON media_creator_sponsorships(sponsor_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
