-- G11-B6 (D-607): settling an agreed refund settlement records who
-- settled it and the payer's off-platform payment reference, so a
-- settlement is evidence of money moved, not a bare status flip.
-- Record-only money (D-257): no platform money moves.
ALTER TABLE tool_rental_cancellation_recoveries
  ADD COLUMN IF NOT EXISTS settled_reference VARCHAR(200),
  ADD COLUMN IF NOT EXISTS settled_by UUID REFERENCES users(id) ON DELETE SET NULL;
