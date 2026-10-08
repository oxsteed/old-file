-- Reserve creator-gig funds when an application is awarded and keep the
-- reservation linked to the gig until an approved deliverable settles it.
-- The shared Credit reservation table remains the source of truth for the
-- account reservation; these columns make the marketplace transition
-- idempotent and auditable from its own rows.

ALTER TABLE media_creator_gigs
  ADD COLUMN IF NOT EXISTS award_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS credit_reservation_id UUID
    REFERENCES oxsteed_credit_reservations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credit_transaction_id UUID
    REFERENCES oxsteed_credit_transactions(id) ON DELETE SET NULL;

ALTER TABLE media_creator_gigs
  DROP CONSTRAINT IF EXISTS media_creator_gigs_award_amount_check;

ALTER TABLE media_creator_gigs
  ADD CONSTRAINT media_creator_gigs_award_amount_check
  CHECK (award_amount_cents IS NULL OR award_amount_cents > 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_creator_gigs_credit_transaction
  ON media_creator_gigs(credit_transaction_id)
  WHERE credit_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_creator_gigs_credit_reservation
  ON media_creator_gigs(credit_reservation_id)
  WHERE credit_reservation_id IS NOT NULL;
