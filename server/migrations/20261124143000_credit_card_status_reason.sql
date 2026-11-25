-- Group 13 Slice 4c (665, D-364): suspension confirmation.
-- The reason for a card's current status lives on the card row so the
-- customer cards page can show it on the tile without re-reading audit
-- history (the audit-event reason stays the durable record).
-- Additive only; safe to run twice (IF NOT EXISTS).
ALTER TABLE oxsteed_credit_cards
  ADD COLUMN IF NOT EXISTS status_reason TEXT;
