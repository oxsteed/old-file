-- 746: Durable Media creator payment state.
-- Offers remain non-monetary until the guarded Credit rail reserves or posts
-- the amount. Every payment row keeps its own idempotent transaction link.

ALTER TABLE media_creator_sponsorships
  ADD COLUMN IF NOT EXISTS credit_reservation_id UUID
    REFERENCES oxsteed_credit_reservations(id) ON DELETE SET NULL;

ALTER TABLE media_creator_sponsorships
  ADD COLUMN IF NOT EXISTS credit_transaction_id UUID
    REFERENCES oxsteed_credit_transactions(id) ON DELETE SET NULL;

ALTER TABLE media_creator_sponsorships
  ADD COLUMN IF NOT EXISTS delivery_post_id UUID
    REFERENCES media_posts(id) ON DELETE SET NULL;

ALTER TABLE media_creator_sponsorships
  ADD COLUMN IF NOT EXISTS delivery_note TEXT;

ALTER TABLE media_creator_tips
  ADD COLUMN IF NOT EXISTS credit_transaction_id UUID
    REFERENCES oxsteed_credit_transactions(id) ON DELETE SET NULL;

ALTER TABLE media_post_boosts
  ADD COLUMN IF NOT EXISTS credit_transaction_id UUID
    REFERENCES oxsteed_credit_transactions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_creator_sponsorships_credit_transaction
  ON media_creator_sponsorships(credit_transaction_id)
  WHERE credit_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_creator_sponsorships_reservation
  ON media_creator_sponsorships(credit_reservation_id)
  WHERE credit_reservation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_creator_tips_credit_transaction
  ON media_creator_tips(credit_transaction_id)
  WHERE credit_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_post_boosts_credit_transaction
  ON media_post_boosts(credit_transaction_id)
  WHERE credit_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_creator_sponsorships_delivery
  ON media_creator_sponsorships(delivery_post_id)
  WHERE delivery_post_id IS NOT NULL;
